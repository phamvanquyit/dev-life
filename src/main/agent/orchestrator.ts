import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { PROVIDER_ENDPOINTS } from '../constants'
import { getDb } from '../db'
import { llmProviders } from '../db/schema'
import { AGENT_TOOLS, toAnthropicTools, toGoogleTools } from './tools/definitions'
import { executeTool, FILE_MUTATING_TOOLS } from './tools/executor'

// ── Event types sent to renderer ──────────────────────────────────────────────

export type AgentEventType = 'token' | 'tool-start' | 'tool-result' | 'done' | 'error'

export interface AgentEvent {
  requestId: string
  type: AgentEventType
  // token
  token?: string
  // tool-start
  toolName?: string
  toolArgs?: Record<string, any>
  // tool-result
  toolResult?: string
  toolSuccess?: boolean
  // done
  fullText?: string
  filesChanged?: boolean
  // error
  error?: string
}

// ── Normalized internal message format ───────────────────────────────────────

interface UserMsg {
  kind: 'user'
  content: string
}

interface AssistantMsg {
  kind: 'assistant'
  text: string
  toolCalls?: ToolCallItem[]
}

interface ToolResultMsg {
  kind: 'tool-result'
  toolCallId: string
  toolName: string
  result: string
}

type InternalMsg = UserMsg | AssistantMsg | ToolResultMsg

interface ToolCallItem {
  id: string
  name: string
  args: Record<string, any>
}

// ── Run options ───────────────────────────────────────────────────────────────

export interface AgentRunOptions {
  requestId: string
  providerId: string
  modelId: string
  workspacePath: string
  projectContext?: string
  /** Simple [{role, content}] history from previous turns — no tool calls */
  conversationHistory: { role: 'user' | 'assistant'; content: string }[]
  userMessage: string
  abortSignal: AbortSignal
  senderWebContentsId: number
}

const MAX_ITERATIONS = 30

// ── System prompt ─────────────────────────────────────────────────────────────

const MINIAPP_WORKSPACE_MARKER = '.dev-life/apps/'

function buildSystemPrompt(workspacePath: string, projectContext?: string): string {
  const isMiniApp = workspacePath.includes(MINIAPP_WORKSPACE_MARKER)

  const lines = [
    'You are an expert AI coding assistant with direct access to the filesystem.',
    `Workspace: ${workspacePath}`,
    '',
    'Workflow:',
    '1. Read files before editing them — never assume content.',
    '2. Use edit_file for small targeted changes; write_file for whole-file rewrites.',
    '3. After editing, run tests/build if available to verify correctness.',
    '4. Be concise — show code, not prose.',
    '5. If a task is ambiguous, state your assumption and proceed.',
  ]

  if (isMiniApp) {
    lines.push(
      '',
      'This is a mini app workspace. Call `get_miniapp_guide` before writing any mini app code to get the full development guide.',
    )
  }

  if (projectContext) {
    lines.push('', 'Project context:', projectContext)
  }

  return lines.join('\n')
}

// ── Event broadcaster ─────────────────────────────────────────────────────────

function makeSender(senderWebContentsId: number) {
  return (ev: AgentEvent) => {
    const wc = require('electron').webContents.fromId(senderWebContentsId)
    if (wc && !wc.isDestroyed()) {
      wc.send('agent:event', ev)
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runAgent(opts: AgentRunOptions): Promise<void> {
  const {
    requestId,
    providerId,
    modelId,
    workspacePath,
    projectContext,
    abortSignal,
    senderWebContentsId,
  } = opts
  const send = makeSender(senderWebContentsId)

  const db = getDb()
  const row = await db.select().from(llmProviders).where(eq(llmProviders.id, providerId)).get()
  if (!row) throw new Error('Provider not found')

  const { provider, apiKey, endpoint } = row
  const baseUrl = endpoint || PROVIDER_ENDPOINTS[provider]
  const systemPrompt = buildSystemPrompt(workspacePath, projectContext)

  // Seed internal messages from conversation history (no tool calls in history)
  const internalMsgs: InternalMsg[] = [
    ...opts.conversationHistory.map<InternalMsg>((m) =>
      m.role === 'user'
        ? { kind: 'user', content: m.content }
        : { kind: 'assistant', text: m.content },
    ),
    { kind: 'user', content: opts.userMessage },
  ]

  let filesChanged = false
  let iteration = 0

  while (iteration < MAX_ITERATIONS) {
    if (abortSignal.aborted) break
    iteration++

    // Convert internal messages to provider format
    const apiMessages = buildApiMessages(provider, internalMsgs)
    const apiTools =
      provider === 'anthropic'
        ? toAnthropicTools(AGENT_TOOLS)
        : provider === 'google'
          ? toGoogleTools(AGENT_TOOLS)
          : AGENT_TOOLS // OpenAI format

    let fullText = ''
    const toolCalls: ToolCallItem[] = []

    // ── Streaming LLM call ────────────────────────────────────────────────────
    try {
      await streamLlmCall({
        provider,
        apiKey,
        baseUrl,
        modelId,
        systemPrompt,
        messages: apiMessages,
        tools: apiTools,
        abortSignal,
        onToken(t) {
          fullText += t
          send({ requestId, type: 'token', token: t })
        },
        onToolCall(tc) {
          toolCalls.push(tc)
        },
      })
    } catch (err: any) {
      if (abortSignal.aborted) break
      throw err
    }

    if (abortSignal.aborted) break

    // Add assistant message to internal history
    const assistantEntry: AssistantMsg = {
      kind: 'assistant',
      text: fullText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
    internalMsgs.push(assistantEntry)

    // No tool calls → agent finished its turn
    if (toolCalls.length === 0) {
      send({ requestId, type: 'done', fullText, filesChanged })
      return
    }

    // ── Execute tools (in parallel) ───────────────────────────────────────────
    if (abortSignal.aborted) break

    for (const tc of toolCalls) {
      send({ requestId, type: 'tool-start', toolName: tc.name, toolArgs: tc.args })
    }

    const results = await Promise.all(
      toolCalls.map((tc) => executeTool(tc.name, tc.args, workspacePath)),
    )

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      const result = results[i]

      if (FILE_MUTATING_TOOLS.has(tc.name) && result.success) filesChanged = true

      send({
        requestId,
        type: 'tool-result',
        toolName: tc.name,
        toolResult: result.output,
        toolSuccess: result.success,
      })

      internalMsgs.push({
        kind: 'tool-result',
        toolCallId: tc.id,
        toolName: tc.name,
        result: result.output,
      })
    }
  }

  if (abortSignal.aborted) {
    send({ requestId, type: 'done', fullText: '', filesChanged })
  } else {
    send({
      requestId,
      type: 'error',
      error: `Agent reached maximum iterations (${MAX_ITERATIONS}).`,
    })
  }
}

// ── Message format converters ─────────────────────────────────────────────────

function buildApiMessages(provider: string, msgs: InternalMsg[]): any[] {
  if (provider === 'anthropic') return toAnthropicMessages(msgs)
  if (provider === 'google') return toGoogleMessages(msgs)
  return toOpenAIMessages(msgs)
}

function toOpenAIMessages(msgs: InternalMsg[]): any[] {
  const out: any[] = []
  for (const m of msgs) {
    if (m.kind === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.kind === 'assistant') {
      const msg: any = { role: 'assistant', content: m.text || null }
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }))
      }
      out.push(msg)
    } else if (m.kind === 'tool-result') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        name: m.toolName,
        content: m.result,
      })
    }
  }
  return out
}

function toAnthropicMessages(msgs: InternalMsg[]): any[] {
  const out: any[] = []
  for (const m of msgs) {
    if (m.kind === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.kind === 'assistant') {
      const blocks: any[] = []
      if (m.text) blocks.push({ type: 'text', text: m.text })
      for (const tc of m.toolCalls || []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })
      }
      out.push({ role: 'assistant', content: blocks.length > 0 ? blocks : m.text || '' })
    } else if (m.kind === 'tool-result') {
      // Anthropic requires tool results to be batched into a single user turn per assistant turn
      // Append to last user message if it's already a tool-result batch, otherwise create new
      const last = out[out.length - 1]
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.result }
      if (last?.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
    }
  }
  return out
}

function toGoogleMessages(msgs: InternalMsg[]): any[] {
  const out: any[] = []
  for (const m of msgs) {
    if (m.kind === 'user') {
      out.push({ role: 'user', parts: [{ text: m.content }] })
    } else if (m.kind === 'assistant') {
      const parts: any[] = []
      if (m.text) parts.push({ text: m.text })
      for (const tc of m.toolCalls || []) {
        parts.push({ functionCall: { name: tc.name, args: tc.args } })
      }
      out.push({ role: 'model', parts })
    } else if (m.kind === 'tool-result') {
      out.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.toolName, response: { output: m.result } } }],
      })
    }
  }
  return out
}

// ── Streaming LLM call (all providers) ───────────────────────────────────────

interface StreamLlmOpts {
  provider: string
  apiKey: string
  baseUrl: string
  modelId: string
  systemPrompt: string
  messages: any[]
  tools: any[]
  abortSignal: AbortSignal
  onToken: (token: string) => void
  onToolCall: (tc: ToolCallItem) => void
}

async function streamLlmCall(opts: StreamLlmOpts): Promise<void> {
  const { provider } = opts
  if (provider === 'anthropic') return streamAnthropic(opts)
  if (provider === 'google') return streamGoogle(opts)
  return streamOpenAI(opts) // openai, openrouter, custom
}

// ── OpenAI / OpenRouter / Custom ──────────────────────────────────────────────

async function streamOpenAI(opts: StreamLlmOpts): Promise<void> {
  const {
    apiKey,
    baseUrl,
    modelId,
    systemPrompt,
    messages,
    tools,
    abortSignal,
    onToken,
    onToolCall,
  } = opts

  const body: any = {
    model: modelId,
    stream: true,
    temperature: 0.2,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  }
  if (tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const res = await fetchWithTempFallback(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abortSignal,
  })

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const tcAccum: Record<number, ToolCallItem> = {}
  let toolCallsFired = false

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data: ')) continue
      const json = t.slice(6)
      if (json === '[DONE]') continue
      try {
        const p = JSON.parse(json)
        const delta = p.choices?.[0]?.delta
        if (delta?.content) onToken(delta.content)

        for (const tc of delta?.tool_calls || []) {
          const idx = tc.index ?? 0
          if (!tcAccum[idx]) tcAccum[idx] = { id: '', name: '', args: {} }
          if (tc.id) tcAccum[idx].id = tc.id
          if (tc.function?.name) tcAccum[idx].name += tc.function.name
          if (tc.function?.arguments) {
            // accumulate raw string first, parse at end
            ;(tcAccum[idx] as any)._rawArgs =
              ((tcAccum[idx] as any)._rawArgs || '') + tc.function.arguments
          }
        }

        const finish = p.choices?.[0]?.finish_reason
        if (
          !toolCallsFired &&
          (finish === 'tool_calls' || finish === 'stop') &&
          Object.keys(tcAccum).length > 0
        ) {
          toolCallsFired = true
          for (const [, tc] of Object.entries(tcAccum)) {
            tc.args = tryParseJson((tc as any)._rawArgs || '{}')
            onToolCall(tc)
          }
        }
      } catch {
        // malformed SSE line
      }
    }
  }
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async function streamAnthropic(opts: StreamLlmOpts): Promise<void> {
  const {
    apiKey,
    baseUrl,
    modelId,
    systemPrompt,
    messages,
    tools,
    abortSignal,
    onToken,
    onToolCall,
  } = opts

  const body: any = {
    model: modelId,
    max_tokens: 8192,
    stream: true,
    system: systemPrompt,
    messages,
    temperature: 0.2,
  }
  if (tools.length > 0) body.tools = tools

  const res = await fetchWithTempFallback(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: abortSignal,
  })

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentTool: { id: string; name: string; _rawArgs: string } | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data: ')) continue
      try {
        const p = JSON.parse(t.slice(6))
        // text delta
        if (p.type === 'content_block_delta' && p.delta?.type === 'text_delta') {
          onToken(p.delta.text)
        }
        // tool_use start
        if (p.type === 'content_block_start' && p.content_block?.type === 'tool_use') {
          currentTool = { id: p.content_block.id, name: p.content_block.name, _rawArgs: '' }
        }
        // tool input delta
        if (
          p.type === 'content_block_delta' &&
          p.delta?.type === 'input_json_delta' &&
          currentTool
        ) {
          currentTool._rawArgs += p.delta.partial_json || ''
        }
        // tool block stop
        if (p.type === 'content_block_stop' && currentTool) {
          onToolCall({
            id: currentTool.id,
            name: currentTool.name,
            args: tryParseJson(currentTool._rawArgs),
          })
          currentTool = null
        }
      } catch {
        // skip
      }
    }
  }
}

// ── Google Gemini ─────────────────────────────────────────────────────────────

async function streamGoogle(opts: StreamLlmOpts): Promise<void> {
  const {
    apiKey,
    baseUrl,
    modelId,
    systemPrompt,
    messages,
    tools,
    abortSignal,
    onToken,
    onToolCall,
  } = opts
  const body: any = {
    contents: messages,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.2 },
  }
  if (tools.length > 0) body.tools = tools

  const res = await fetchWithTempFallback(
    `${baseUrl}/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortSignal,
    },
  )

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data: ')) continue
      try {
        const p = JSON.parse(t.slice(6))
        for (const part of p.candidates?.[0]?.content?.parts || []) {
          if (part.text) onToken(part.text)
          if (part.functionCall) {
            onToolCall({
              id: `call_${randomUUID()}`,
              name: part.functionCall.name,
              args: part.functionCall.args || {},
            })
          }
        }
      } catch {
        // skip
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchWithTempFallback(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init)
  if (!res.ok && res.status === 400) {
    const text = await res.text().catch(() => '')
    if (text.toLowerCase().includes('temperature')) {
      const body = JSON.parse(init.body as string)
      body.temperature = undefined
      if (body.generationConfig) body.generationConfig.temperature = undefined
      res = await fetch(url, { ...init, body: JSON.stringify(body) })
    } else {
      throw new Error(friendlyApiError(res.status, text))
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(friendlyApiError(res.status, text))
  }
  return res
}

function friendlyApiError(status: number, raw: string): string {
  // Try to extract the message from JSON error bodies (OpenAI / Anthropic / Google format)
  try {
    const parsed = JSON.parse(raw)
    const msg: string =
      parsed?.error?.message || // OpenAI / OpenRouter
      parsed?.message || // Anthropic
      parsed?.error?.status || // Google
      ''
    if (msg) return `API error ${status}: ${msg}`
  } catch {
    // not JSON
  }
  return `API error ${status}: ${raw || 'Unknown error'}`
}

function tryParseJson(s: string): Record<string, any> {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}
