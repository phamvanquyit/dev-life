import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import https from 'node:https'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { ipcMain } from 'electron'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  getProjectsFromDb,
  getTranscript,
  listConversations,
  newConversation,
  sendMessage,
} from './antigravity'
import { getSqlite } from './db'

const gunzip = promisify(zlib.gunzip)
const inflate = promisify(zlib.inflate)
const brotliDecompress = promisify(zlib.brotliDecompress)

const PROXY_PORT =
  process.env.DEV_LIFE_PREVIEW === 'true' ? 18982 : Number(process.env.PROXY_PORT) || 18981
const DAILY_HOST = 'https://daily-cloudcode-pa.googleapis.com'

let server: FastifyInstance | null = null
let isRunning = false
let requestCount = 0
let lastRequestAt: string | null = null

// Cache: tool_call_id → original Gemini functionCall part (preserves thought_signature)
const functionCallPartsCache = new Map<string, any>()

// ─── Credentials from DB ─────────────────────────────────────────────────────

interface AntigravityCredentials {
  client_id: string
  client_secret: string
  access_token: string | null
  refresh_token: string | null
  default_project: string | null
  user_agent: string
  endpoint: string
  oauth_token_url: string
}

function loadCredentials(): AntigravityCredentials | null {
  try {
    const sqlite = getSqlite()
    const row = sqlite
      .prepare("SELECT value FROM configurations WHERE key = 'antigravity_credentials'")
      .get() as { value: string } | undefined
    if (row?.value) {
      return JSON.parse(row.value)
    }
  } catch (e) {
    console.error('[proxy] Failed to load credentials from DB:', e)
  }
  return null
}

function updateCredentialsInDb(updates: Partial<AntigravityCredentials>): void {
  try {
    const creds = loadCredentials()
    if (!creds) return
    const updated = { ...creds, ...updates, updated_at: new Date().toISOString() }
    const sqlite = getSqlite()
    sqlite
      .prepare(
        `INSERT INTO configurations (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
      .run('antigravity_credentials', JSON.stringify(updated))
  } catch (e) {
    console.error('[proxy] Failed to update credentials in DB:', e)
  }
}

// ─── Token Refresh ───────────────────────────────────────────────────────────

async function refreshAccessToken(creds: AntigravityCredentials): Promise<string | null> {
  if (!creds.refresh_token || !creds.client_id || !creds.client_secret) return null

  return new Promise((resolve) => {
    const params = new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token!,
      grant_type: 'refresh_token',
    })

    const req = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(params.toString()),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            const response = JSON.parse(data)
            if (response.error) {
              console.error('[proxy] ❌ Refresh failed:', response.error)
              resolve(null)
              return
            }
            const newToken = response.access_token
            updateCredentialsInDb({ access_token: newToken })
            resolve(newToken)
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', () => resolve(null))
    req.write(params.toString())
    req.end()
  })
}

// ─── HTTP Request to Antigravity API ─────────────────────────────────────────

interface ApiResponse {
  statusCode: number
  body: any
  rawBody: string
}

async function apiRequest(
  method: string,
  url: string,
  body: any,
  accessToken: string,
  userAgent: string,
): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const headers: Record<string, string | number> = {
      accept: '*/*',
      'accept-encoding': 'gzip, deflate, br',
      authorization: `Bearer ${accessToken}`,
      'user-agent': userAgent,
      'x-goog-api-client': 'gl-node/22.21.1',
      host: urlObj.hostname,
      connection: 'close',
    }

    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)
      headers['content-type'] = 'application/json'
      headers['content-length'] = Buffer.byteLength(bodyStr)
    }

    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers,
      },
      async (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', async () => {
          try {
            let data = Buffer.concat(chunks)
            const enc = res.headers['content-encoding']
            if (enc === 'gzip') data = await gunzip(data)
            else if (enc === 'deflate') data = await inflate(data)
            else if (enc === 'br') data = await brotliDecompress(data)

            const dataStr = data.toString('utf8')
            let parsed = dataStr
            try {
              parsed = JSON.parse(dataStr)
            } catch {
              /* keep as string */
            }
            resolve({ statusCode: res.statusCode || 500, body: parsed, rawBody: dataStr })
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body))
    req.end()
  })
}

// ─── SSE Chat Request ────────────────────────────────────────────────────────

interface ChatOptions {
  model: string
  contents: any[]
  systemInstruction?: string | null
  project?: string
  tools?: any[]
  toolConfig?: any
  onChunk?: (text: string) => void
  onParts?: (parts: any[]) => void
  onComplete?: (fullText: string, allParts: any[]) => void
}

function extractPartsFromResponse(chunk: any): any[] {
  const candidates = chunk?.candidates?.[0]?.content?.parts
  if (candidates) return candidates
  const rc = chunk?.response?.candidates?.[0]?.content?.parts
  if (rc) return rc
  return []
}

function _extractTextFromResponse(chunk: any): string {
  return extractPartsFromResponse(chunk)
    .map((p: any) => p?.text || '')
    .filter(Boolean)
    .join('')
}

async function chatWithGemini(
  creds: AntigravityCredentials,
  opts: ChatOptions,
): Promise<{ text: string; chunks: any[] }> {
  const baseUrl = creds.endpoint || DAILY_HOST
  const url = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`

  const requestBody: any = { contents: opts.contents }
  if (opts.systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: opts.systemInstruction }] }
  }
  if (opts.tools && opts.tools.length > 0) {
    requestBody.tools = opts.tools
  }
  if (opts.toolConfig) {
    requestBody.toolConfig = opts.toolConfig
  }

  const body: any = {
    model: opts.model,
    user_prompt_id: crypto.randomBytes(6).toString('hex'),
    request: requestBody,
  }
  if (opts.project) body.project = opts.project

  const doRequest = (token: string): Promise<{ text: string; chunks: any[] }> => {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url)
      const req = https.request(
        {
          hostname: urlObj.hostname,
          port: 443,
          path: urlObj.pathname + urlObj.search,
          method: 'POST',
          headers: {
            accept: 'text/event-stream',
            'accept-encoding': 'gzip, deflate, br',
            authorization: `Bearer ${token}`,
            'user-agent': creds.user_agent || 'antigravity/2.0.4 darwin/arm64',
            'x-goog-api-client': 'gl-node/22.21.1',
            'content-type': 'application/json',
            host: urlObj.hostname,
            connection: 'close',
          },
        },
        (res) => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            let errData = ''
            res.on('data', (c) => (errData += c.toString()))
            res.on('end', () => {
              const err: any = new Error(`HTTP ${res.statusCode}: ${errData.substring(0, 500)}`)
              err.statusCode = res.statusCode
              reject(err)
            })
            return
          }

          let stream: NodeJS.ReadableStream = res
          const enc = res.headers['content-encoding']
          if (enc === 'gzip') stream = res.pipe(zlib.createGunzip())
          else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
          else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress())

          const chunks: any[] = []
          let buffer = ''

          stream.on('data', (chunk) => {
            buffer += chunk.toString()
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.substring(6)
                if (data.trim() && data !== '[DONE]') {
                  try {
                    const json = JSON.parse(data)
                    chunks.push(json)
                    const parts = extractPartsFromResponse(json)
                    if (parts.length > 0 && opts.onParts) opts.onParts(parts)
                    const text = parts
                      .map((p: any) => p?.text || '')
                      .filter(Boolean)
                      .join('')
                    if (text && opts.onChunk) opts.onChunk(text)
                  } catch {
                    /* skip */
                  }
                }
              }
            }
          })

          stream.on('end', () => {
            const allParts = chunks.flatMap(extractPartsFromResponse)
            const fullText = allParts
              .map((p: any) => p?.text || '')
              .filter(Boolean)
              .join('')
            if (opts.onComplete) opts.onComplete(fullText, allParts)
            resolve({ text: fullText, chunks })
          })

          stream.on('error', reject)
        },
      )
      req.on('error', reject)
      req.write(JSON.stringify(body))
      req.end()
    })
  }

  // Try with current token, auto-refresh on 401
  let token = creds.access_token || ''
  try {
    return await doRequest(token)
  } catch (err: any) {
    if (err.statusCode === 401) {
      const newToken = await refreshAccessToken(creds)
      if (newToken) {
        token = newToken
        return await doRequest(token)
      }
    }
    throw err
  }
}

// ─── Get project via loadCodeAssist ──────────────────────────────────────────

async function getProjectFromApi(creds: AntigravityCredentials): Promise<string> {
  if (creds.default_project) return creds.default_project
  try {
    const baseUrl = creds.endpoint || DAILY_HOST
    const res = await apiRequest(
      'POST',
      `${baseUrl}/v1internal:loadCodeAssist`,
      {
        metadata: {
          ide_type: 9,
          ide_version: '2.0.4',
          plugin_version: '',
          platform: 0,
          update_channel: '',
          duet_project: '',
          plugin_type: 0,
          ide_name: 'antigravity',
        },
      },
      creds.access_token || '',
      creds.user_agent || 'antigravity/2.0.4 darwin/arm64',
    )
    return res.body?.cloudaicompanionProject || res.body?.project || ''
  } catch {
    return ''
  }
}

// ─── OpenAI Format Helpers ───────────────────────────────────────────────────

function convertMessagesToGemini(messages: any[]): {
  contents: any[]
  systemInstruction: string | null
} {
  const contents: any[] = []
  const systemMessages = messages
    .filter((m: any) => m.role === 'system')
    .map((m: any) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n\n')

  for (const msg of messages) {
    if (msg.role === 'system') continue

    // Handle tool/function results → Gemini functionResponse (user role)
    if (msg.role === 'tool') {
      // Find the matching tool_call name from previous assistant message
      let toolName = msg.name || 'unknown'
      if (!msg.name && msg.tool_call_id) {
        // Look back to find the assistant message with this tool_call_id
        for (const prev of messages) {
          if (prev.role === 'assistant' && prev.tool_calls) {
            const match = prev.tool_calls.find((tc: any) => tc.id === msg.tool_call_id)
            if (match) {
              toolName = match.function?.name || match.name || 'unknown'
              break
            }
          }
        }
      }
      const responseContent =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      let parsedResponse: any
      try {
        parsedResponse = JSON.parse(responseContent)
      } catch {
        parsedResponse = { result: responseContent }
      }
      // Gemini requires functionResponse.response to be a Struct (JSON object)
      if (
        typeof parsedResponse !== 'object' ||
        parsedResponse === null ||
        Array.isArray(parsedResponse)
      ) {
        parsedResponse = { result: parsedResponse }
      }
      // Group consecutive tool messages into a single user turn
      const lastContent = contents[contents.length - 1]
      if (lastContent?.role === 'user' && lastContent.parts?.[0]?.functionResponse) {
        lastContent.parts.push({ functionResponse: { name: toolName, response: parsedResponse } })
      } else {
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name: toolName, response: parsedResponse } }],
        })
      }
      continue
    }

    // Handle assistant messages with tool_calls → Gemini functionCall parts
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const parts: any[] = []
      // Include text content if present
      if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
        parts.push({ text: msg.content })
      }
      for (const tc of msg.tool_calls) {
        const callId = tc.id
        // Try to use cached original Gemini part (preserves thought_signature)
        const cachedPart = callId ? functionCallPartsCache.get(callId) : null
        if (cachedPart) {
          parts.push(cachedPart)
        } else {
          // Fallback: reconstruct (without thought_signature)
          const fn = tc.function || tc
          let args: any = {}
          if (typeof fn.arguments === 'string') {
            try {
              args = JSON.parse(fn.arguments)
            } catch {
              args = { raw: fn.arguments }
            }
          } else if (fn.arguments) {
            args = fn.arguments
          } else if (fn.args) {
            args = typeof fn.args === 'string' ? JSON.parse(fn.args) : fn.args
          }
          parts.push({ functionCall: { name: fn.name, args } })
        }
      }
      contents.push({ role: 'model', parts })
      continue
    }

    // Normal messages
    const role = msg.role === 'assistant' ? 'model' : 'user'
    const parts: any[] = []
    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content })
    } else if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item.type === 'text') parts.push({ text: item.text })
        else if (item.type === 'image_url') parts.push({ text: `[Image: ${item.image_url.url}]` })
      }
    }
    if (parts.length > 0) contents.push({ role, parts })
  }

  return { contents, systemInstruction: systemMessages || null }
}

// ─── Tool Format Converters ──────────────────────────────────────────────────

function convertToolsToGemini(tools: any[]): any[] {
  if (!tools || tools.length === 0) return []
  const functionDeclarations: any[] = []
  for (const t of tools) {
    if (t.type === 'function' && t.function) {
      const decl: any = {
        name: t.function.name,
        description: t.function.description || '',
      }
      if (t.function.parameters) {
        decl.parameters = cleanJsonSchema(t.function.parameters)
      }
      functionDeclarations.push(decl)
    }
  }
  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : []
}

function cleanJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema
  const cleaned = { ...schema }
  // Remove unsupported fields for Gemini
  cleaned.$schema = undefined
  cleaned.additionalProperties = undefined
  if (cleaned.properties) {
    const props: any = {}
    for (const [key, val] of Object.entries(cleaned.properties)) {
      props[key] = cleanJsonSchema(val)
    }
    cleaned.properties = props
  }
  if (cleaned.items) {
    cleaned.items = cleanJsonSchema(cleaned.items)
  }
  return cleaned
}

function convertToolChoiceToGemini(toolChoice: any): any | null {
  if (!toolChoice) return null
  if (toolChoice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } }
  if (toolChoice === 'none') return { functionCallingConfig: { mode: 'NONE' } }
  if (toolChoice === 'required') return { functionCallingConfig: { mode: 'ANY' } }
  if (typeof toolChoice === 'object' && toolChoice.function?.name) {
    return {
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: [toolChoice.function.name],
      },
    }
  }
  return null
}

function createOpenAIResponse(text: string, model: string, promptLen: number, allParts?: any[]) {
  // Check if response contains functionCall parts
  const functionCalls = (allParts || []).filter((p: any) => p?.functionCall)

  if (functionCalls.length > 0) {
    const toolCalls = functionCalls.map((p: any, _idx: number) => {
      const callId = `call_${crypto.randomBytes(12).toString('hex')}`
      // Cache the original Gemini part (preserves thought_signature for multi-turn)
      functionCallPartsCache.set(callId, p)
      return {
        id: callId,
        type: 'function' as const,
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args || {}),
        },
      }
    })

    return {
      id: `chatcmpl-${crypto.randomBytes(12).toString('hex')}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text || null,
            tool_calls: toolCalls,
          },
          logprobs: null,
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: Math.ceil(promptLen / 4),
        completion_tokens: Math.ceil(text.length / 4),
        total_tokens: Math.ceil((promptLen + text.length) / 4),
      },
    }
  }

  return {
    id: `chatcmpl-${crypto.randomBytes(12).toString('hex')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: Math.ceil(promptLen / 4),
      completion_tokens: Math.ceil(text.length / 4),
      total_tokens: Math.ceil((promptLen + text.length) / 4),
    },
  }
}

function createStreamChunk(text: string, model: string, finishReason: string | null = null) {
  return {
    id: `chatcmpl-${crypto.randomBytes(12).toString('hex')}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: finishReason ? {} : { content: text },
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
  }
}

function createStreamToolCallChunk(
  toolCalls: { id: string; name: string; args: string }[],
  model: string,
  finishReason: string | null = null,
) {
  return {
    id: `chatcmpl-${crypto.randomBytes(12).toString('hex')}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: toolCalls.map((tc, idx) => ({
            index: idx,
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.args },
          })),
        },
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
  }
}

function killProcessOnPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const stdout = execSync(`netstat -ano | findstr :${port}`).toString()
      const lines = stdout.split('\n')
      const pids = new Set<string>()
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 5) {
          const pid = parts[parts.length - 1]
          if (/^\d+$/.test(pid) && pid !== '0') {
            pids.add(pid)
          }
        }
      }
      for (const pid of pids) {
        try {
          process.kill(Number.parseInt(pid, 10), 'SIGKILL')
        } catch {}
      }
    } else {
      try {
        const stdout = execSync(`lsof -t -i :${port}`, {
          stdio: ['pipe', 'pipe', 'ignore'],
        }).toString()
        const pids = stdout
          .trim()
          .split('\n')
          .map((p) => p.trim())
          .filter(Boolean)
        for (const pid of pids) {
          try {
            process.kill(Number.parseInt(pid, 10), 'SIGKILL')
          } catch {}
        }
      } catch {
        // lsof returns exit code 1 if no process is running, which is fine
      }
    }
  } catch (e: any) {
    console.error(`[proxy] ⚠️ Failed to auto-kill process on port ${port}:`, e.message)
  }
}

// ─── Start/Stop Server ───────────────────────────────────────────────────────

async function startProxyServer(): Promise<{ success: boolean; port?: number; error?: string }> {
  if (isRunning && server) {
    return { success: true, port: PROXY_PORT }
  }

  // Auto-kill existing process using the same port before starting
  killProcessOnPort(PROXY_PORT)

  try {
    const fastify = Fastify({ logger: false })

    // CORS
    fastify.addHook('onRequest', async (_req, reply) => {
      reply.header('Access-Control-Allow-Origin', '*')
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    })
    fastify.options('*', async (_req, reply) => reply.status(204).send())

    // GET /health
    fastify.get('/health', async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      requests: requestCount,
    }))

    // GET /
    fastify.get('/', async () => ({
      name: 'Dev Life AI Proxy',
      version: '1.0.0',
      description: 'OpenAI-compatible API proxy for Gemini via Antigravity credentials',
      port: PROXY_PORT,
      endpoints: {
        models: 'GET /v1/models',
        chat: 'POST /v1/chat/completions',
        completions: 'POST /v1/completions',
        responses: 'POST /v1/responses',
        antigravity_sync: 'POST /antigravity/sync',
        antigravity_projects: 'GET /antigravity/projects',
        antigravity_new_conversation: 'POST /antigravity/projects/:name/message',
        antigravity_conversations: 'GET /antigravity/conversations',
        antigravity_transcript: 'GET /antigravity/conversations/:id/transcript',
        antigravity_send_message: 'POST /antigravity/conversations/:id/message',
      },
    }))

    // GET /v1/models
    fastify.get('/v1/models', async (_req, reply) => {
      const creds = loadCredentials()
      if (!creds?.access_token) {
        return reply
          .status(500)
          .send({ error: { message: 'No credentials configured', type: 'server_error' } })
      }
      try {
        const baseUrl = creds.endpoint || DAILY_HOST
        let res = await apiRequest(
          'POST',
          `${baseUrl}/v1internal:fetchAvailableModels`,
          { project: creds.default_project || '' },
          creds.access_token,
          creds.user_agent,
        )

        // Auto-refresh on 401
        if (res.statusCode === 401) {
          const newToken = await refreshAccessToken(creds)
          if (newToken) {
            res = await apiRequest(
              'POST',
              `${baseUrl}/v1internal:fetchAvailableModels`,
              { project: creds.default_project || '' },
              newToken,
              creds.user_agent,
            )
          }
        }

        const modelsObj = res.body?.models || {}
        const openaiModels = Object.entries(modelsObj).map(([id, info]: [string, any]) => ({
          id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: info.modelProvider?.replace('MODEL_PROVIDER_', '').toLowerCase() || 'google',
          display_name: info.displayName || id,
        }))
        if (openaiModels.length > 0) {
          saveModelsToDb(openaiModels)
        }
        return { object: 'list', data: openaiModels }
      } catch (e: any) {
        return reply.status(500).send({ error: { message: e.message, type: 'server_error' } })
      }
    })

    // POST /v1/chat/completions
    fastify.post('/v1/chat/completions', async (req, reply) => {
      requestCount++
      lastRequestAt = new Date().toISOString()

      const creds = loadCredentials()
      if (!creds?.access_token) {
        return reply
          .status(500)
          .send({ error: { message: 'No credentials configured', type: 'server_error' } })
      }

      const {
        model = 'gemini-2.5-flash',
        messages,
        stream = false,
        tools: openaiTools,
        tool_choice: toolChoice,
      } = req.body as any

      if (!messages || !Array.isArray(messages)) {
        return reply.status(400).send({
          error: {
            message: 'messages is required and must be an array',
            type: 'invalid_request_error',
          },
        })
      }

      const { contents, systemInstruction } = convertMessagesToGemini(messages)
      const geminiTools = convertToolsToGemini(openaiTools || [])
      const geminiToolConfig = convertToolChoiceToGemini(toolChoice)
      const lastUser = messages.filter((m: any) => m.role === 'user').pop()
      const prompt = lastUser?.content || ''
      const project = await getProjectFromApi(creds)

      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })

        // Initial chunk with role
        const initChunk = {
          id: `chatcmpl-${crypto.randomBytes(12).toString('hex')}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        }
        reply.raw.write(`data: ${JSON.stringify(initChunk)}\n\n`)

        let streamHasToolCalls = false

        try {
          await chatWithGemini(creds, {
            model,
            contents,
            systemInstruction,
            project,
            tools: geminiTools.length > 0 ? geminiTools : undefined,
            toolConfig: geminiToolConfig || undefined,
            onParts: (parts) => {
              // Check for functionCall parts
              const fnCalls = parts.filter((p: any) => p?.functionCall)
              if (fnCalls.length > 0) {
                streamHasToolCalls = true
                const toolCallsData = fnCalls.map((p: any) => {
                  const callId = `call_${crypto.randomBytes(12).toString('hex')}`
                  // Cache original part (preserves thought_signature for multi-turn)
                  functionCallPartsCache.set(callId, p)
                  return {
                    id: callId,
                    name: p.functionCall.name,
                    args: JSON.stringify(p.functionCall.args || {}),
                  }
                })
                reply.raw.write(
                  `data: ${JSON.stringify(createStreamToolCallChunk(toolCallsData, model))}\n\n`,
                )
              }
            },
            onChunk: (text) => {
              if (!streamHasToolCalls) {
                reply.raw.write(`data: ${JSON.stringify(createStreamChunk(text, model))}\n\n`)
              }
            },
            onComplete: (_fullText, _allParts) => {
              const finishReason = streamHasToolCalls ? 'tool_calls' : 'stop'
              reply.raw.write(
                `data: ${JSON.stringify(createStreamChunk('', model, finishReason))}\n\n`,
              )
              reply.raw.write('data: [DONE]\n\n')
              reply.raw.end()
            },
          })
        } catch (e: any) {
          reply.raw.write(`data: ${JSON.stringify({ error: { message: e.message } })}\n\n`)
          reply.raw.write('data: [DONE]\n\n')
          reply.raw.end()
        }
        return
      }
      const result = await chatWithGemini(creds, {
        model,
        contents,
        systemInstruction,
        project,
        tools: geminiTools.length > 0 ? geminiTools : undefined,
        toolConfig: geminiToolConfig || undefined,
      })
      const allParts = result.chunks.flatMap(extractPartsFromResponse)
      return createOpenAIResponse(
        result.text,
        model,
        typeof prompt === 'string' ? prompt.length : 0,
        allParts,
      )
    })

    // POST /v1/completions
    fastify.post('/v1/completions', async (req, reply) => {
      requestCount++
      lastRequestAt = new Date().toISOString()

      const creds = loadCredentials()
      if (!creds?.access_token) {
        return reply
          .status(500)
          .send({ error: { message: 'No credentials', type: 'server_error' } })
      }

      const { model = 'gemini-2.5-flash', prompt } = req.body as any
      if (!prompt) {
        return reply
          .status(400)
          .send({ error: { message: 'prompt is required', type: 'invalid_request_error' } })
      }

      const project = await getProjectFromApi(creds)
      const result = await chatWithGemini(creds, {
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        project,
      })

      return {
        id: `cmpl-${crypto.randomBytes(12).toString('hex')}`,
        object: 'text_completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ text: result.text, index: 0, logprobs: null, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: Math.ceil(prompt.length / 4),
          completion_tokens: Math.ceil(result.text.length / 4),
          total_tokens: Math.ceil((prompt.length + result.text.length) / 4),
        },
      }
    })

    // POST /v1/responses (AI SDK v6)
    fastify.post('/v1/responses', async (req, reply) => {
      requestCount++
      lastRequestAt = new Date().toISOString()

      const creds = loadCredentials()
      if (!creds?.access_token) {
        return reply
          .status(500)
          .send({ error: { message: 'No credentials', type: 'server_error' } })
      }

      const { model = 'gemini-2.5-flash', input, text, stream = false } = req.body as any

      let prompt = ''
      if (typeof input === 'string') {
        prompt = input
      } else if (Array.isArray(input)) {
        for (const item of input) {
          if (typeof item === 'string') {
            prompt += `${item}\n`
          } else if (item.role === 'user' || item.role === 'system') {
            if (typeof item.content === 'string') {
              prompt += `${item.content}\n`
            } else if (Array.isArray(item.content)) {
              for (const part of item.content) {
                if (typeof part === 'string') prompt += `${part}\n`
                else if (part.text) prompt += `${part.text}\n`
              }
            }
          }
        }
      }
      prompt = prompt.trim()

      if (
        text &&
        typeof text === 'object' &&
        text.format?.type === 'json_schema' &&
        text.format?.schema
      ) {
        prompt = `Respond with valid JSON matching this schema:\n${JSON.stringify(text.format.schema, null, 2)}\n\nRequest: ${prompt}`
      }

      if (!prompt) {
        return reply
          .status(400)
          .send({ error: { message: 'No prompt found', type: 'invalid_request_error' } })
      }

      const project = await getProjectFromApi(creds)

      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })

        const responseId = `resp-${crypto.randomBytes(12).toString('hex')}`
        const outputId = `msg-${crypto.randomBytes(12).toString('hex')}`

        // 1. response.created
        reply.raw.write(
          `data: ${JSON.stringify({
            type: 'response.created',
            response: { id: responseId, object: 'response', status: 'in_progress', output: [] },
          })}\n\n`,
        )

        // 2. response.in_progress
        reply.raw.write(
          `data: ${JSON.stringify({
            type: 'response.in_progress',
            response: { id: responseId, object: 'response', status: 'in_progress' },
          })}\n\n`,
        )

        // 3. response.output_item.added
        reply.raw.write(
          `data: ${JSON.stringify({
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              id: outputId,
              type: 'message',
              role: 'assistant',
              status: 'in_progress',
              content: [],
            },
          })}\n\n`,
        )

        // 4. response.content_part.added
        reply.raw.write(
          `data: ${JSON.stringify({
            type: 'response.content_part.added',
            output_index: 0,
            content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] },
          })}\n\n`,
        )

        try {
          let fullText = ''
          await chatWithGemini(creds, {
            model,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            project,
            onChunk: (t) => {
              fullText += t
              // 5. response.output_text.delta (repeated)
              reply.raw.write(
                `data: ${JSON.stringify({
                  type: 'response.output_text.delta',
                  output_index: 0,
                  content_index: 0,
                  delta: t,
                })}\n\n`,
              )
            },
            onComplete: () => {
              // 6. response.output_text.done
              reply.raw.write(
                `data: ${JSON.stringify({
                  type: 'response.output_text.done',
                  output_index: 0,
                  content_index: 0,
                  text: fullText,
                })}\n\n`,
              )

              // 7. response.content_part.done
              reply.raw.write(
                `data: ${JSON.stringify({
                  type: 'response.content_part.done',
                  output_index: 0,
                  content_index: 0,
                  part: { type: 'output_text', text: fullText, annotations: [] },
                })}\n\n`,
              )

              // 8. response.output_item.done
              reply.raw.write(
                `data: ${JSON.stringify({
                  type: 'response.output_item.done',
                  output_index: 0,
                  item: {
                    id: outputId,
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text: fullText, annotations: [] }],
                  },
                })}\n\n`,
              )

              // 9. response.completed
              reply.raw.write(
                `data: ${JSON.stringify({
                  type: 'response.completed',
                  response: {
                    id: responseId,
                    object: 'response',
                    status: 'completed',
                    model,
                    output: [
                      {
                        id: outputId,
                        type: 'message',
                        role: 'assistant',
                        status: 'completed',
                        content: [{ type: 'output_text', text: fullText, annotations: [] }],
                      },
                    ],
                    usage: {
                      input_tokens: Math.ceil(prompt.length / 4),
                      output_tokens: Math.ceil(fullText.length / 4),
                      total_tokens: Math.ceil((prompt.length + fullText.length) / 4),
                    },
                  },
                })}\n\n`,
              )
              reply.raw.end()
            },
          })
        } catch (e: any) {
          reply.raw.write(
            `data: ${JSON.stringify({ type: 'error', error: { message: e.message } })}\n\n`,
          )
          reply.raw.end()
        }
        return
      }
      const result = await chatWithGemini(creds, {
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        project,
      })

      return {
        id: `resp-${crypto.randomBytes(12).toString('hex')}`,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model,
        output: [
          {
            id: `msg-${crypto.randomBytes(12).toString('hex')}`,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: result.text, annotations: [] }],
          },
        ],
        usage: {
          input_tokens: Math.ceil(prompt.length / 4),
          output_tokens: Math.ceil(result.text.length / 4),
          total_tokens: Math.ceil((prompt.length + result.text.length) / 4),
        },
      }
    })

    // POST /v1/embeddings (placeholder)
    fastify.post('/v1/embeddings', async (_req, reply) => {
      return reply
        .status(501)
        .send({ error: { message: 'Not implemented', type: 'not_implemented' } })
    })

    // ─── Antigravity API ───────────────────────────────────────────────────────

    // GET /antigravity/projects — list projects (from DB) with their conversations
    fastify.get('/antigravity/projects', async () => {
      const [dbProjects, conversations] = await Promise.all([
        getProjectsFromDb(),
        listConversations(),
      ])
      const convByProject = new Map<string, typeof conversations>()
      for (const conv of conversations) {
        const key = conv.project || 'Other'
        if (!convByProject.has(key)) convByProject.set(key, [])
        convByProject.get(key)!.push(conv)
      }
      return {
        projects: dbProjects.map((p) => ({
          projectId: p.projectId,
          name: p.name,
          path: p.path,
          conversations: (convByProject.get(p.name) || []).slice(0, 5),
        })),
      }
    })

    // POST /antigravity/projects/:projectId/message — create new conversation for a project
    fastify.post('/antigravity/projects/:projectId/message', async (req, reply) => {
      const { projectId } = req.params as { projectId: string }
      const { content, model } = (req.body || {}) as { content?: string; model?: string }
      if (!content) {
        return reply.status(400).send({
          error: { message: 'content is required', type: 'invalid_request_error' },
        })
      }
      const dbProjects = getProjectsFromDb()
      const project = dbProjects.find((p) => p.projectId === projectId)
      if (!project) {
        return reply.status(404).send({
          error: { message: `Project with id "${projectId}" not found`, type: 'not_found' },
        })
      }
      const result = await newConversation(content, project.path, project.name, model)
      return result
    })

    // GET /antigravity/conversations/:id/transcript — get transcript
    fastify.get('/antigravity/conversations/:id/transcript', async (req) => {
      const { id } = req.params as { id: string }
      const cleanId = id.replace(/['"]/g, '').trim()
      const { maxSteps, onlyChat } = req.query as {
        maxSteps?: string
        onlyChat?: string
      }
      const steps = await getTranscript(cleanId, {
        maxSteps: maxSteps ? Number.parseInt(maxSteps, 10) : 100,
        onlyChat: onlyChat !== 'false',
      })
      return { conversationId: cleanId, steps }
    })

    // POST /antigravity/conversations/:id/message — send message to existing conversation
    fastify.post('/antigravity/conversations/:id/message', async (req, reply) => {
      const { id } = req.params as { id: string }
      const cleanId = id.replace(/['"]/g, '').trim()
      const { content } = (req.body || {}) as { content?: string }
      if (!content) {
        return reply.status(400).send({
          error: { message: 'content is required', type: 'invalid_request_error' },
        })
      }
      const conversations = await listConversations()
      const conv = conversations.find((c) => c.id === cleanId)
      const result = await sendMessage(cleanId, content, conv?.workspacePath)
      return result
    })

    // Error handler
    fastify.setErrorHandler((error: any, _req, reply) => {
      console.error('[proxy] Error:', error.message)
      reply.status(error.statusCode || 500).send({
        error: { message: error.message, type: 'server_error' },
      })
    })

    await fastify.listen({ port: PROXY_PORT, host: '127.0.0.1' })
    server = fastify
    isRunning = true
    requestCount = 0
    return { success: true, port: PROXY_PORT }
  } catch (e: any) {
    console.error('[proxy] ❌ Failed to start:', e.message)
    return { success: false, error: e.message }
  }
}

async function stopProxyServer(): Promise<{ success: boolean }> {
  if (server) {
    try {
      await server.close()
    } catch {
      /* ignore */
    }
    server = null
    isRunning = false
  }
  return { success: true }
}

let cachedProfile: any = null
let lastTokenUsedForProfile: string | null = null

async function fetchTokenInfo(accessToken: string): Promise<any> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'www.googleapis.com',
        path: `/oauth2/v1/tokeninfo?access_token=${accessToken}`,
        method: 'GET',
        headers: {
          Connection: 'close',
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const info = JSON.parse(data)
              if (info.email) {
                resolve({
                  email: info.email,
                  name: info.email.split('@')[0],
                  picture: null,
                })
                return
              }
            }
          } catch {}
          resolve(null)
        })
      },
    )
    req.on('error', () => resolve(null))
    req.end()
  })
}

async function fetchUserProfile(accessToken: string): Promise<any> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'www.googleapis.com',
        path: '/oauth2/v3/userinfo',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Connection: 'close',
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const profile = JSON.parse(data)
              resolve(profile)
              return
            }
          } catch {}
          // Fallback to tokeninfo
          fetchTokenInfo(accessToken).then(resolve)
        })
      },
    )
    req.on('error', () => {
      fetchTokenInfo(accessToken).then(resolve)
    })
    req.end()
  })
}

function loadModelsFromDb(): any[] {
  try {
    const sqlite = getSqlite()
    const row = sqlite
      .prepare("SELECT value FROM configurations WHERE key = 'proxy_models'")
      .get() as { value: string } | undefined
    if (row?.value) {
      return JSON.parse(row.value)
    }
  } catch (e) {
    console.error('[proxy] Failed to load models from DB:', e)
  }
  return []
}

function saveModelsToDb(models: any[]): void {
  try {
    const sqlite = getSqlite()
    sqlite
      .prepare(
        `INSERT INTO configurations (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
      .run('proxy_models', JSON.stringify(models))
  } catch (e) {
    console.error('[proxy] Failed to save models to DB:', e)
  }
}

export async function fetchAndCacheModels(creds: AntigravityCredentials): Promise<any[]> {
  if (!creds?.access_token) return []
  try {
    const baseUrl = creds.endpoint || DAILY_HOST
    let res = await apiRequest(
      'POST',
      `${baseUrl}/v1internal:fetchAvailableModels`,
      { project: creds.default_project || '' },
      creds.access_token,
      creds.user_agent,
    )

    if (res.statusCode === 401) {
      const newToken = await refreshAccessToken(creds)
      if (newToken) {
        res = await apiRequest(
          'POST',
          `${baseUrl}/v1internal:fetchAvailableModels`,
          { project: creds.default_project || '' },
          newToken,
          creds.user_agent,
        )
      }
    }

    const modelsObj = res.body?.models || {}
    const openaiModels = Object.entries(modelsObj).map(([id, info]: [string, any]) => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: info.modelProvider?.replace('MODEL_PROVIDER_', '').toLowerCase() || 'google',
      display_name: info.displayName || id,
    }))

    if (openaiModels.length > 0) {
      saveModelsToDb(openaiModels)
    }
    return openaiModels
  } catch (e) {
    console.error('[proxy] Failed to fetch and cache models:', e)
    return []
  }
}

let cachedQuota: any = null

async function fetchUserQuota(creds: AntigravityCredentials): Promise<any> {
  try {
    const baseUrl = creds.endpoint || DAILY_HOST
    const res = await apiRequest(
      'POST',
      `${baseUrl}/v1internal:retrieveUserQuota`,
      {},
      creds.access_token || '',
      creds.user_agent || '',
    )
    return res.body
  } catch (e) {
    console.error('[proxy] Failed to fetch quota:', e)
    return null
  }
}

function getProxyStatus() {
  const creds = loadCredentials()
  if (creds?.access_token && creds.access_token !== lastTokenUsedForProfile) {
    lastTokenUsedForProfile = creds.access_token
    fetchUserProfile(creds.access_token).then((profile) => {
      if (profile) {
        cachedProfile = profile
      }
    })
    fetchAndCacheModels(creds)
    fetchUserQuota(creds).then((quota) => {
      if (quota) {
        cachedQuota = quota
      }
    })
  }

  return {
    running: isRunning,
    port: PROXY_PORT,
    url: `http://127.0.0.1:${PROXY_PORT}`,
    baseUrl: `http://127.0.0.1:${PROXY_PORT}/v1`,
    requestCount,
    lastRequestAt,
    hasCredentials: !!creds?.access_token,
    credentials: creds
      ? {
          client_id: creds.client_id || null,
          access_token: creds.access_token ? `${creds.access_token.substring(0, 20)}...` : null,
          refresh_token: creds.refresh_token ? `${creds.refresh_token.substring(0, 15)}...` : null,
          default_project: creds.default_project || null,
          user_agent: creds.user_agent || null,
          endpoint: creds.endpoint || null,
        }
      : null,
    profile: cachedProfile
      ? {
          name: cachedProfile.name || null,
          email: cachedProfile.email || null,
          picture: cachedProfile.picture || null,
          account_type: cachedProfile.email?.endsWith('@gmail.com')
            ? 'Personal'
            : 'Workspace / Enterprise',
        }
      : null,
    models: loadModelsFromDb(),
    quota: cachedQuota,
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

export function setupProxyIPC(): void {
  ipcMain.handle('proxy:start', async () => {
    return startProxyServer()
  })

  ipcMain.handle('proxy:stop', async () => {
    return stopProxyServer()
  })

  ipcMain.handle('proxy:status', async () => {
    return getProxyStatus()
  })

  ipcMain.handle('proxy:refresh-token', async () => {
    const creds = loadCredentials()
    if (!creds) return { success: false, error: 'No credentials' }
    const newToken = await refreshAccessToken(creds)
    return { success: !!newToken }
  })

  ipcMain.handle('proxy:refresh-models', async () => {
    const creds = loadCredentials()
    if (!creds) return { success: false, error: 'No credentials' }
    const models = await fetchAndCacheModels(creds)
    const quota = await fetchUserQuota(creds)
    if (quota) {
      cachedQuota = quota
    }
    return { success: models.length > 0 }
  })

  ipcMain.handle('proxy:refresh-quota', async () => {
    const creds = loadCredentials()
    if (!creds) return { success: false, error: 'No credentials' }
    const quota = await fetchUserQuota(creds)
    if (quota) {
      cachedQuota = quota
    }
    return { success: !!quota }
  })
}

/**
 * Auto-start proxy on app launch
 */
export async function autoStartProxy(): Promise<void> {
  const result = await startProxyServer()
  if (!result.success) {
    console.error('[proxy] Auto-start failed:', result.error)
  }
}
