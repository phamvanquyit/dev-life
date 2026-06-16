import childProcess from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import {
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  app as electronApp,
  ipcMain,
  Notification,
  screen,
  shell,
  systemPreferences,
} from 'electron'
import { getSqlite } from './db'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MiniAppRecord {
  id: string
  name: string
  description: string
  icon: string
  category: string
  version: string
  backend_code: string
  frontend_code: string
  panel_code: string | null
  enabled: number
  shortcut: string | null
  display_order: number
  created_at: string
  updated_at: string
}

interface MiniAppBackendInstance {
  appId: string
  cleanup?: () => void | Promise<void>
  timers: Set<ReturnType<typeof setTimeout>>
  intervals: Set<ReturnType<typeof setInterval>>
}

// ─── Runtime State ───────────────────────────────────────────────────────────

const loadedApps = new Map<string, MiniAppBackendInstance>()

// ─── IPC Message Bus ─────────────────────────────────────────────────────────
// Allows backend ↔ frontend communication per mini app

const ipcListeners = new Map<string, Map<string, Set<(data: any) => void>>>()

function getAppIpcBus(appId: string) {
  if (!ipcListeners.has(appId)) {
    ipcListeners.set(appId, new Map())
  }
  const appBus = ipcListeners.get(appId)!

  return {
    on(channel: string, handler: (data: any) => void) {
      if (!appBus.has(channel)) appBus.set(channel, new Set())
      appBus.get(channel)!.add(handler)
      return () => {
        appBus.get(channel)?.delete(handler)
      }
    },
    send(channel: string, data: any) {
      // Send to renderer via IPC
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('miniapp:ipc-message', { appId, channel, data })
      }
    },
    emit(channel: string, data: any) {
      // Emit to backend listeners (called when frontend sends message)
      const handlers = appBus.get(channel)
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(data)
          } catch (e) {
            console.error(`[miniapp:${appId}] IPC handler error on "${channel}":`, e)
          }
        }
      }
    },
    cleanup() {
      appBus.clear()
      ipcListeners.delete(appId)
    },
  }
}

// ─── Config Helpers ──────────────────────────────────────────────────────────

interface ConfigFieldSchema {
  type: 'string' | 'number' | 'boolean'
  label: string
  default?: any
  required?: boolean
  description?: string
}

interface ConfigSchema {
  [key: string]: ConfigFieldSchema
}

function getAppConfigSchema(appId: string): ConfigSchema | null {
  const storage = getAppStorage(appId)
  const raw = storage.get('__config_schema__')
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function getAppConfigValues(appId: string): Record<string, any> {
  const storage = getAppStorage(appId)
  const all = storage.getAll()
  const values: Record<string, any> = {}
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('config::')) {
      const configKey = key.slice('config::'.length)
      try {
        values[configKey] = JSON.parse(value)
      } catch {
        values[configKey] = value
      }
    }
  }
  return values
}

function validateRequiredConfigs(appId: string): string[] {
  const schema = getAppConfigSchema(appId)
  if (!schema) return []
  const values = getAppConfigValues(appId)
  const missing: string[] = []
  for (const [key, field] of Object.entries(schema)) {
    if (
      field.required &&
      (values[key] === undefined || values[key] === null || values[key] === '')
    ) {
      missing.push(field.label || key)
    }
  }
  return missing
}

function saveConfigSchemaAndDefaults(appId: string, configSchema: ConfigSchema): void {
  const storage = getAppStorage(appId)
  storage.set('__config_schema__', JSON.stringify(configSchema))
  // Save default values (only if no existing value)
  for (const [key, field] of Object.entries(configSchema)) {
    if (field.default !== undefined) {
      const existing = storage.get(`config::${key}`)
      if (existing === null) {
        storage.set(`config::${key}`, JSON.stringify(field.default))
      }
    }
  }
}

// ─── Scoped Storage ──────────────────────────────────────────────────────────

function getAppStorage(appId: string) {
  const sqlite = getSqlite()

  return {
    get(key: string): string | null {
      const row = sqlite
        .prepare('SELECT value FROM mini_app_storage WHERE app_id = ? AND key = ?')
        .get(appId, key) as { value: string } | undefined
      return row?.value ?? null
    },
    set(key: string, value: string): void {
      sqlite
        .prepare(
          `INSERT INTO mini_app_storage (app_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(app_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        )
        .run(appId, key, value)
    },
    delete(key: string): void {
      sqlite.prepare('DELETE FROM mini_app_storage WHERE app_id = ? AND key = ?').run(appId, key)
    },
    getAll(): Record<string, string> {
      const rows = sqlite
        .prepare('SELECT key, value FROM mini_app_storage WHERE app_id = ?')
        .all(appId) as { key: string; value: string }[]
      const result: Record<string, string> = {}
      for (const row of rows) {
        result[row.key] = row.value
      }
      return result
    },
    clear(): void {
      sqlite.prepare('DELETE FROM mini_app_storage WHERE app_id = ?').run(appId)
    },
  }
}

// ─── Scoped DB Helper ────────────────────────────────────────────────────────

/**
 * Auto-prefix table names in SQL with a mini app's scoped prefix.
 * This ensures mini apps can only access their own tables.
 * e.g. "CREATE TABLE notes ..." → "CREATE TABLE miniapp_abc12345_notes ..."
 */
function prefixTables(sql: string, prefix: string): string {
  // Match table names after SQL keywords (case-insensitive)
  // Handles: FROM, INTO, TABLE, UPDATE, JOIN, and IF NOT EXISTS / IF EXISTS variants
  return sql.replace(
    /\b(FROM|INTO|TABLE|UPDATE|JOIN)\s+(IF\s+(?:NOT\s+)?EXISTS\s+)?([`"]?)(\w+)\3/gi,
    (_match, keyword, ifClause, quote, tableName) => {
      // Skip if already prefixed
      if (tableName.startsWith(prefix)) {
        return `${keyword} ${ifClause || ''}${quote}${tableName}${quote}`
      }
      return `${keyword} ${ifClause || ''}${quote}${prefix}${tableName}${quote}`
    },
  )
}

// ─── Backend Code Loader ─────────────────────────────────────────────────────

function loadBackendCode(app: MiniAppRecord): MiniAppBackendInstance {
  const appId = app.id
  const timerIds = new Set<ReturnType<typeof setTimeout>>()
  const intervalIds = new Set<ReturnType<typeof setInterval>>()

  if (!app.backend_code || app.backend_code.trim() === '') {
    return { appId, timers: timerIds, intervals: intervalIds }
  }

  try {
    const ipcBus = getAppIpcBus(appId)
    const storage = getAppStorage(appId)

    // Build a scoped DB proxy — mini apps can only use tables prefixed with miniapp_{short_id}_
    const shortId = appId.slice(0, 8)
    const tablePrefix = `miniapp_${shortId}_`
    const sqlite = getSqlite()

    const scopedDb = {
      /**
       * Run a query (INSERT, UPDATE, DELETE, CREATE TABLE, etc.)
       * Table names are auto-prefixed with miniapp_{id}_
       */
      run(sql: string, ...params: any[]) {
        const safeSql = prefixTables(sql, tablePrefix)
        return sqlite.prepare(safeSql).run(...params)
      },
      /**
       * Query a single row
       */
      get(sql: string, ...params: any[]) {
        const safeSql = prefixTables(sql, tablePrefix)
        return sqlite.prepare(safeSql).get(...params)
      },
      /**
       * Query all rows
       */
      all(sql: string, ...params: any[]) {
        const safeSql = prefixTables(sql, tablePrefix)
        return sqlite.prepare(safeSql).all(...params)
      },
      /** The table prefix used for this mini app */
      tablePrefix,
    }

    // Build config object from storage
    const appConfig = getAppConfigValues(appId)

    // Build context object for the mini app backend
    const miniAppRequire = createRequire(import.meta.url)
    const ctx = {
      appId,
      log: (...args: any[]) => {
        console.log(`[miniapp:${app.name}]`, ...args)
        // Pipe to renderer for the logs panel
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('miniapp:log', {
            appId,
            appName: app.name,
            timestamp: Date.now(),
            args: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))),
          })
        }
      },
      ipc: ipcBus,
      storage,
      db: scopedDb,
      // ─── Mini App Config (from manifest) ────────────────────────────
      config: appConfig,
      // ─── Node.js APIs ──────────────────────────────────────────────
      require: miniAppRequire,
      fs,
      path,
      os,
      crypto,
      childProcess,
      // ─── Electron APIs ─────────────────────────────────────────────
      shell, // shell.openExternal(), shell.openPath(), etc.
      dialog, // dialog.showOpenDialog(), dialog.showSaveDialog(), etc.
      clipboard, // clipboard.readText(), clipboard.writeText(), etc.
      desktopCapturer, // desktopCapturer.getSources() — for screen recording
      screen, // screen.getPrimaryDisplay(), screen.getAllDisplays(), etc.
      Notification, // new Notification({ title, body }).show()
      systemPreferences, // systemPreferences.getMediaAccessStatus('microphone')
      // ─── Utilities ─────────────────────────────────────────────────
      fetch: globalThis.fetch, // Native fetch (Node 18+)
      appPath: electronApp.getPath('userData'),
      homePath: os.homedir(),
      tmpPath: os.tmpdir(),
      // ─── Timers (auto-cleanup on unload) ────────────────────────────
      setTimeout: (fn: () => void, ms: number) => {
        const id = setTimeout(() => {
          try {
            fn()
          } catch (e) {
            console.error(`[miniapp:${app.name}] Timer error:`, e)
          }
        }, ms)
        timerIds.add(id)
        return id
      },
      setInterval: (fn: () => void, ms: number) => {
        const id = setInterval(() => {
          try {
            fn()
          } catch (e) {
            console.error(`[miniapp:${app.name}] Interval error:`, e)
          }
        }, ms)
        intervalIds.add(id)
        return id
      },
      clearTimeout: (id: ReturnType<typeof setTimeout>) => {
        clearTimeout(id)
        timerIds.delete(id)
      },
      clearInterval: (id: ReturnType<typeof setInterval>) => {
        clearInterval(id)
        intervalIds.delete(id)
      },
    }

    // Evaluate the backend code
    // The code should be: module.exports = function setup(ctx) { ... }
    const moduleObj = { exports: {} as any }
    const wrappedCode = `(function(module, exports, ctx) { ${app.backend_code} \n})`
    const fn = new Function(`return ${wrappedCode}`)()
    fn(moduleObj, moduleObj.exports, ctx)

    // If module.exports is a function, call it as setup(ctx)
    let cleanup: (() => void | Promise<void>) | undefined
    if (typeof moduleObj.exports === 'function') {
      const result = moduleObj.exports(ctx)
      if (typeof result === 'function') {
        cleanup = result
      }
    }

    console.log(`[miniapp] ✅ Backend loaded: ${app.name}`)
    return { appId, cleanup, timers: timerIds, intervals: intervalIds }
  } catch (e) {
    console.error(`[miniapp] ❌ Backend load failed for "${app.name}":`, e)
    // Auto-disable the mini app to prevent repeated crashes
    try {
      const sqlite = getSqlite()
      sqlite
        .prepare("UPDATE mini_apps SET enabled = 0, updated_at = datetime('now') WHERE id = ?")
        .run(appId)
      console.warn(`[miniapp] ⚠️ Auto-disabled "${app.name}" due to backend error`)
    } catch (_disableErr) {
      // Ignore — best effort
    }
    // Clean up any timers that were created before the error
    for (const t of timerIds) clearTimeout(t)
    for (const i of intervalIds) clearInterval(i)
    return { appId, timers: new Set(), intervals: new Set() }
  }
}

async function unloadBackendCode(appId: string): Promise<void> {
  const instance = loadedApps.get(appId)
  if (instance) {
    try {
      await instance.cleanup?.()
    } catch (e) {
      console.error(`[miniapp] Cleanup error for ${appId}:`, e)
    }
    // Clean up all tracked timers
    for (const t of instance.timers) clearTimeout(t)
    for (const i of instance.intervals) clearInterval(i)
    instance.timers.clear()
    instance.intervals.clear()
    // Clean up IPC bus
    getAppIpcBus(appId).cleanup()
    loadedApps.delete(appId)
    console.log(`[miniapp] Unloaded backend: ${appId}`)
  }
}

// ─── DB Operations ───────────────────────────────────────────────────────────

function listMiniApps(): MiniAppRecord[] {
  const sqlite = getSqlite()
  return sqlite
    .prepare('SELECT * FROM mini_apps ORDER BY display_order ASC, created_at ASC')
    .all() as MiniAppRecord[]
}

function getMiniApp(id: string): MiniAppRecord | null {
  const sqlite = getSqlite()
  return (sqlite.prepare('SELECT * FROM mini_apps WHERE id = ?').get(id) as MiniAppRecord) || null
}

function createMiniApp(data: {
  name: string
  description?: string
  icon?: string
  category?: string
  version?: string
  backendCode?: string
  frontendCode?: string
  panelCode?: string | null
  enabled?: boolean
}): MiniAppRecord {
  const sqlite = getSqlite()
  const id = crypto.randomBytes(8).toString('hex')
  const now = new Date().toISOString()

  // Get next display_order
  const maxOrder = sqlite
    .prepare('SELECT MAX(display_order) as max_order FROM mini_apps')
    .get() as { max_order: number | null }
  const order = (maxOrder?.max_order ?? -1) + 1

  const enabled = data.enabled !== undefined ? (data.enabled ? 1 : 0) : 0

  sqlite
    .prepare(
      `INSERT INTO mini_apps (id, name, description, icon, category, version, backend_code, frontend_code, panel_code, enabled, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      data.name,
      data.description || '',
      data.icon || 'Box',
      data.category || 'Custom',
      data.version || '1.0.0',
      data.backendCode || '',
      data.frontendCode || '',
      data.panelCode ?? null,
      enabled,
      order,
      now,
      now,
    )

  const app = getMiniApp(id)!

  // Load backend if enabled
  if (app.enabled) {
    const instance = loadBackendCode(app)
    loadedApps.set(id, instance)
  }

  return app
}

async function updateMiniApp(
  id: string,
  data: {
    name?: string
    description?: string
    icon?: string
    category?: string
    version?: string
    backendCode?: string
    frontendCode?: string
    panelCode?: string | null
    enabled?: boolean
    displayOrder?: number
  },
): Promise<MiniAppRecord | null> {
  const sqlite = getSqlite()
  const existing = getMiniApp(id)
  if (!existing) return null

  const fields: string[] = []
  const values: any[] = []

  if (data.name !== undefined) {
    fields.push('name = ?')
    values.push(data.name)
  }
  if (data.description !== undefined) {
    fields.push('description = ?')
    values.push(data.description)
  }
  if (data.icon !== undefined) {
    fields.push('icon = ?')
    values.push(data.icon)
  }
  if (data.category !== undefined) {
    fields.push('category = ?')
    values.push(data.category)
  }
  if (data.version !== undefined) {
    fields.push('version = ?')
    values.push(data.version)
  }
  if (data.backendCode !== undefined) {
    fields.push('backend_code = ?')
    values.push(data.backendCode)
  }
  if (data.frontendCode !== undefined) {
    fields.push('frontend_code = ?')
    values.push(data.frontendCode)
  }
  if (data.panelCode !== undefined) {
    fields.push('panel_code = ?')
    values.push(data.panelCode)
  }
  if (data.enabled !== undefined) {
    fields.push('enabled = ?')
    values.push(data.enabled ? 1 : 0)
  }
  if (data.displayOrder !== undefined) {
    fields.push('display_order = ?')
    values.push(data.displayOrder)
  }

  if (fields.length === 0) return existing

  fields.push("updated_at = datetime('now')")
  values.push(id)

  sqlite.prepare(`UPDATE mini_apps SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  const updated = getMiniApp(id)!

  // Reload backend if code changed or enabled state changed
  const backendChanged = data.backendCode !== undefined
  const enabledChanged = data.enabled !== undefined

  if (backendChanged || enabledChanged) {
    await unloadBackendCode(id)
    if (updated.enabled) {
      const instance = loadBackendCode(updated)
      loadedApps.set(id, instance)
    }
  }

  return updated
}

async function deleteMiniApp(id: string): Promise<boolean> {
  const sqlite = getSqlite()
  await unloadBackendCode(id)

  // Storage will cascade delete due to FK constraint
  const result = sqlite.prepare('DELETE FROM mini_apps WHERE id = ?').run(id)
  return result.changes > 0
}

async function toggleMiniApp(
  id: string,
): Promise<{ app: MiniAppRecord | null; missingConfigs?: string[] }> {
  const app = getMiniApp(id)
  if (!app) return { app: null }

  // If trying to enable, validate required configs
  if (!app.enabled) {
    const missing = validateRequiredConfigs(id)
    if (missing.length > 0) {
      return { app: null, missingConfigs: missing }
    }
  }

  const updated = await updateMiniApp(id, { enabled: !app.enabled })
  return { app: updated }
}

// ─── ZIP Import / Export ─────────────────────────────────────────────────────

async function importFromZipBuffer(buffer: Buffer): Promise<MiniAppRecord> {
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()

  // Find manifest.json
  const manifestEntry = entries.find(
    (e) => e.entryName === 'manifest.json' || e.entryName.endsWith('/manifest.json'),
  )
  if (!manifestEntry) {
    throw new Error('Invalid mini app: missing manifest.json')
  }

  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'))
  if (!manifest.name) {
    throw new Error('Invalid manifest: missing name')
  }

  // Helper to find and read a file from the zip
  const readFile = (filename: string): string => {
    const entry = entries.find(
      (e) => e.entryName === filename || e.entryName.endsWith(`/${filename}`),
    )
    return entry ? entry.getData().toString('utf8') : ''
  }

  const frontendCode = readFile('frontend.js')
  const backendCode = readFile('backend.js')
  const panelCode = readFile('panel.js')

  if (!frontendCode && !backendCode) {
    throw new Error('Invalid mini app: must have at least frontend.js or backend.js')
  }

  // Check for existing app with same name → update instead of create
  const existing = listMiniApps().find((a) => a.name === manifest.name)
  if (existing) {
    const updated = await updateMiniApp(existing.id, {
      description: manifest.description || existing.description,
      icon: manifest.icon || existing.icon,
      category: manifest.category || existing.category,
      version: manifest.version || existing.version,
      backendCode,
      frontendCode,
      panelCode: panelCode || null,
    })
    if (updated) {
      // Save/update config schema if present
      if (manifest.config && typeof manifest.config === 'object') {
        saveConfigSchemaAndDefaults(existing.id, manifest.config)
      }
      ;(updated as any)._updated = true
      return updated
    }
  }

  const app = createMiniApp({
    name: manifest.name,
    description: manifest.description || '',
    icon: manifest.icon || 'Box',
    category: manifest.category || 'Custom',
    version: manifest.version || '1.0.0',
    enabled: false,
    backendCode,
    frontendCode,
    panelCode: panelCode || null,
  })

  // Save config schema and defaults
  if (manifest.config && typeof manifest.config === 'object') {
    saveConfigSchemaAndDefaults(app.id, manifest.config)
  }

  return app
}

function exportToZipBuffer(id: string): Buffer | null {
  const app = getMiniApp(id)
  if (!app) return null

  const zip = new AdmZip()

  // manifest.json
  const configSchema = getAppConfigSchema(id)
  const manifestObj: any = {
    name: app.name,
    version: app.version,
    icon: app.icon,
    category: app.category,
    description: app.description,
  }
  if (configSchema) {
    manifestObj.config = configSchema
  }
  const manifest = JSON.stringify(manifestObj, null, 2)
  zip.addFile('manifest.json', Buffer.from(manifest, 'utf8'))

  // Code files (only add if non-empty)
  if (app.frontend_code) {
    zip.addFile('frontend.js', Buffer.from(app.frontend_code, 'utf8'))
  }
  if (app.backend_code) {
    zip.addFile('backend.js', Buffer.from(app.backend_code, 'utf8'))
  }
  if (app.panel_code) {
    zip.addFile('panel.js', Buffer.from(app.panel_code, 'utf8'))
  }

  return zip.toBuffer()
}

async function importFromDirectory(dirPath: string): Promise<MiniAppRecord> {
  const manifestPath = path.join(dirPath, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Invalid mini app directory: missing manifest.json in ${dirPath}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!manifest.name) {
    throw new Error('Invalid manifest: missing name')
  }

  const readIfExists = (filename: string): string => {
    const filePath = path.join(dirPath, filename)
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  }

  const frontendCode = readIfExists('frontend.js')
  const backendCode = readIfExists('backend.js')
  const panelCode = readIfExists('panel.js')

  if (!frontendCode && !backendCode) {
    throw new Error('Invalid mini app: must have at least frontend.js or backend.js')
  }

  // Check for existing app with same name → update instead of create
  const existing = listMiniApps().find((a) => a.name === manifest.name)
  if (existing) {
    const updated = await updateMiniApp(existing.id, {
      description: manifest.description || existing.description,
      icon: manifest.icon || existing.icon,
      category: manifest.category || existing.category,
      version: manifest.version || existing.version,
      backendCode,
      frontendCode,
      panelCode: panelCode || null,
    })
    if (updated) {
      // Save/update config schema if present
      if (manifest.config && typeof manifest.config === 'object') {
        saveConfigSchemaAndDefaults(existing.id, manifest.config)
      }
      ;(updated as any)._updated = true
      return updated
    }
  }

  const app = createMiniApp({
    name: manifest.name,
    description: manifest.description || '',
    icon: manifest.icon || 'Box',
    category: manifest.category || 'Custom',
    version: manifest.version || '1.0.0',
    enabled: false,
    backendCode,
    frontendCode,
    panelCode: panelCode || null,
  })

  // Save config schema and defaults
  if (manifest.config && typeof manifest.config === 'object') {
    saveConfigSchemaAndDefaults(app.id, manifest.config)
  }

  return app
}

// ─── Load All Enabled Apps on Startup ────────────────────────────────────────

function seedSampleApps(): void {
  try {
    createMiniApp({
      name: 'Quick Note',
      description: 'Demo mini app — frontend, backend & panel working together',
      icon: 'StickyNote',
      category: 'Productivity',
      version: '1.0.0',
      enabled: true,

      // ── Backend: handles save/load via storage, tracks stats ───────
      backendCode: `module.exports = function setup(ctx) {
  ctx.log('Quick Note backend loaded')

  function getNotes() {
    var raw = ctx.storage.get('notes')
    if (!raw) return []
    try { return JSON.parse(raw) } catch (e) { return [] }
  }

  ctx.ipc.on('load-notes', function () {
    ctx.ipc.send('notes-loaded', getNotes())
  })

  ctx.ipc.on('save-note', function (data) {
    var notes = getNotes()
    notes.unshift({
      id: Date.now(),
      text: data.text,
      createdAt: new Date().toISOString()
    })
    if (notes.length > 50) notes = notes.slice(0, 50)
    ctx.storage.set('notes', JSON.stringify(notes))
    ctx.ipc.send('notes-loaded', notes)
    ctx.ipc.send('stats-updated', { total: notes.length, lastSaved: new Date().toISOString() })
  })

  ctx.ipc.on('delete-note', function (data) {
    var notes = getNotes().filter(function (n) { return n.id !== data.id })
    ctx.storage.set('notes', JSON.stringify(notes))
    ctx.ipc.send('notes-loaded', notes)
    ctx.ipc.send('stats-updated', { total: notes.length })
  })

  ctx.ipc.on('get-stats', function () {
    var notes = getNotes()
    ctx.ipc.send('stats-updated', { total: notes.length })
  })

  return function () { ctx.log('Quick Note cleanup') }
}
`,

      // ── Frontend: main UI with input + notes list ─────────────────
      frontendCode: `module.exports = function QuickNote({ ctx }) {
  var { useState, useEffect, useCallback, icons } = ctx
  var { StickyNote, Plus, Trash2, Copy, FileText } = icons

  var [notes, setNotes] = useState([])
  var [text, setText] = useState('')

  useEffect(function () {
    var off = ctx.ipc.on('notes-loaded', function (data) { setNotes(data || []) })
    ctx.ipc.send('load-notes', {})
    return off
  }, [])

  var addNote = useCallback(function () {
    if (!text.trim()) return
    ctx.ipc.send('save-note', { text: text.trim() })
    setText('')
  }, [text])

  var deleteNote = useCallback(function (id) {
    ctx.ipc.send('delete-note', { id: id })
  }, [])

  var copyNote = useCallback(function (t) {
    navigator.clipboard.writeText(t)
  }, [])

  function timeAgo(dateStr) {
    var diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
    return Math.floor(diff / 86400) + 'd ago'
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 flex items-center justify-center">
          <StickyNote size={18} className="text-[var(--color-primary)]" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--color-ink)] leading-tight">Quick Note</h2>
          <p className="text-xs text-[var(--color-mute)]">Demo: frontend \\u2194 backend \\u2194 panel</p>
        </div>
        <span className="ml-auto text-[9px] font-semibold uppercase tracking-[2px] px-2 py-0.5 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 text-[var(--color-primary)]">
          SAMPLE APP
        </span>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          value={text}
          onChange={function (e) { setText(e.target.value) }}
          onKeyDown={function (e) { if (e.key === 'Enter') addNote() }}
          placeholder="Type a note and press Enter..."
          className="flex-1 h-9 px-3 text-sm bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-mute)] focus:border-[var(--color-primary)] transition-colors"
        />
        <button
          type="button"
          onClick={addNote}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-semibold bg-[var(--color-primary)] text-[var(--color-on-primary)] border-none rounded-[var(--radius-sm)] cursor-pointer hover:opacity-90 transition-all"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileText size={32} className="text-[var(--color-hairline)] mb-3" />
          <span className="text-xs text-[var(--color-mute)]">No notes yet</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {notes.map(function (note) {
            return (
              <div key={note.id} className="group flex items-start gap-2 py-2.5 px-3 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-lg transition-all hover:border-[rgba(255,255,255,0.12)]">
                <span className="flex-1 text-sm text-[var(--color-ink)] break-all leading-relaxed">{note.text}</span>
                <span className="text-[9px] text-[var(--color-mute)] shrink-0 pt-1">{timeAgo(note.createdAt)}</span>
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Copy
                    size={12}
                    className="text-[var(--color-mute)] cursor-pointer p-[3px] rounded hover:text-[var(--color-primary)] hover:bg-[rgba(0,217,146,0.1)]"
                    onClick={function () { copyNote(note.text) }}
                  />
                  <Trash2
                    size={12}
                    className="text-[var(--color-mute)] cursor-pointer p-[3px] rounded hover:text-[#ef4444] hover:bg-[rgba(239,68,68,0.1)]"
                    onClick={function () { deleteNote(note.id) }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
`,

      // ── Panel: shows stats from backend ───────────────────────────
      panelCode: `module.exports = function QuickNotePanel({ ctx }) {
  var { useState, useEffect, icons } = ctx
  var { StickyNote, Clock } = icons

  var [stats, setStats] = useState({ total: 0, lastSaved: null })

  useEffect(function () {
    var off = ctx.ipc.on('stats-updated', function (data) {
      setStats(function (prev) { return Object.assign({}, prev, data) })
    })
    ctx.ipc.send('get-stats', {})
    return off
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-[var(--color-hairline)]">
        <span className="text-[10px] font-semibold uppercase tracking-[2.52px] text-[var(--color-mute)]">QUICK NOTE</span>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)]">
          <StickyNote size={14} className="text-[var(--color-primary)]" />
          <span className="text-xs text-[var(--color-body)]">Total Notes</span>
          <span className="ml-auto text-xs font-semibold px-1.5 py-0 rounded-[var(--radius-xs)] border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            {String(stats.total)}
          </span>
        </div>
        {stats.lastSaved ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)]">
            <Clock size={14} className="text-[var(--color-mute)]" />
            <span className="text-xs text-[var(--color-body)]">Last Saved</span>
            <span className="ml-auto text-[10px] text-[var(--color-mute)]">{new Date(stats.lastSaved).toLocaleTimeString()}</span>
          </div>
        ) : null}
        <div className="mt-4 p-3 rounded-lg border border-dashed border-[var(--color-hairline)]">
          <p className="text-[10px] text-[var(--color-mute)] leading-relaxed">
            This panel receives real-time stats from the backend via ctx.ipc.
          </p>
        </div>
      </div>
    </div>
  )
}
`,
    })
    console.log('[miniapp] Seeded sample "Quick Note"')
  } catch (e) {
    console.error('[miniapp] Failed to seed sample app:', e)
  }
}

export function loadAllMiniApps(): void {
  let apps = listMiniApps()

  // Seed sample apps on first run
  if (apps.length === 0) {
    seedSampleApps()
    apps = listMiniApps()
  }

  let loaded = 0
  for (const app of apps) {
    if (app.enabled) {
      const instance = loadBackendCode(app)
      loadedApps.set(app.id, instance)
      loaded++
    }
  }
  if (apps.length > 0) {
    console.log(`[miniapp] Loaded ${loaded}/${apps.length} mini apps`)
  }
}

export async function unloadAllMiniApps(): Promise<void> {
  const promises: Promise<void>[] = []
  for (const appId of loadedApps.keys()) {
    promises.push(unloadBackendCode(appId))
  }
  await Promise.allSettled(promises)
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

export function setupMiniAppIPC(): void {
  ipcMain.handle('miniapp:list', () => {
    return listMiniApps().map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      icon: app.icon,
      category: app.category,
      version: app.version,
      enabled: !!app.enabled,
      shortcut: app.shortcut,
      displayOrder: app.display_order,
      hasBackend: !!app.backend_code,
      hasFrontend: !!app.frontend_code,
      hasPanel: !!app.panel_code,
      createdAt: app.created_at,
      updatedAt: app.updated_at,
    }))
  })

  ipcMain.handle('miniapp:get', (_event, id: string) => {
    const app = getMiniApp(id)
    if (!app) return null
    return {
      id: app.id,
      name: app.name,
      description: app.description,
      icon: app.icon,
      category: app.category,
      version: app.version,
      backendCode: app.backend_code,
      frontendCode: app.frontend_code,
      panelCode: app.panel_code,
      enabled: !!app.enabled,
      shortcut: app.shortcut,
      displayOrder: app.display_order,
      createdAt: app.created_at,
      updatedAt: app.updated_at,
    }
  })

  ipcMain.handle('miniapp:create', (_event, data) => {
    const app = createMiniApp(data)
    return { success: true, id: app.id }
  })

  ipcMain.handle('miniapp:update', async (_event, id: string, data) => {
    const app = await updateMiniApp(id, data)
    return { success: !!app }
  })

  ipcMain.handle('miniapp:delete', async (_event, id: string) => {
    const success = await deleteMiniApp(id)
    return { success }
  })

  ipcMain.handle('miniapp:toggle', async (_event, id: string) => {
    const result = await toggleMiniApp(id)
    if (result.missingConfigs) {
      return { success: false, missingConfigs: result.missingConfigs }
    }
    return { success: !!result.app, enabled: result.app ? !!result.app.enabled : false }
  })

  ipcMain.handle('miniapp:import-zip', async (_event, buffer: Buffer) => {
    try {
      const app = await importFromZipBuffer(Buffer.from(buffer))
      const updated = !!(app as any)._updated
      return { success: true, id: app.id, updated }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('miniapp:import-directory', async (_event, dirPath: string) => {
    try {
      const app = await importFromDirectory(dirPath)
      const updated = !!(app as any)._updated
      return { success: true, id: app.id, updated }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('miniapp:export', (_event, id: string) => {
    const buffer = exportToZipBuffer(id)
    if (!buffer) return { success: false, error: 'App not found' }
    // Return as Uint8Array for IPC transfer
    return { success: true, data: buffer }
  })

  // Frontend → Backend IPC message relay
  ipcMain.handle('miniapp:send-ipc', (_event, appId: string, channel: string, data: any) => {
    try {
      const bus = getAppIpcBus(appId)
      bus.emit(channel, data)
      return { success: true }
    } catch (e: any) {
      console.error(`[miniapp] IPC relay error for ${appId}/${channel}:`, e)
      return { success: false, error: e.message }
    }
  })

  // Storage API for frontend
  ipcMain.handle('miniapp:storage-get', (_event, appId: string, key: string) => {
    try {
      return getAppStorage(appId).get(key)
    } catch (e: any) {
      console.error(`[miniapp] Storage get error for ${appId}:`, e)
      return null
    }
  })

  ipcMain.handle('miniapp:storage-set', (_event, appId: string, key: string, value: string) => {
    try {
      getAppStorage(appId).set(key, value)
      return { success: true }
    } catch (e: any) {
      console.error(`[miniapp] Storage set error for ${appId}:`, e)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('miniapp:storage-delete', (_event, appId: string, key: string) => {
    try {
      getAppStorage(appId).delete(key)
      return { success: true }
    } catch (e: any) {
      console.error(`[miniapp] Storage delete error for ${appId}:`, e)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('miniapp:storage-get-all', (_event, appId: string) => {
    try {
      return getAppStorage(appId).getAll()
    } catch (e: any) {
      console.error(`[miniapp] Storage getAll error for ${appId}:`, e)
      return {}
    }
  })

  // ─── Media APIs for frontend ─────────────────────────────────────────────
  ipcMain.handle('miniapp:get-desktop-sources', async (_event, opts?: any) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: opts?.types || ['screen', 'window'],
        thumbnailSize: opts?.thumbnailSize || { width: 320, height: 180 },
      })
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        display_id: s.display_id,
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
      }))
    } catch (e: any) {
      console.error('[miniapp] desktopCapturer error:', e)
      return []
    }
  })

  ipcMain.handle('miniapp:get-media-access', (_event, mediaType: string) => {
    try {
      return systemPreferences.getMediaAccessStatus(mediaType as any)
    } catch {
      return 'unknown'
    }
  })

  ipcMain.handle('miniapp:ask-media-access', async (_event, mediaType: string) => {
    try {
      return await systemPreferences.askForMediaAccess(mediaType as any)
    } catch {
      return false
    }
  })

  // ─── Notification API for frontend ───────────────────────────────────────
  ipcMain.handle(
    'miniapp:notify',
    (_event, opts: { title: string; body?: string; silent?: boolean }) => {
      try {
        const notif = new Notification({
          title: opts.title,
          body: opts.body || '',
          silent: opts.silent ?? false,
        })
        notif.show()
        return { success: true }
      } catch (e: any) {
        console.error('[miniapp] Notification error:', e)
        return { success: false, error: e.message }
      }
    },
  )

  // ─── Config API ────────────────────────────────────────────────────────────
  ipcMain.handle('miniapp:get-config', (_event, appId: string) => {
    try {
      const schema = getAppConfigSchema(appId)
      const values = getAppConfigValues(appId)
      return { success: true, schema, values }
    } catch (e: any) {
      console.error(`[miniapp] Config get error for ${appId}:`, e)
      return { success: false, schema: null, values: {} }
    }
  })

  ipcMain.handle('miniapp:set-config', (_event, appId: string, key: string, value: any) => {
    try {
      const storage = getAppStorage(appId)
      storage.set(`config::${key}`, JSON.stringify(value))
      return { success: true }
    } catch (e: any) {
      console.error(`[miniapp] Config set error for ${appId}:`, e)
      return { success: false, error: e.message }
    }
  })
}
