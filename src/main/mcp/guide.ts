// ─── Mini App Development Guide v2 (returned by get_miniapp_guide tool) ──────

export const MINIAPP_GUIDE = `# Dev Life — Mini App Development Guide (v2)

> **IMPORTANT**: Read this entire guide BEFORE writing any mini app code.
> Mini apps run inside an Electron desktop app. Code is stored on filesystem (~/.dev-life/apps/), evaluated at runtime.

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

## ⚠️ Layout & Container Awareness (CRITICAL)

**Mini apps render inside a parent container that has NO padding and uses \`overflow: hidden\`.**
Your content will be flush against the container edges unless you add your own spacing.

**For most apps**, add \`p-6\` padding on the root element so the UI has breathing room:

\`\`\`javascript
// ✅ Standard app — add p-6 padding for spacing
return (
  <div className="h-full overflow-y-auto p-6">
    {/* your content here */}
  </div>
)
\`\`\`

If your app intentionally needs a full-width layout (e.g. a code editor, canvas, or split-panel UI), you can skip the padding — but this should be a conscious design choice, not an oversight.

**Fixed header + scrollable body pattern:**

\`\`\`javascript
return (
  <div className="h-full flex flex-col">
    {/* Fixed header */}
    <div className="shrink-0 p-6 pb-0">
      <h2>Title</h2>
      <div>Toolbar / filters</div>
    </div>
    {/* Scrollable body */}
    <div className="flex-1 overflow-y-auto p-6">
      {/* scrollable content */}
    </div>
  </div>
)
\`\`\`

## Frontend Code

### Module Pattern

Frontend code MUST export a React component function using CommonJS:

\`\`\`javascript
module.exports = function MyApp({ ctx }) {
  const { useState, useEffect, useCallback, icons, ui } = ctx
  const { Star } = icons

  const [count, setCount] = useState(0)

  return (
    <div className="p-6">
      <Star size={16} className="text-[var(--color-primary)]" />
      <span>{count}</span>
      <button onClick={() => setCount(count + 1)}>+1</button>
    </div>
  )
}
\`\`\`

### The ctx Object (Frontend)

\`\`\`javascript
ctx.appId         // string — unique ID of this mini app
ctx.React         // React library

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

### JavaScript Rules

**Code runs in eval/Function constructor context (Electron Chromium).**
**JSX is auto-transpiled by Sucrase at runtime — use JSX syntax directly.**

1. **Use \`module.exports = function\`** — no import/export
2. **Write JSX directly** — \`<div className="p-6">\` works out of the box (auto-transpiled)
3. **Modern JS OK** — \`const\`/\`let\`, arrow functions, \`async/await\`, \`?.\`, \`??\`, spread \`{...obj}\` all work fine
4. **No \`import\`/\`export\`** — this is the only real restriction
5. **Do NOT use \`ctx.h()\` or \`React.createElement()\`** — always write JSX

\`\`\`javascript
// ✅ CORRECT — Use JSX
module.exports = function MyApp({ ctx }) {
  const { useState, useEffect } = ctx
  const [items, setItems] = useState([])

  useEffect(() => {
    const off = ctx.ipc.on('data', (d) => setItems(d ?? []))
    ctx.ipc.send('load', {})
    return off
  }, [])

  return (<div className="p-6">{items.length} items</div>)
}

// ❌ WRONG — no import/export
import React from 'react'
export default ({ ctx }) => { ... }

// ❌ WRONG — do NOT use ctx.h() or React.createElement()
return ctx.h('div', { className: 'p-6' }, items.length, ' items')
\`\`\`

---

## Backend Code (v2 — Child Process)

Backend runs in its own Node.js child process.
- Modern JS OK: const, let, =>, async/await, ?., ??
- Can require() npm packages
- Storage and DB are **async** (require await)

### Module Pattern

\`\`\`javascript
module.exports = async function setup(ctx) {
  ctx.log('Backend loaded')

  ctx.ipc.on('load-data', async () => {
    const raw = await ctx.storage.get('mydata')
    const data = raw ? JSON.parse(raw) : []
    ctx.ipc.send('data-loaded', data)
  })

  ctx.ipc.on('save-data', async (payload) => {
    await ctx.storage.set('mydata', JSON.stringify(payload))
    ctx.ipc.send('data-loaded', payload)
  })

  // Return cleanup function
  return () => ctx.log('Cleanup')
}
\`\`\`

### The ctx Object (Backend)

\`\`\`javascript
ctx.appId, ctx.log(...args)

// IPC
ctx.ipc.on(channel, handler)    // Listen from frontend
ctx.ipc.send(channel, data)     // Send to frontend

// Storage (ASYNC — use await)
await ctx.storage.get(key)        // Promise<string | null>
await ctx.storage.set(key, value) // Promise<boolean>
await ctx.storage.delete(key)     // Promise<boolean>
await ctx.storage.getAll()        // Promise<Record<string, string>>

// Scoped SQLite Database (ASYNC — table names auto-prefixed)
await ctx.db.run(sql, ...params)  // INSERT, UPDATE, DELETE, CREATE TABLE
await ctx.db.get(sql, ...params)  // Single row
await ctx.db.all(sql, ...params)  // All rows

// Node.js APIs (native)
ctx.require, ctx.fs, ctx.path, ctx.os, ctx.crypto, ctx.childProcess

// Electron APIs (proxy, returns Promise)
ctx.shell.openExternal(url)
ctx.dialog.showOpenDialog(opts)
ctx.clipboard.readText()
ctx.clipboard.writeText(text)

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
await ctx.db.run('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT)')
// Runtime executes: CREATE TABLE IF NOT EXISTS miniapp_abc12345_notes (...)

await ctx.db.run('INSERT INTO notes (text) VALUES (?)', 'Hello')
const rows = await ctx.db.all('SELECT * FROM notes')
\`\`\`

---

## Panel Code

Same pattern as frontend — renders in the tray popup:

\`\`\`javascript
module.exports = function MyPanel({ ctx }) {
  const { useState, useEffect, icons } = ctx
  const { Activity } = icons
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    const off = ctx.ipc.on('status-changed', (d) => setStatus(d.status))
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

All accessed via \`ctx.ui.*\`. Available components:

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

### ❌ BANNED Tailwind Color Classes

**Never use any of these** — they break the dark theme:

\`\`\`
// ❌ BANNED — do NOT use any Tailwind named colors:
text-white  text-black  text-gray-*  text-zinc-*  text-slate-*  text-neutral-*
bg-white    bg-black    bg-gray-*    bg-zinc-*    bg-slate-*    bg-neutral-*
border-gray-*  border-zinc-*  border-slate-*
text-blue-*  text-green-*  text-red-*  text-yellow-*  (use CSS vars for semantic colors)

// ✅ CORRECT — always use CSS variable utilities:
text-[var(--color-ink)]
text-[var(--color-body)]
text-[var(--color-mute)]
bg-[var(--color-canvas)]
bg-[var(--color-canvas-soft)]
border-[var(--color-hairline)]
\`\`\`

### Typography Scale

Always follow this hierarchy — never deviate from it:

\`\`\`
Page / section title:  text-sm font-semibold text-[var(--color-ink)]
Card title:            text-[13px] font-semibold text-[var(--color-ink)]
Body text:             text-sm text-[var(--color-body)]
Secondary / label:     text-xs text-[var(--color-body)]
Caption / hint:        text-xs text-[var(--color-mute)]
Large metric/number:   text-xl font-bold text-[var(--color-ink-strong)]
Code / mono:           text-xs font-mono text-[var(--color-ink)]
\`\`\`

### Styling with Tailwind + CSS Variables

\`\`\`html
<!-- Card -->
<div className="bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] p-4">
  <h2 className="text-sm font-semibold text-[var(--color-ink)]">Title</h2>
  <p className="text-xs text-[var(--color-mute)]">Description</p>
</div>

<!-- Stat / metric card -->
<div className="bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] p-4">
  <p className="text-xs text-[var(--color-mute)] mb-1">Label</p>
  <p className="text-xl font-bold text-[var(--color-ink-strong)]">1,234</p>
</div>

<!-- Section header with action -->
<div className="flex items-center justify-between mb-4">
  <h2 className="text-sm font-semibold text-[var(--color-ink)]">Section Title</h2>
  <ui.Button size="small">Action</ui.Button>
</div>

<!-- List row -->
<div className="flex items-center gap-3 py-2.5 px-3 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] hover:border-[rgba(255,255,255,0.1)] transition-colors">
  <span className="flex-1 text-sm text-[var(--color-ink)]">Label</span>
  <span className="text-xs text-[var(--color-mute)]">Meta</span>
</div>
\`\`\`

### Common Spacing Patterns

\`\`\`
Root container:         p-6 (always — never flush to edges)
Between sections:       mb-6 or gap-6
Between cards in grid:  gap-3 or gap-4
Between list items:     gap-1.5 or gap-2
Inside card padding:    p-4
Inline icon + text gap: gap-2
\`\`\`

**Design rules:** Dark canvas only (#101010). Hairline borders, no shadows. Green accent for CTAs only. 6px radius for buttons, 8px for cards.

---

## Complete Example: Todo App

### frontendCode

\`\`\`javascript
module.exports = function TodoApp({ ctx }) {
  const { useState, useEffect, useCallback, icons, ui } = ctx
  const { CheckSquare, Plus, Trash2, ListTodo } = icons

  const [todos, setTodos] = useState([])
  const [text, setText] = useState('')

  useEffect(() => {
    const off = ctx.ipc.on('todos-loaded', (data) => setTodos(data ?? []))
    ctx.ipc.send('load-todos', {})
    return off
  }, [])

  const addTodo = useCallback(() => {
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
        <ui.Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTodo() }} placeholder="What needs to be done?" />
        <ui.Button type="primary" icon={<Plus size={14} />} onClick={addTodo}>Add</ui.Button>
      </div>

      {todos.length === 0 ? (
        <ui.Empty description="No todos yet" />
      ) : (
        <div className="flex flex-col gap-1.5">
          {todos.map((todo) => (
              <div key={todo.id} className="group flex items-center gap-3 py-2.5 px-3 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-lg hover:border-[rgba(255,255,255,0.12)] transition-all">
                <CheckSquare size={16} className={todo.done ? 'text-[var(--color-primary)]' : 'text-[var(--color-mute)]'} onClick={() => ctx.ipc.send('toggle-todo', { id: todo.id })} />
                <span className={'flex-1 text-sm ' + (todo.done ? 'line-through text-[var(--color-mute)]' : 'text-[var(--color-ink)]')}>{todo.text}</span>
                <Trash2 size={13} className="text-[var(--color-mute)] cursor-pointer opacity-0 group-hover:opacity-100 hover:text-[var(--color-error)] transition-all" onClick={() => ctx.ipc.send('delete-todo', { id: todo.id })} />
              </div>
          ))}
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

  const getTodos = () => {
    const raw = ctx.storage.get('todos')
    if (!raw) return []
    try { return JSON.parse(raw) } catch(e) { return [] }
  }

  const saveTodos = (todos) => {
    ctx.storage.set('todos', JSON.stringify(todos))
    ctx.ipc.send('todos-loaded', todos)
  }

  ctx.ipc.on('load-todos', () => ctx.ipc.send('todos-loaded', getTodos()))

  ctx.ipc.on('add-todo', (data) => {
    const todos = getTodos()
    todos.unshift({ id: Date.now(), text: data.text, done: false, createdAt: new Date().toISOString() })
    saveTodos(todos)
  })

  ctx.ipc.on('toggle-todo', (data) => {
    const todos = getTodos().map((t) => t.id === data.id ? { ...t, done: !t.done } : t)
    saveTodos(todos)
  })

  ctx.ipc.on('delete-todo', (data) => {
    saveTodos(getTodos().filter((t) => t.id !== data.id))
  })

  return () => ctx.log('Todo cleanup')
}
\`\`\`

### panelCode

\`\`\`javascript
module.exports = function TodoPanel({ ctx }) {
  const { useState, useEffect, icons } = ctx
  const { ListTodo } = icons
  const [count, setCount] = useState(0)

  useEffect(() => {
    const off = ctx.ipc.on('todos-loaded', (data) => {
      setCount((data ?? []).filter((t) => !t.done).length)
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

- [ ] **Layout: container has NO padding** — add \`p-6\` unless your app intentionally needs full-width
- [ ] \`module.exports = function\` pattern
- [ ] No import/export (only real restriction)
- [ ] **JSX syntax only** — do NOT use ctx.h() or React.createElement()
- [ ] Modern JS OK: const/let, =>, async/await, ?., ??, {...spread}
- [ ] Colors: CSS variables only (var(--color-*))
- [ ] Borders: var(--color-hairline)
- [ ] Radius: var(--radius-*)
- [ ] IPC cleanup in useEffect return
- [ ] Backend returns cleanup function
- [ ] Icon names: valid lucide-react PascalCase names
`
