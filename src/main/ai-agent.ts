import { ChatAnthropic } from '@langchain/anthropic'
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI } from '@langchain/openai'
import { eq } from 'drizzle-orm'
import { BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import { PROVIDER_ENDPOINTS } from './constants'
import { getDb } from './db'
import { configurations, llmProviders } from './db/schema'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentRunRequest {
  providerId: string
  modelId: string
  messages: Array<{ role: string; content: string }>
  context: {
    appName: string
    appDescription: string
    activeTab: string
    currentCode: string
    allCode: {
      frontend: string
      backend: string
      panel: string
    }
  }
}

// ─── Active Agent State ──────────────────────────────────────────────────────

let activeAbortController: AbortController | null = null

// ─── LLM Factory ─────────────────────────────────────────────────────────────

function createLlmModel(
  provider: string,
  apiKey: string,
  modelId: string,
  endpoint?: string | null,
) {
  switch (provider) {
    case 'anthropic':
      return new ChatAnthropic({
        apiKey,
        model: modelId,
        temperature: 0,
        maxTokens: 8192,
      })

    case 'google':
      return new ChatGoogleGenerativeAI({
        apiKey,
        model: modelId,
        temperature: 0,
        maxOutputTokens: 8192,
      })

    default: {
      const baseURL = endpoint || PROVIDER_ENDPOINTS[provider] || PROVIDER_ENDPOINTS.openai
      return new ChatOpenAI({
        apiKey,
        model: modelId,
        temperature: 0,
        maxTokens: 8192,
        configuration: {
          baseURL,
        },
      })
    }
  }
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const validateCode = tool(
  async ({ code, type }) => {
    const errors: string[] = []

    // Basic syntax validation using Function constructor
    try {
      if (type === 'backend') {
        // Backend code is wrapped in module pattern
        new Function('module', 'exports', 'ctx', code)
      } else {
        // Frontend/Panel code is JSX-like, validate as function body
        // We can't fully parse JSX, but we can catch basic JS syntax errors
        new Function(code)
      }
    } catch (e: any) {
      errors.push(`Syntax error: ${e.message}`)
    }

    // Additional checks
    if (type === 'backend') {
      if (!code.includes('module.exports')) {
        errors.push(
          'Warning: Backend code should export a function via module.exports = function setup(ctx) { ... }',
        )
      }
    }

    if (type === 'frontend') {
      if (!code.includes('return') && !code.includes('render')) {
        errors.push('Warning: Frontend code should return JSX elements')
      }
    }

    if (errors.length === 0) {
      return JSON.stringify({
        valid: true,
        message: 'Code passed validation — no syntax errors found.',
      })
    }

    return JSON.stringify({
      valid: false,
      errors,
      message: `Found ${errors.length} issue(s): ${errors.join('; ')}`,
    })
  },
  {
    name: 'validate_code',
    description:
      'Validate JavaScript code for syntax errors before proposing it. Use this to check code before sending it to the user.',
    schema: z.object({
      code: z.string().describe('The JavaScript code to validate'),
      type: z
        .enum(['frontend', 'backend', 'panel'])
        .describe('The type of mini app code: frontend, backend, or panel'),
    }),
  },
)

function createGenerateAndApplyTool() {
  return tool(
    async ({ code, target, description }) => {
      // Send code proposal to renderer
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('ai-agent:code-proposal', {
          code,
          target,
          description,
        })
      }

      return JSON.stringify({
        success: true,
        message: `Code proposal sent to user for review. Target: ${target}. Description: ${description}`,
      })
    },
    {
      name: 'generate_and_apply',
      description:
        'Propose code changes for the mini app. The user will review and approve/reject the changes before they are applied. Always use this tool when you want to write or modify code for the user.',
      schema: z.object({
        code: z.string().describe('The complete code to propose for the target file'),
        target: z
          .enum(['frontend', 'backend', 'panel'])
          .describe('Which code file to target: frontend, backend, or panel'),
        description: z
          .string()
          .describe('Brief description of what this code does and what changed'),
      }),
    },
  )
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(context: AgentRunRequest['context']): string {
  return `You are an expert AI coding assistant for Dev Life mini apps.
You help users write, debug, and improve mini app code.

## Mini App Architecture

A mini app consists of up to 3 code files:

### Frontend (frontend.js)
- A React component rendered inside the main Electron app
- **JSX is supported** — code is auto-transpiled before execution
- Tailwind CSS is available — use \`className\` with Tailwind classes for styling
- Has access to a \`ctx\` object (see API Reference below)
- Must export a function component: \`module.exports = function MyApp({ ctx }) { ... }\`

### Backend (backend.js)
- Node.js module: \`module.exports = function setup(ctx) { ... }\`
- Runs in the Electron main process — plain JavaScript only (NO JSX)
- May return a cleanup function: \`return function cleanup() { ... }\`

### Panel (panel.js) — Optional
- Same as frontend — uses JSX + Tailwind, same ctx API
- Used for settings/controls in a side panel

## API Reference

### Frontend ctx object:
- \`ctx.h(type, props, ...children)\` — createElement helper (also available as global \`h\`, used internally by JSX transpiler)
- \`ctx.React\` — React library
- \`ctx.useState\`, \`ctx.useEffect\`, \`ctx.useRef\`, \`ctx.useCallback\`, \`ctx.useMemo\` — React hooks
- \`ctx.ui\` — UI components library. Available components:
  - **Layout**: \`Space\`, \`Divider\`, \`Card\`, \`Drawer\`
  - **Form**: \`Button\`, \`Input\`, \`Input.TextArea\`, \`InputNumber\`, \`Select\`, \`Switch\`, \`Checkbox\`, \`Radio\`, \`Slider\`
  - **Data Display**: \`Tag\`, \`Badge\`, \`Avatar\`, \`Table\`, \`Collapse\`, \`Tabs\`, \`Timeline\`, \`Segmented\`, \`Typography\`, \`Empty\`, \`Skeleton\`
  - **Feedback**: \`Modal\`, \`Modal.confirm()\`, \`Alert\`, \`Progress\`, \`Spin\`, \`message.success()\`, \`message.error()\`, \`message.warning()\`, \`message.info()\`
  - **Overlay**: \`Tooltip\`, \`Popover\`, \`Dropdown\`
  - **Other**: \`ConfigProvider\`, \`theme\`
- \`ctx.icons\` — Lucide icons (\`ctx.icons.Plus\`, \`ctx.icons.Trash2\`, \`ctx.icons.Settings\`, etc.)
- \`ctx.ipc.send(channel, data)\` — send message to backend
- \`ctx.ipc.on(channel, callback)\` — listen for messages from backend (returns cleanup fn)
- \`ctx.storage.get(key)\`, \`ctx.storage.set(key, value)\` — local key-value storage
- \`ctx.notify(title, body)\` — show system notification

### Backend ctx object:
- \`ctx.ipc.on(channel, handler)\` — listen for messages from frontend
- \`ctx.ipc.send(channel, data)\` — send messages to frontend
- \`ctx.storage.get(key)\`, \`ctx.storage.set(key, value)\` — persistent storage
- \`ctx.db.run(sql, ...params)\`, \`ctx.db.get(sql, ...params)\`, \`ctx.db.all(sql, ...params)\` — scoped SQLite
- \`ctx.fs\`, \`ctx.path\`, \`ctx.os\`, \`ctx.crypto\` — Node.js built-ins
- \`ctx.fetch\` — HTTP requests
- \`ctx.shell.openExternal(url)\` — open URLs
- \`ctx.log(...args)\` — console logging
- \`ctx.config\` — user-defined config values
- \`ctx.setTimeout\`, \`ctx.setInterval\` — auto-cleanup timers

## Design Tokens (CSS Variables)

Use these CSS variables via Tailwind arbitrary values for consistent theming:
- Text: \`text-[var(--color-ink)]\` (primary), \`text-[var(--color-body)]\` (secondary), \`text-[var(--color-mute)]\` (tertiary)
- Backgrounds: \`bg-[var(--color-canvas)]\` (base), \`bg-[var(--color-canvas-soft)]\` (elevated)
- Borders: \`border-[var(--color-hairline)]\`
- Primary: \`text-[var(--color-primary)]\`, \`bg-[var(--color-primary)]\`, \`text-[var(--color-on-primary)]\`
- Radius: \`rounded-[var(--radius-sm)]\`, \`rounded-[var(--radius-md)]\`, \`rounded-[var(--radius-lg)]\`
- Font: \`font-[var(--font-mono)]\`

## Code Template (Frontend with JSX)

\`\`\`javascript
module.exports = function MyApp({ ctx }) {
  var { useState, useEffect, icons, ui } = ctx
  var { Plus, Trash2 } = icons
  var { Button, Input } = ui

  var [items, setItems] = useState([])

  useEffect(function () {
    var cleanup = ctx.ipc.on('data-loaded', function (data) {
      setItems(data)
    })
    ctx.ipc.send('load-data')
    return cleanup
  }, [])

  return (
    <div className="flex flex-col h-full bg-[var(--color-canvas)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-hairline)]">
        <h1 className="text-sm font-semibold text-[var(--color-ink)]">My App</h1>
        <Button type="primary" icon={<Plus size={14} />} onClick={function() {}}>Add</Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {items.map(function (item, i) {
          return (
            <div key={i} className="p-3 mb-2 rounded-[var(--radius-md)] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)]">
              <span className="text-xs text-[var(--color-body)]">{item.text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
\`\`\`

## CRITICAL RULES — MUST FOLLOW

1. **Use JSX** for frontend and panel code. JSX is automatically transpiled — write natural React-like markup.
2. **NO inline styles** — Do NOT use \`style={{ ... }}\` objects. Use Tailwind CSS classes via \`className\`.
3. **NO import/export** — Use \`module.exports = ...\` for the component. Destructure everything from \`ctx\`.
4. **NO TypeScript** — Write plain JavaScript only.
5. **NO arrow functions** — Use \`function\` keyword for broader compatibility.
6. **Destructure from ctx** — \`var { useState, useEffect, icons, ui } = ctx\` then use directly in JSX.
7. Always use \`generate_and_apply\` tool to propose code changes.
8. Use \`validate_code\` to check for syntax errors before proposing.
9. Always provide COMPLETE code files, not partial snippets.
10. Explain your changes clearly in the description.
11. Use design tokens (CSS variables) for colors, not hardcoded hex values.

## Anti-patterns (DO NOT DO THIS)

❌ BAD — inline styles:
\`\`\`javascript
<div style={{ padding: '16px', color: 'white', background: '#1a1a2e' }}>Hello</div>
\`\`\`

✅ GOOD — Tailwind classes:
\`\`\`javascript
<div className="p-4 text-[var(--color-ink)] bg-[var(--color-canvas)]">Hello</div>
\`\`\`

❌ BAD — using h() directly (old style):
\`\`\`javascript
h('div', { className: 'p-4' }, h('span', null, 'Hello'))
\`\`\`

✅ GOOD — JSX (preferred):
\`\`\`javascript
<div className="p-4"><span>Hello</span></div>
\`\`\`

❌ BAD — not destructuring icons/ui:
\`\`\`javascript
return <div>{ctx.icons.Plus({ size: 14 })}</div>
\`\`\`

✅ GOOD — destructure then use as JSX component:
\`\`\`javascript
var { Plus } = ctx.icons
return <div><Plus size={14} /></div>
\`\`\`

## Current Context
- App name: ${context.appName || '(new app)'}
- App description: ${context.appDescription || '(no description)'}
- Active tab: ${context.activeTab}

### Current Frontend Code:
\`\`\`javascript
${context.allCode.frontend || '// empty'}
\`\`\`

### Current Backend Code:
\`\`\`javascript
${context.allCode.backend || '// empty'}
\`\`\`

${context.allCode.panel ? `### Current Panel Code:\n\`\`\`javascript\n${context.allCode.panel}\n\`\`\`` : ''}`
}

// ─── IPC Setup ───────────────────────────────────────────────────────────────

export function setupAiAgentIPC() {
  // Run agent
  ipcMain.handle('ai-agent:run', async (_event, data: AgentRunRequest) => {
    const { providerId, modelId, messages, context } = data

    // Abort any existing run
    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
    }

    const abortController = new AbortController()
    activeAbortController = abortController

    try {
      // Get provider with raw API key
      const db = getDb()
      const providerRow = await db
        .select()
        .from(llmProviders)
        .where(eq(llmProviders.id, providerId))
        .get()

      if (!providerRow) {
        throw new Error('LLM provider not found. Please select a provider in the sidebar.')
      }

      console.log(
        '[ai-agent] Using provider:',
        providerRow.provider,
        'model:',
        modelId,
        'hasApiKey:',
        !!providerRow.apiKey,
      )

      // Create LLM model
      const llm = createLlmModel(
        providerRow.provider,
        providerRow.apiKey,
        modelId,
        providerRow.endpoint,
      )

      // Create tools
      const tools = [validateCode, createGenerateAndApplyTool()]

      // Create agent
      const agent = createReactAgent({
        llm,
        tools,
      })

      // Build messages
      const agentMessages: BaseMessage[] = [
        new SystemMessage(buildSystemPrompt(context)),
        ...messages.map((m) => {
          if (m.role === 'assistant') return new AIMessage(m.content)
          return new HumanMessage(m.content)
        }),
      ]

      // Stream agent execution
      const stream = agent.streamEvents(
        { messages: agentMessages },
        { version: 'v2', signal: abortController.signal },
      )

      let fullContent = ''

      for await (const event of stream) {
        if (abortController.signal.aborted) break

        const wins = BrowserWindow.getAllWindows()

        if (event.event === 'on_chat_model_stream') {
          const chunk = event.data?.chunk
          if (chunk?.content && typeof chunk.content === 'string') {
            fullContent += chunk.content
            for (const win of wins) {
              win.webContents.send('ai-agent:token', {
                content: chunk.content,
                fullContent,
              })
            }
          }
        } else if (event.event === 'on_tool_start') {
          for (const win of wins) {
            win.webContents.send('ai-agent:tool-start', {
              name: event.name,
              input: event.data?.input,
            })
          }
        } else if (event.event === 'on_tool_end') {
          for (const win of wins) {
            win.webContents.send('ai-agent:tool-end', {
              name: event.name,
              output: event.data?.output,
            })
          }
        }
      }

      // Send done signal
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('ai-agent:done', { fullContent })
      }

      return { success: true }
    } catch (err: any) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('ai-agent:done', { fullContent: '', aborted: true })
        }
        return { success: true, aborted: true }
      }

      const errorMessage = err.message || 'Agent execution failed'
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('ai-agent:error', { error: errorMessage })
      }
      return { success: false, error: errorMessage }
    } finally {
      if (activeAbortController === abortController) {
        activeAbortController = null
      }
    }
  })

  // Stop agent
  ipcMain.handle('ai-agent:stop', async () => {
    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
      return { success: true }
    }
    return { success: false, error: 'No active agent run' }
  })

  // Config persistence
  ipcMain.handle('config:get', async (_event, key: string) => {
    try {
      const db = getDb()
      const row = await db.select().from(configurations).where(eq(configurations.key, key)).get()
      return row?.value || null
    } catch {
      return null
    }
  })

  ipcMain.handle('config:set', async (_event, key: string, value: string) => {
    try {
      const db = getDb()
      // Upsert
      await db
        .insert(configurations)
        .values({ key, value })
        .onConflictDoUpdate({
          target: configurations.key,
          set: { value, updatedAt: new Date().toISOString() },
        })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
