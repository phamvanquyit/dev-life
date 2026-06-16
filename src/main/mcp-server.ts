/**
 * Embedded MCP Server for Dev Life Mini Apps
 *
 * Runs as an HTTP server inside the Electron main process.
 * Uses StreamableHTTP transport — compatible with Cursor, Claude Desktop, etc.
 *
 * MCP Config:
 * {
 *   "mcpServers": {
 *     "dev-life-miniapps": {
 *       "url": "http://localhost:24816/mcp"
 *     }
 *   }
 * }
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { getSqlite } from './db'

const MCP_PORT = 24816

// ─── Mini App Development Guide (returned by get_miniapp_guide tool) ─────────

const MINIAPP_GUIDE = `# Dev Life — Mini App Development Guide

> **IMPORTANT**: Read this entire guide BEFORE writing any mini app code.
> Mini apps run inside an Electron desktop app. Code is stored as strings in SQLite, evaluated at runtime.

---

## Architecture Overview

A mini app consists of up to 3 code files, each a JavaScript string:

| File | Role | Required | Runs In |
|---|---|---|---|
| \`frontendCode\` | Main UI shown when user opens the app | ✅ Yes | Renderer (browser) |
| \`backendCode\` | Background logic, API calls, data processing | ❌ Optional | Main process (Node.js) |
| \`panelCode\` | Small widget shown in the Quick Tools tray panel | ❌ Optional | Renderer (browser) |

### Communication Flow

\`\`\`
┌──────────────┐    ctx.ipc     ┌──────────────┐
│  Frontend    │ ◄────────────► │   Backend    │
│  (React UI)  │  send/on       │  (Node.js)   │
└──────────────┘                └──────────────┘
       ▲                               ▲
       │ ctx.ipc                       │ ctx.storage
       ▼                               │ ctx.db
┌──────────────┐                       ▼
│  Panel Code  │               ┌──────────────┐
│ (Tray widget)│               │   SQLite DB  │
└──────────────┘               └──────────────┘
\`\`\`

---

## MCP API (for creating/updating via MCP tools)

When using the MCP tools, provide these fields:

\`\`\`
create_miniapp({
  name: "My App",              // Required
  frontendCode: "...",         // Required — the frontend JS code string
  backendCode: "...",          // Optional — the backend JS code string
  panelCode: "...",            // Optional — the panel JS code string
  description: "...",          // Optional
  icon: "Sparkles",           // Optional, default: "Box" (lucide-react icon name)
  category: "Dev Tools",      // Optional, default: "Custom"
  version: "1.0.0",           // Optional
})
\`\`\`

---

## Frontend Code

### Module Pattern

Frontend code MUST export a React component function using CommonJS:

\`\`\`javascript
module.exports = function MyApp({ ctx }) {
  var { useState, useEffect, useCallback, icons, ui } = ctx
  var { Star } = icons

  var [count, setCount] = useState(0)

  return (
    <div className="p-6">
      <Star size={16} className="text-[var(--color-primary)]" />
      <span>{count}</span>
      <button onClick={function() { setCount(count + 1) }}>+1</button>
    </div>
  )
}
\`\`\`

### The ctx Object (Frontend)

\`\`\`javascript
ctx.appId         // string — unique ID of this mini app
ctx.React         // React library
ctx.h             // React.createElement shorthand

// React Hooks
ctx.useState, ctx.useEffect, ctx.useRef, ctx.useCallback, ctx.useMemo

// UI Component Library (see below)
ctx.ui            // e.g. ctx.ui.Button, ctx.ui.Input, ctx.ui.Card, ctx.ui.Modal

// Icons (all lucide-react icons)
ctx.icons         // e.g. ctx.icons.Copy, ctx.icons.Trash2, ctx.icons.Plus

// IPC (communicate with backend)
ctx.ipc.send(channel, data)     // Send message to backend
ctx.ipc.on(channel, handler)    // Listen for messages, returns cleanup fn

// Persistent Storage (key-value, async)
ctx.storage.get(key)            // Promise<string | null>
ctx.storage.set(key, value)     // Promise<{ success }>
ctx.storage.delete(key)         // Promise<{ success }>
ctx.storage.getAll()            // Promise<Record<string, string>>

// Media APIs
ctx.media.getDesktopSources(opts?)
ctx.media.getMediaAccess(type)
ctx.media.askMediaAccess(type)

// Notifications
ctx.notify(title, body?, opts?)
\`\`\`

### Critical JavaScript Rules

**⚠️ MUST FOLLOW — code runs in eval/Function constructor context:**

1. **Use \`var\`** instead of \`const\`/\`let\`
2. **Use \`function\` keyword** instead of arrow functions \`=>\`
3. **Use \`Object.assign({}, a, b)\`** instead of spread \`{...a, ...b}\`
4. **Use \`module.exports = function\`** — no import/export
5. **No \`async\`/\`await\`** — use \`.then()\` chains
6. **No optional chaining \`?.\`** — use explicit null checks
7. **No nullish coalescing \`??\`** — use \`||\` or ternary

\`\`\`javascript
// ✅ CORRECT
module.exports = function MyApp({ ctx }) {
  var { useState, useEffect } = ctx
  var [items, setItems] = useState([])

  useEffect(function() {
    var off = ctx.ipc.on('data', function(d) { setItems(d || []) })
    ctx.ipc.send('load', {})
    return off
  }, [])

  return (<div className="p-6">{items.length} items</div>)
}

// ❌ WRONG — will break
module.exports = ({ ctx }) => {
  const [items, setItems] = useState([])
}
\`\`\`

---

## Backend Code

### Module Pattern

\`\`\`javascript
module.exports = function setup(ctx) {
  ctx.log('Backend loaded')

  ctx.ipc.on('load-data', function() {
    var raw = ctx.storage.get('mydata')
    var data = raw ? JSON.parse(raw) : []
    ctx.ipc.send('data-loaded', data)
  })

  ctx.ipc.on('save-data', function(payload) {
    ctx.storage.set('mydata', JSON.stringify(payload))
    ctx.ipc.send('data-loaded', payload)
  })

  // Return cleanup function
  return function() { ctx.log('Cleanup') }
}
\`\`\`

### The ctx Object (Backend)

\`\`\`javascript
ctx.appId, ctx.log(...args)

// IPC
ctx.ipc.on(channel, handler)    // Listen from frontend
ctx.ipc.send(channel, data)     // Send to frontend

// Storage (synchronous)
ctx.storage.get(key)        // string | null
ctx.storage.set(key, value) // void
ctx.storage.delete(key)     // void
ctx.storage.getAll()        // Record<string, string>

// Scoped SQLite Database (table names auto-prefixed)
ctx.db.run(sql, ...params)  // INSERT, UPDATE, DELETE, CREATE TABLE
ctx.db.get(sql, ...params)  // Single row
ctx.db.all(sql, ...params)  // All rows

// Node.js APIs
ctx.require, ctx.fs, ctx.path, ctx.os, ctx.crypto, ctx.childProcess

// Electron APIs
ctx.shell, ctx.dialog, ctx.clipboard, ctx.desktopCapturer,
ctx.screen, ctx.Notification, ctx.systemPreferences

// Utilities
ctx.fetch              // Native fetch
ctx.appPath            // Electron userData path
ctx.homePath           // Home directory
ctx.tmpPath            // Temp directory

// Timers (auto-cleaned on unload)
ctx.setTimeout, ctx.setInterval, ctx.clearTimeout, ctx.clearInterval

// Config (from manifest)
ctx.config             // { key: value } from user settings
\`\`\`

### Database Example

Table names are auto-prefixed with \`miniapp_{shortId}_\`:

\`\`\`javascript
// You write:
ctx.db.run('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT)')
// Runtime executes: CREATE TABLE IF NOT EXISTS miniapp_abc12345_notes (...)

ctx.db.run('INSERT INTO notes (text) VALUES (?)', 'Hello')
var rows = ctx.db.all('SELECT * FROM notes')
\`\`\`

---

## Panel Code

Same pattern as frontend — renders in the tray popup:

\`\`\`javascript
module.exports = function MyPanel({ ctx }) {
  var { useState, useEffect, icons } = ctx
  var { Activity } = icons
  var [status, setStatus] = useState('idle')

  useEffect(function() {
    var off = ctx.ipc.on('status-changed', function(d) { setStatus(d.status) })
    ctx.ipc.send('get-status', {})
    return off
  }, [])

  return (
    <div className="p-3 flex items-center gap-2">
      <Activity size={14} className="text-[var(--color-primary)]" />
      <span className="text-xs text-[var(--color-body)]">Status: {status}</span>
    </div>
  )
}
\`\`\`

---

## UI Component Library (ctx.ui)

All accessed via \`ctx.ui.*\`. Ant Design-like API:

| Component | Key Props |
|---|---|
| \`Button\` | type=primary/default/text/link/dashed, size=small/middle/large, icon, loading, disabled, danger, block, onClick |
| \`Input\` | value, onChange, placeholder, size, disabled, type |
| \`Input.TextArea\` | value, onChange, placeholder, rows, disabled |
| \`InputNumber\` | value, onChange(val), min, max, step, size |
| \`Select\` | value, onChange(val), options=[{value,label}], placeholder, size |
| \`Switch\` | checked, onChange(bool), size=small/default |
| \`Checkbox\` | checked, onChange(e), children, disabled |
| \`Radio\` | checked, onChange(e), value, children |
| \`Radio.Group\` | value, onChange(e), children |
| \`Tag\` | color, closable, onClose, children |
| \`Tooltip\` | title, placement=top/bottom/left/right, children |
| \`Modal\` | open, title, onOk, onCancel, okText, cancelText, footer, width, children |
| \`Modal.confirm\` | { title, content, okText, cancelText, okButtonProps:{danger}, onOk, onCancel } |
| \`message\` | .success(msg), .error(msg), .warning(msg), .info(msg) |
| \`Card\` | title, extra, bordered, children |
| \`Tabs\` | activeKey, onChange(key), items=[{key,label,children}] |
| \`Table\` | columns=[{title,dataIndex,key,render,width,align}], dataSource, rowKey, size, bordered |
| \`Alert\` | message, description, type=success/info/warning/error, showIcon, closable |
| \`Spin\` | spinning, children |
| \`Divider\` | children (text inside) |
| \`Space\` | direction=horizontal/vertical, size, children |
| \`Progress\` | percent, size, status, showInfo, strokeColor |
| \`Slider\` | value, onChange(val), min, max, step |
| \`Avatar\` | src, alt, size(number), shape=circle/square, children |
| \`Badge\` | count, dot, color, overflowCount, showZero, children |
| \`Skeleton\` | active, avatar, title, paragraph, rows |
| \`Empty\` | description, children |
| \`Collapse\` | items=[{key,label,children}], defaultActiveKey |
| \`Popover\` | content, title, trigger=click/hover, children |
| \`Dropdown\` | menu={items:[{key,label,onClick,danger}]}, children |
| \`Drawer\` | open, title, onClose, width, placement=left/right, children |
| \`Typography.Title\` | level(1-5), children |
| \`Typography.Text\` | type=secondary/success/warning/danger, children |
| \`Typography.Paragraph\` | children |
| \`Segmented\` | options, value, onChange(val), size, block |
| \`Timeline\` | items=[{children,color,dot}] |

---

## Styling — Design Tokens (CSS Variables)

**ALWAYS use CSS variables. NEVER hardcode colors.**

| Variable | Value | Use |
|---|---|---|
| \`--color-primary\` | #00d992 | CTA buttons, active states |
| \`--color-primary-soft\` | #2fd6a1 | Hover states |
| \`--color-on-primary\` | #101010 | Text on primary bg |
| \`--color-canvas\` | #101010 | Page background |
| \`--color-canvas-soft\` | #1a1a1a | Input bg, elevated surfaces |
| \`--color-hairline\` | #3d3a39 | Borders, dividers |
| \`--color-ink\` | #f2f2f2 | Primary text |
| \`--color-ink-strong\` | #ffffff | High-emphasis text |
| \`--color-body\` | #bdbdbd | Body/secondary text |
| \`--color-mute\` | #8b949e | Captions, hints |
| \`--color-success\` | #00d992 | Success |
| \`--color-warning\` | #fdcb6e | Warning |
| \`--color-error\` | #ff6b6b | Error |
| \`--color-bg-hover\` | rgba(255,255,255,0.04) | Hover bg |
| \`--radius-xs\` | 4px | Tiny pills |
| \`--radius-sm\` | 6px | Buttons, inputs |
| \`--radius-md\` | 8px | Cards |
| \`--radius-pill\` | 9999px | Status tags |

### Styling with Tailwind + CSS Variables

\`\`\`html
<!-- Card -->
<div className="bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] p-4">
  <h2 className="text-sm font-semibold text-[var(--color-ink)]">Title</h2>
  <p className="text-xs text-[var(--color-mute)]">Description</p>
</div>

<!-- Primary button -->
<button className="h-9 px-4 text-[13px] font-semibold bg-[var(--color-primary)] text-[var(--color-on-primary)] border-none rounded-[var(--radius-sm)] cursor-pointer hover:opacity-90">
  Click
</button>

<!-- Input -->
<input className="w-full h-9 px-3 text-sm bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-mute)] focus:border-[var(--color-primary)]" />
\`\`\`

**Design rules:** Dark canvas only (#101010). Hairline borders, no shadows. Green accent for CTAs only. 6px radius for buttons, 8px for cards.

---

## Complete Example: Todo App

### frontendCode

\`\`\`javascript
module.exports = function TodoApp({ ctx }) {
  var { useState, useEffect, useCallback, icons, ui } = ctx
  var { CheckSquare, Plus, Trash2, ListTodo } = icons

  var [todos, setTodos] = useState([])
  var [text, setText] = useState('')

  useEffect(function() {
    var off = ctx.ipc.on('todos-loaded', function(data) { setTodos(data || []) })
    ctx.ipc.send('load-todos', {})
    return off
  }, [])

  var addTodo = useCallback(function() {
    if (!text.trim()) return
    ctx.ipc.send('add-todo', { text: text.trim() })
    setText('')
  }, [text])

  return (
    <div className="max-w-xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 flex items-center justify-center">
          <ListTodo size={18} className="text-[var(--color-primary)]" />
        </div>
        <h2 className="text-base font-semibold text-[var(--color-ink)]">Todo List</h2>
      </div>

      <div className="flex gap-2 mb-4">
        <ui.Input value={text} onChange={function(e) { setText(e.target.value) }} onKeyDown={function(e) { if (e.key === 'Enter') addTodo() }} placeholder="What needs to be done?" />
        <ui.Button type="primary" icon={<Plus size={14} />} onClick={addTodo}>Add</ui.Button>
      </div>

      {todos.length === 0 ? (
        <ui.Empty description="No todos yet" />
      ) : (
        <div className="flex flex-col gap-1.5">
          {todos.map(function(todo) {
            return (
              <div key={todo.id} className="group flex items-center gap-3 py-2.5 px-3 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-lg hover:border-[rgba(255,255,255,0.12)] transition-all">
                <CheckSquare size={16} className={todo.done ? 'text-[var(--color-primary)]' : 'text-[var(--color-mute)]'} onClick={function() { ctx.ipc.send('toggle-todo', { id: todo.id }) }} />
                <span className={'flex-1 text-sm ' + (todo.done ? 'line-through text-[var(--color-mute)]' : 'text-[var(--color-ink)]')}>{todo.text}</span>
                <Trash2 size={13} className="text-[var(--color-mute)] cursor-pointer opacity-0 group-hover:opacity-100 hover:text-[var(--color-error)] transition-all" onClick={function() { ctx.ipc.send('delete-todo', { id: todo.id }) }} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
\`\`\`

### backendCode

\`\`\`javascript
module.exports = function setup(ctx) {
  ctx.log('Todo backend loaded')

  function getTodos() {
    var raw = ctx.storage.get('todos')
    if (!raw) return []
    try { return JSON.parse(raw) } catch(e) { return [] }
  }

  function saveTodos(todos) {
    ctx.storage.set('todos', JSON.stringify(todos))
    ctx.ipc.send('todos-loaded', todos)
  }

  ctx.ipc.on('load-todos', function() { ctx.ipc.send('todos-loaded', getTodos()) })

  ctx.ipc.on('add-todo', function(data) {
    var todos = getTodos()
    todos.unshift({ id: Date.now(), text: data.text, done: false, createdAt: new Date().toISOString() })
    saveTodos(todos)
  })

  ctx.ipc.on('toggle-todo', function(data) {
    var todos = getTodos().map(function(t) {
      if (t.id === data.id) return Object.assign({}, t, { done: !t.done })
      return t
    })
    saveTodos(todos)
  })

  ctx.ipc.on('delete-todo', function(data) {
    saveTodos(getTodos().filter(function(t) { return t.id !== data.id }))
  })

  return function() { ctx.log('Todo cleanup') }
}
\`\`\`

### panelCode

\`\`\`javascript
module.exports = function TodoPanel({ ctx }) {
  var { useState, useEffect, icons } = ctx
  var { ListTodo } = icons
  var [count, setCount] = useState(0)

  useEffect(function() {
    var off = ctx.ipc.on('todos-loaded', function(data) {
      setCount((data || []).filter(function(t) { return !t.done }).length)
    })
    ctx.ipc.send('load-todos', {})
    return off
  }, [])

  return (
    <div className="flex items-center gap-2 p-3">
      <ListTodo size={14} className="text-[var(--color-primary)]" />
      <span className="text-xs text-[var(--color-body)]">Pending</span>
      <span className="ml-auto text-xs font-semibold px-1.5 rounded-[var(--radius-xs)] border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)]">{String(count)}</span>
    </div>
  )
}
\`\`\`

---

## Checklist

- [ ] \`module.exports = function\` pattern
- [ ] \`var\` instead of const/let
- [ ] \`function()\` instead of \`=>\`
- [ ] \`Object.assign()\` instead of spread
- [ ] No import/export, async/await, ?., ??
- [ ] Colors: CSS variables only (var(--color-*))
- [ ] Borders: var(--color-hairline)
- [ ] Radius: var(--radius-*)
- [ ] IPC cleanup in useEffect return
- [ ] Backend returns cleanup function
- [ ] Icon names: valid lucide-react PascalCase names
`

// ─── Mini App CRUD (direct DB access, shared with main process) ──────────────

function listMiniApps() {
  const sqlite = getSqlite()
  return sqlite.prepare('SELECT * FROM mini_apps ORDER BY display_order ASC, created_at DESC').all()
}

function getMiniApp(id: string) {
  const sqlite = getSqlite()
  return sqlite.prepare('SELECT * FROM mini_apps WHERE id = ?').get(id) as any | null
}

function createMiniApp(data: any) {
  const sqlite = getSqlite()
  const id = require('node:crypto').randomBytes(4).toString('hex')
  const now = new Date().toISOString()
  const maxOrder = sqlite
    .prepare('SELECT COALESCE(MAX(display_order), 0) as m FROM mini_apps')
    .get() as any
  const order = (maxOrder?.m || 0) + 1

  sqlite
    .prepare(
      `INSERT INTO mini_apps (id, name, description, icon, category, version, backend_code, frontend_code, panel_code, enabled, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      data.name || 'Untitled',
      data.description || '',
      data.icon || 'Box',
      data.category || 'Custom',
      data.version || '1.0.0',
      data.backendCode || '',
      data.frontendCode || '',
      data.panelCode || null,
      0,
      order,
      now,
      now,
    )

  return getMiniApp(id)
}

function updateMiniApp(id: string, data: any) {
  const sqlite = getSqlite()
  const app = getMiniApp(id)
  if (!app) return null

  const fields: string[] = []
  const values: any[] = []

  const mapping: Record<string, string> = {
    name: 'name',
    description: 'description',
    icon: 'icon',
    category: 'category',
    version: 'version',
    backendCode: 'backend_code',
    frontendCode: 'frontend_code',
    panelCode: 'panel_code',
  }

  for (const [key, col] of Object.entries(mapping)) {
    if (data[key] !== undefined) {
      fields.push(`${col} = ?`)
      values.push(data[key])
    }
  }

  if (data.enabled !== undefined) {
    fields.push('enabled = ?')
    values.push(data.enabled ? 1 : 0)
  }

  if (fields.length === 0) return app

  fields.push("updated_at = datetime('now')")
  values.push(id)

  sqlite.prepare(`UPDATE mini_apps SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getMiniApp(id)
}

function deleteMiniApp(id: string) {
  const sqlite = getSqlite()
  const result = sqlite.prepare('DELETE FROM mini_apps WHERE id = ?').run(id)
  return result.changes > 0
}

function toggleMiniApp(id: string) {
  const app = getMiniApp(id)
  if (!app) return null
  return updateMiniApp(id, { enabled: !app.enabled })
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_miniapps',
    description:
      'List all installed mini apps with their metadata (id, name, description, icon, category, version, enabled status)',
    inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
  },
  {
    name: 'get_miniapp',
    description:
      'Get full details of a mini app including its source code (frontendCode, backendCode, panelCode)',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'Mini app ID' } },
      required: ['id'],
    },
  },
  {
    name: 'create_miniapp',
    description:
      'Create a new mini app. Disabled by default. Use get_miniapp_guide first to learn the API.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'App name' },
        description: { type: 'string', description: 'Short description' },
        icon: { type: 'string', description: 'Lucide icon name (e.g. Key, Hash, Globe)' },
        category: { type: 'string', description: 'Category: Dev Tools, Productivity, etc.' },
        version: { type: 'string', description: 'Version string' },
        frontendCode: { type: 'string', description: 'Frontend JS code' },
        backendCode: { type: 'string', description: 'Backend JS code (optional)' },
        panelCode: { type: 'string', description: 'Tray panel JS code (optional)' },
      },
      required: ['name', 'frontendCode'],
    },
  },
  {
    name: 'update_miniapp',
    description: 'Update an existing mini app. Auto-disables when code changes for user review.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Mini app ID' },
        name: { type: 'string' },
        description: { type: 'string' },
        icon: { type: 'string' },
        category: { type: 'string' },
        version: { type: 'string' },
        frontendCode: { type: 'string' },
        backendCode: { type: 'string' },
        panelCode: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_miniapp',
    description: 'Delete a mini app and all its stored data permanently',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'Mini app ID' } },
      required: ['id'],
    },
  },
  {
    name: 'toggle_miniapp',
    description: 'Enable or disable a mini app',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'Mini app ID' } },
      required: ['id'],
    },
  },
  {
    name: 'get_miniapp_guide',
    description:
      'Get the full Mini App development guide. ALWAYS read this before creating or editing a mini app.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
  },
]

// ─── Tool Handler ─────────────────────────────────────────────────────────────

function handleTool(name: string, args: any): string {
  switch (name) {
    case 'list_miniapps': {
      const apps = listMiniApps() as any[]
      return JSON.stringify(
        apps.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          icon: a.icon,
          category: a.category,
          version: a.version,
          enabled: !!a.enabled,
          hasBackend: !!a.backend_code,
          hasFrontend: !!a.frontend_code,
          hasPanel: !!a.panel_code,
        })),
        null,
        2,
      )
    }

    case 'get_miniapp': {
      const app = getMiniApp(args.id) as any
      if (!app) return JSON.stringify({ error: `Mini app "${args.id}" not found` })
      return JSON.stringify(
        {
          id: app.id,
          name: app.name,
          description: app.description,
          icon: app.icon,
          category: app.category,
          version: app.version,
          enabled: !!app.enabled,
          frontendCode: app.frontend_code,
          backendCode: app.backend_code,
          panelCode: app.panel_code,
          createdAt: app.created_at,
          updatedAt: app.updated_at,
        },
        null,
        2,
      )
    }

    case 'create_miniapp': {
      const app = createMiniApp(args)
      return JSON.stringify({
        success: true,
        message: `Created "${app?.name}" (id: ${app?.id}). DISABLED by default — user enables in Mini App Manager.`,
        id: app?.id,
        name: app?.name,
      })
    }

    case 'update_miniapp': {
      const { id, ...data } = args
      if (data.frontendCode || data.backendCode || data.panelCode) {
        data.enabled = false
      }
      const app = updateMiniApp(id, data)
      if (!app) return JSON.stringify({ error: `Mini app "${id}" not found` })
      return JSON.stringify({
        success: true,
        message: `Updated "${app.name}".`,
        id: app.id,
      })
    }

    case 'delete_miniapp': {
      const existing = getMiniApp(args.id)
      const deleted = deleteMiniApp(args.id)
      return JSON.stringify({
        success: deleted,
        message: deleted ? `Deleted "${(existing as any)?.name}".` : 'Not found.',
      })
    }

    case 'toggle_miniapp': {
      const app = toggleMiniApp(args.id)
      if (!app) return JSON.stringify({ error: 'Not found' })
      return JSON.stringify({
        success: true,
        enabled: !!app.enabled,
        message: `"${app.name}" is now ${app.enabled ? 'ENABLED' : 'DISABLED'}.`,
      })
    }

    case 'get_miniapp_guide': {
      return MINIAPP_GUIDE
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

// ─── MCP Server Setup ────────────────────────────────────────────────────────

function createMcpServer(): Server {
  const server = new Server(
    { name: 'dev-life-miniapps', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      const result = handleTool(name, args || {})
      return { content: [{ type: 'text' as const, text: result }] }
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      }
    }
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'miniapp://guide/development',
        name: 'Mini App Development Guide',
        description: 'Complete guide for developing mini apps',
        mimeType: 'text/markdown',
      },
    ],
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === 'miniapp://guide/development') {
      const text = handleTool('get_miniapp_guide', {})
      return {
        contents: [{ uri: request.params.uri, mimeType: 'text/markdown', text }],
      }
    }
    throw new Error(`Unknown resource: ${request.params.uri}`)
  })

  return server
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

let httpServer: ReturnType<typeof createServer> | null = null
const sessions = new Map<string, StreamableHTTPServerTransport>()

export function startMcpServer(): void {
  httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id')
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://localhost:${MCP_PORT}`)

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ status: 'ok', server: 'dev-life-miniapps', sessions: sessions.size }),
      )
      return
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    // ── MCP endpoint ──────────────────────────────────────────────────
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    // Existing session
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!
      await transport.handleRequest(req, res)
      return
    }

    // New session (initialization request — no session ID yet)
    if (!sessionId && req.method === 'POST') {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => require('node:crypto').randomUUID(),
        })

        const server = createMcpServer()
        await server.connect(transport)

        // handleRequest generates the session ID
        await transport.handleRequest(req, res)

        // NOW sessionId is available — track it
        const sid = transport.sessionId
        if (sid) {
          sessions.set(sid, transport)
          transport.onclose = () => {
            sessions.delete(sid)
            server.close()
          }
        }
      } catch (e: any) {
        console.error('[mcp] Failed to create session:', e)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      }
      return
    }

    // Invalid: has session ID but not found, or GET without session
    if (sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Bad request' }))
    }
  })

  httpServer.listen(MCP_PORT, '127.0.0.1', () => {
    console.log(`[mcp] Mini App MCP server listening on http://127.0.0.1:${MCP_PORT}/mcp`)
  })

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[mcp] Port ${MCP_PORT} in use, MCP server not started`)
    } else {
      console.error('[mcp] MCP server error:', err)
    }
  })
}

export function stopMcpServer(): void {
  // Detach onclose handlers before closing to prevent infinite recursion
  // (transport.close → onclose → server.close → transport.close → ∞)
  for (const [, transport] of sessions) {
    transport.onclose = undefined as any
    transport.close()
  }
  sessions.clear()

  if (httpServer) {
    httpServer.close()
    httpServer = null
    console.log('[mcp] MCP server stopped')
  }
}
