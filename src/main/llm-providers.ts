import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { BrowserWindow, ipcMain } from 'electron'
import { PROVIDER_ENDPOINTS } from './constants'
import { getDb } from './db'
import { llmProviders } from './db/schema'

// ─── Fetch Models ────────────────────────────────────────────────────────────

interface ModelInfo {
  id: string
  name: string
}

async function fetchModelsFromProvider(
  provider: string,
  apiKey: string,
  endpoint?: string,
): Promise<ModelInfo[]> {
  const baseUrl = endpoint || PROVIDER_ENDPOINTS[provider]
  if (!baseUrl) {
    throw new Error('Endpoint is required for custom providers')
  }

  if (provider === 'anthropic') {
    // Anthropic uses a different endpoint and auth header
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Anthropic API error ${res.status}: ${body || res.statusText}`)
    }
    const data: any = await res.json()
    const models = (data.data || []) as any[]
    return models.map((m: any) => ({
      id: m.id,
      name: m.display_name || m.id,
    }))
  }

  if (provider === 'google') {
    // Google Gemini API
    const res = await fetch(`${baseUrl}/models?key=${apiKey}`)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Google API error ${res.status}: ${body || res.statusText}`)
    }
    const data: any = await res.json()
    const models = (data.models || []) as any[]
    return models
      .filter((m: any) => m.name?.startsWith('models/'))
      .map((m: any) => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name.replace('models/', ''),
      }))
  }

  // OpenAI-compatible (openai, openrouter, custom)
  const res = await fetch(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${body || res.statusText}`)
  }
  const data: any = await res.json()
  const models = (data.data || []) as any[]
  return models.map((m: any) => ({
    id: m.id,
    name: m.id,
  }))
}

// ─── IPC Setup ───────────────────────────────────────────────────────────────

export function setupLlmProvidersIPC() {
  // List all providers
  ipcMain.handle('llm:list-providers', async () => {
    try {
      const db = getDb()
      const rows = await db.select().from(llmProviders).all()
      return {
        success: true,
        providers: rows.map((r) => ({
          ...r,
          models: JSON.parse(r.models || '[]'),
          apiKey: maskApiKey(r.apiKey),
        })),
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Add provider — fetches models to validate, then saves
  ipcMain.handle(
    'llm:add-provider',
    async (
      _event,
      data: {
        name: string
        provider: string
        apiKey: string
        endpoint?: string
      },
    ) => {
      try {
        const { name, provider, apiKey, endpoint } = data

        if (!name?.trim()) throw new Error('Name is required')
        if (!provider?.trim()) throw new Error('Provider is required')
        if (!apiKey?.trim()) throw new Error('API Key is required')
        if (provider === 'custom' && !endpoint?.trim()) {
          throw new Error('Endpoint is required for custom providers')
        }

        // Fetch models to validate the API key / endpoint
        const models = await fetchModelsFromProvider(provider, apiKey, endpoint || undefined)

        if (!models.length) {
          throw new Error('No models found — check your API key and endpoint')
        }

        const id = randomUUID()
        const db = getDb()
        await db.insert(llmProviders).values({
          id,
          name: name.trim(),
          provider: provider.trim(),
          apiKey: apiKey.trim(),
          endpoint: endpoint?.trim() || null,
          models: JSON.stringify(models),
        })

        return {
          success: true,
          id,
          modelsCount: models.length,
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  )

  // Delete provider
  ipcMain.handle('llm:delete-provider', async (_event, id: string) => {
    try {
      const db = getDb()
      await db.delete(llmProviders).where(eq(llmProviders.id, id))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Get raw provider (with unmasked API key) — internal use only
  ipcMain.handle('llm:get-provider-raw', async (_event, providerId: string) => {
    try {
      const db = getDb()
      const row = await db.select().from(llmProviders).where(eq(llmProviders.id, providerId)).get()
      if (!row) throw new Error('Provider not found')
      return {
        success: true,
        provider: {
          ...row,
          models: JSON.parse(row.models || '[]'),
        },
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Get models for a provider
  ipcMain.handle('llm:get-models', async (_event, providerId: string) => {
    try {
      const db = getDb()
      const row = await db.select().from(llmProviders).where(eq(llmProviders.id, providerId)).get()
      if (!row) throw new Error('Provider not found')
      return {
        success: true,
        models: JSON.parse(row.models || '[]'),
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Call completion for a provider model (LLM inference)
  ipcMain.handle(
    'llm:call-completion',
    async (
      _event,
      data: {
        providerId: string
        modelId: string
        systemPrompt: string
        messages: { role: 'user' | 'assistant'; content: string }[]
        temperature?: number
      },
    ) => {
      try {
        const { providerId, modelId, systemPrompt, messages, temperature = 0.2 } = data
        const db = getDb()
        const providerRow = await db
          .select()
          .from(llmProviders)
          .where(eq(llmProviders.id, providerId))
          .get()
        if (!providerRow) throw new Error('Provider not found')

        const { provider, apiKey, endpoint } = providerRow
        const baseUrl = endpoint || PROVIDER_ENDPOINTS[provider]

        /**
         * Helper: gọi fetch, nếu bị lỗi liên quan đến temperature thì tự động
         * retry lại mà không gửi temperature. Giải quyết triệt để cho mọi model
         * (o1, o3, o4-mini, gpt-5.5...) mà không cần maintain danh sách model.
         */
        const callWithTemperatureFallback = async (
          url: string,
          headers: Record<string, string>,
          buildBody: (includeTemp: boolean) => string,
        ): Promise<Response> => {
          const res = await fetch(url, {
            method: 'POST',
            headers,
            body: buildBody(true),
          })

          if (!res.ok) {
            const errorText = await res.text().catch(() => '')
            // Nếu lỗi liên quan đến temperature → retry không có temperature
            if (res.status === 400 && errorText.toLowerCase().includes('temperature')) {
              const retryRes = await fetch(url, {
                method: 'POST',
                headers,
                body: buildBody(false),
              })
              if (!retryRes.ok) {
                const retryErrorText = await retryRes.text().catch(() => '')
                throw new Error(
                  `API error ${retryRes.status}: ${retryErrorText || retryRes.statusText}`,
                )
              }
              return retryRes
            }
            throw new Error(`API error ${res.status}: ${errorText || res.statusText}`)
          }
          return res
        }

        if (provider === 'google') {
          const googleContents = messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }))

          const url = `${baseUrl}/models/${modelId}:generateContent?key=${apiKey}`
          const response = await callWithTemperatureFallback(
            url,
            { 'Content-Type': 'application/json' },
            (includeTemp) =>
              JSON.stringify({
                contents: googleContents,
                systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
                ...(includeTemp && { generationConfig: { temperature } }),
              }),
          )

          const json: any = await response.json()
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || ''
          return { success: true, text }
        }

        if (provider === 'anthropic') {
          const anthropicMessages = messages.map((m) => ({
            role: m.role,
            content: m.content,
          }))

          const url = `${baseUrl}/messages`
          const response = await callWithTemperatureFallback(
            url,
            {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            (includeTemp) =>
              JSON.stringify({
                model: modelId,
                max_tokens: 4000,
                system: systemPrompt || undefined,
                messages: anthropicMessages,
                ...(includeTemp && { temperature }),
              }),
          )

          const json: any = await response.json()
          const text = json.content?.[0]?.text || ''
          return { success: true, text }
        }

        // OpenAI, OpenRouter, Custom (OpenAI compatible)
        const openaiMessages: { role: string; content: string }[] = []
        if (systemPrompt) {
          openaiMessages.push({ role: 'system', content: systemPrompt })
        }
        for (const m of messages) {
          openaiMessages.push({ role: m.role, content: m.content })
        }

        const url = `${baseUrl}/chat/completions`
        const response = await callWithTemperatureFallback(
          url,
          {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          (includeTemp) =>
            JSON.stringify({
              model: modelId,
              messages: openaiMessages,
              ...(includeTemp && { temperature }),
            }),
        )

        const json: any = await response.json()
        const text = json.choices?.[0]?.message?.content || ''
        return { success: true, text }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  )

  // ─── Streaming Completion ──────────────────────────────────────────────────
  // Gọi LLM với streaming token realtime. Renderer nhận chunks qua IPC event.
  // Hỗ trợ: OpenAI/OpenRouter (SSE), Anthropic (SSE), Google Gemini (JSON stream).

  // Track active streams for cancellation
  const activeStreams = new Map<string, AbortController>()

  ipcMain.handle(
    'llm:call-completion-stream',
    async (
      _event,
      data: {
        requestId?: string
        providerId: string
        modelId: string
        systemPrompt: string
        messages: { role: 'user' | 'assistant'; content: string }[]
        temperature?: number
        tools?: any[] // Tool definitions (OpenAI format)
      },
    ) => {
      const requestId = data.requestId || randomUUID()
      const abortController = new AbortController()
      activeStreams.set(requestId, abortController)

      // Helper: gửi chunk đến tất cả renderer windows
      const sendChunk = (chunk: {
        requestId: string
        type: 'token' | 'tool_call' | 'done' | 'error'
        token?: string
        toolCall?: { id: string; name: string; arguments: string }
        fullText?: string
        error?: string
      }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('llm:stream-chunk', chunk)
        }
      }

      // Chạy streaming trong background (không block invoke response)

      ;(async () => {
        try {
          const { providerId, modelId, systemPrompt, messages, temperature = 0.2, tools } = data
          const db = getDb()
          const providerRow = await db
            .select()
            .from(llmProviders)
            .where(eq(llmProviders.id, providerId))
            .get()
          if (!providerRow) throw new Error('Provider not found')

          const { provider, apiKey, endpoint } = providerRow
          const baseUrl = endpoint || PROVIDER_ENDPOINTS[provider]

          let fullText = ''

          // ── OpenAI / OpenRouter / Custom (SSE) ──
          if (provider === 'openai' || provider === 'openrouter' || provider === 'custom') {
            const openaiMessages: { role: string; content: string }[] = []
            if (systemPrompt) {
              openaiMessages.push({ role: 'system', content: systemPrompt })
            }
            for (const m of messages) {
              openaiMessages.push({ role: m.role, content: m.content })
            }

            const body: any = {
              model: modelId,
              messages: openaiMessages,
              stream: true,
              temperature,
            }
            if (tools && tools.length > 0) {
              body.tools = tools
              body.tool_choice = 'auto'
            }

            const makeStreamRequest = async (includeTemp: boolean): Promise<Response> => {
              const reqBody = { ...body }
              if (!includeTemp) reqBody.temperature = undefined
              return fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(reqBody),
                signal: abortController.signal,
              })
            }

            let res = await makeStreamRequest(true)
            if (!res.ok && res.status === 400) {
              const errorText = await res.text().catch(() => '')
              if (errorText.toLowerCase().includes('temperature')) {
                res = await makeStreamRequest(false)
              } else {
                throw new Error(`API error ${res.status}: ${errorText || res.statusText}`)
              }
            }
            if (!res.ok) {
              const errorText = await res.text().catch(() => '')
              throw new Error(`API error ${res.status}: ${errorText || res.statusText}`)
            }

            // Parse SSE stream
            const reader = res.body?.getReader()
            if (!reader) throw new Error('No response body')

            const decoder = new TextDecoder()
            let buffer = ''
            // Track tool calls being assembled across chunks
            const toolCallAccumulator: Record<
              number,
              { id: string; name: string; arguments: string }
            > = {}

            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed || !trimmed.startsWith('data: ')) continue
                const jsonStr = trimmed.slice(6)
                if (jsonStr === '[DONE]') continue

                try {
                  const parsed = JSON.parse(jsonStr)
                  const delta = parsed.choices?.[0]?.delta

                  // Text content
                  if (delta?.content) {
                    fullText += delta.content
                    sendChunk({ requestId, type: 'token', token: delta.content })
                  }

                  // Tool calls (streamed incrementally)
                  if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                      const idx = tc.index ?? 0
                      if (!toolCallAccumulator[idx]) {
                        toolCallAccumulator[idx] = {
                          id: tc.id || '',
                          name: tc.function?.name || '',
                          arguments: '',
                        }
                      }
                      if (tc.id) toolCallAccumulator[idx].id = tc.id
                      if (tc.function?.name) toolCallAccumulator[idx].name = tc.function.name
                      if (tc.function?.arguments) {
                        toolCallAccumulator[idx].arguments += tc.function.arguments
                      }
                    }
                  }

                  // Check finish reason
                  const finishReason = parsed.choices?.[0]?.finish_reason
                  if (finishReason === 'tool_calls' || finishReason === 'stop') {
                    // Emit accumulated tool calls
                    for (const [, tc] of Object.entries(toolCallAccumulator)) {
                      sendChunk({ requestId, type: 'tool_call', toolCall: tc })
                    }
                  }
                } catch {
                  // Skip malformed JSON lines
                }
              }
            }

            sendChunk({ requestId, type: 'done', fullText })
          }
          // ── Anthropic (SSE) ──
          else if (provider === 'anthropic') {
            const anthropicMessages = messages.map((m) => ({
              role: m.role,
              content: m.content,
            }))

            const body: any = {
              model: modelId,
              max_tokens: 16384,
              stream: true,
              system: systemPrompt || undefined,
              messages: anthropicMessages,
              temperature,
            }
            // Anthropic tool format
            if (tools && tools.length > 0) {
              body.tools = tools.map((t: any) => ({
                name: t.function?.name || t.name,
                description: t.function?.description || t.description || '',
                input_schema: t.function?.parameters || t.parameters || { type: 'object' },
              }))
            }

            const makeStreamRequest = async (includeTemp: boolean): Promise<Response> => {
              const reqBody = { ...body }
              if (!includeTemp) reqBody.temperature = undefined
              return fetch(`${baseUrl}/messages`, {
                method: 'POST',
                headers: {
                  'x-api-key': apiKey,
                  'anthropic-version': '2023-06-01',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(reqBody),
                signal: abortController.signal,
              })
            }

            let res = await makeStreamRequest(true)
            if (!res.ok && res.status === 400) {
              const errorText = await res.text().catch(() => '')
              if (errorText.toLowerCase().includes('temperature')) {
                res = await makeStreamRequest(false)
              } else {
                throw new Error(`API error ${res.status}: ${errorText || res.statusText}`)
              }
            }
            if (!res.ok) {
              const errorText = await res.text().catch(() => '')
              throw new Error(`API error ${res.status}: ${errorText || res.statusText}`)
            }

            const reader = res.body?.getReader()
            if (!reader) throw new Error('No response body')

            const decoder = new TextDecoder()
            let buffer = ''
            // Track current tool_use block being built
            let currentToolUse: { id: string; name: string; arguments: string } | null = null

            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed.startsWith('data: ')) continue
                const jsonStr = trimmed.slice(6)

                try {
                  const parsed = JSON.parse(jsonStr)

                  // Text delta
                  if (
                    parsed.type === 'content_block_delta' &&
                    parsed.delta?.type === 'text_delta'
                  ) {
                    fullText += parsed.delta.text
                    sendChunk({ requestId, type: 'token', token: parsed.delta.text })
                  }

                  // Tool use start
                  if (
                    parsed.type === 'content_block_start' &&
                    parsed.content_block?.type === 'tool_use'
                  ) {
                    currentToolUse = {
                      id: parsed.content_block.id,
                      name: parsed.content_block.name,
                      arguments: '',
                    }
                  }

                  // Tool use input delta
                  if (
                    parsed.type === 'content_block_delta' &&
                    parsed.delta?.type === 'input_json_delta'
                  ) {
                    if (currentToolUse) {
                      currentToolUse.arguments += parsed.delta.partial_json || ''
                    }
                  }

                  // Tool use block stop
                  if (parsed.type === 'content_block_stop' && currentToolUse) {
                    sendChunk({ requestId, type: 'tool_call', toolCall: currentToolUse })
                    currentToolUse = null
                  }
                } catch {
                  // Skip malformed
                }
              }
            }

            sendChunk({ requestId, type: 'done', fullText })
          }
          // ── Google Gemini (JSON stream) ──
          else if (provider === 'google') {
            const googleContents = messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            }))

            const body: any = {
              contents: googleContents,
              systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
              generationConfig: { temperature },
            }
            // Google function calling format
            if (tools && tools.length > 0) {
              body.tools = [
                {
                  functionDeclarations: tools.map((t: any) => ({
                    name: t.function?.name || t.name,
                    description: t.function?.description || t.description || '',
                    parameters: t.function?.parameters || t.parameters || { type: 'object' },
                  })),
                },
              ]
            }

            const makeStreamRequest = async (includeTemp: boolean): Promise<Response> => {
              const reqBody = { ...body }
              if (!includeTemp) reqBody.generationConfig = undefined
              return fetch(
                `${baseUrl}/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(reqBody),
                  signal: abortController.signal,
                },
              )
            }

            let res = await makeStreamRequest(true)
            if (!res.ok && res.status === 400) {
              const errorText = await res.text().catch(() => '')
              if (errorText.toLowerCase().includes('temperature')) {
                res = await makeStreamRequest(false)
              } else {
                throw new Error(`API error ${res.status}: ${errorText || res.statusText}`)
              }
            }
            if (!res.ok) {
              const errorText = await res.text().catch(() => '')
              throw new Error(`API error ${res.status}: ${errorText || res.statusText}`)
            }

            const reader = res.body?.getReader()
            if (!reader) throw new Error('No response body')

            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed.startsWith('data: ')) continue
                const jsonStr = trimmed.slice(6)

                try {
                  const parsed = JSON.parse(jsonStr)
                  const parts = parsed.candidates?.[0]?.content?.parts || []

                  for (const part of parts) {
                    // Text part
                    if (part.text) {
                      fullText += part.text
                      sendChunk({ requestId, type: 'token', token: part.text })
                    }
                    // Function call part
                    if (part.functionCall) {
                      sendChunk({
                        requestId,
                        type: 'tool_call',
                        toolCall: {
                          id: `call_${randomUUID()}`,
                          name: part.functionCall.name,
                          arguments: JSON.stringify(part.functionCall.args || {}),
                        },
                      })
                    }
                  }
                } catch {
                  // Skip malformed
                }
              }
            }

            sendChunk({ requestId, type: 'done', fullText })
          } else {
            throw new Error(`Unsupported provider for streaming: ${provider}`)
          }
        } catch (err: any) {
          if (err.name === 'AbortError') {
            sendChunk({ requestId, type: 'done', fullText: '' })
          } else {
            sendChunk({ requestId, type: 'error', error: err.message || String(err) })
          }
        } finally {
          activeStreams.delete(requestId)
        }
      })()

      // Return requestId ngay lập tức để renderer có thể track
      return { success: true, requestId }
    },
  )

  // Cancel an active stream
  ipcMain.handle('llm:cancel-stream', async (_event, requestId: string) => {
    const controller = activeStreams.get(requestId)
    if (controller) {
      controller.abort()
      activeStreams.delete(requestId)
      return { success: true }
    }
    return { success: false, error: 'Stream not found' }
  })

  // Format code string using Biome CLI
  ipcMain.handle(
    'llm:format-code',
    async (
      _event,
      code: string,
    ): Promise<{ success: boolean; formatted?: string; error?: string }> => {
      try {
        if (!code?.trim()) return { success: true, formatted: code }

        // Tìm đường dẫn Biome binary trong node_modules
        const biomeBin = path.resolve(__dirname, '../../node_modules/.bin/biome')

        const formatted = execSync(`"${biomeBin}" format --stdin-file-path=virtual.jsx`, {
          input: code,
          encoding: 'utf-8',
          timeout: 10000,
        })

        return { success: true, formatted: formatted.trim() }
      } catch (err: any) {
        // Nếu Biome format thất bại, trả về code gốc thay vì crash
        console.warn('[llm:format-code] Biome format failed, returning original code:', err.message)
        return { success: true, formatted: code }
      }
    },
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}
