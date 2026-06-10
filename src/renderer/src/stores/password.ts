import { create } from 'zustand'

interface BrowserInfo {
  url: string
  domain: string
  browser: string
}

interface HistoryEntry {
  id: number
  password: string
  domain: string
  url: string
  browser: string
  created_at: string
}

interface PasswordGeneratorState {
  // Generator settings
  length: number
  count: number
  options: {
    uppercase: boolean
    lowercase: boolean
    numbers: boolean
    symbols: boolean
  }

  // Generated passwords
  passwords: string[]

  // Browser detection
  browserInfo: BrowserInfo | null
  detecting: boolean

  // History
  history: HistoryEntry[]
  historyLoaded: boolean

  // Actions - settings
  setLength: (length: number) => void
  setCount: (count: number) => void
  toggleOption: (key: 'uppercase' | 'lowercase' | 'numbers' | 'symbols') => void

  // Actions - core
  generate: () => Promise<void>
  copyPassword: (pw: string) => void
  copyAll: () => void

  // Actions - history
  loadHistory: () => Promise<void>
  deleteHistoryEntry: (id: number) => Promise<void>
  clearHistory: () => Promise<void>
}

const CHARS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
}

function createPassword(length: number, options: Record<string, boolean>): string {
  let charset = ''
  if (options.uppercase) charset += CHARS.uppercase
  if (options.lowercase) charset += CHARS.lowercase
  if (options.numbers) charset += CHARS.numbers
  if (options.symbols) charset += CHARS.symbols
  if (!charset) charset = CHARS.lowercase

  const array = new Uint32Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (v) => charset[v % charset.length]).join('')
}

export const usePasswordStore = create<PasswordGeneratorState>((set, get) => ({
  // Defaults
  length: 16,
  count: 5,
  options: { uppercase: true, lowercase: true, numbers: true, symbols: true },
  passwords: [],
  browserInfo: null,
  detecting: false,
  history: [],
  historyLoaded: false,

  // Settings
  setLength: (length) => set({ length }),
  setCount: (count) => set({ count }),
  toggleOption: (key) => set((s) => ({ options: { ...s.options, [key]: !s.options[key] } })),

  // Generate + auto-detect + save to history
  generate: async () => {
    const { length, count, options } = get()

    set({ detecting: true })

    // Auto-detect browser
    let detected: BrowserInfo | null = null
    try {
      detected = await window.api.getActiveBrowserURL()
    } catch {
      // ignore
    }

    // Generate passwords
    const passwords = Array.from({ length: count }, () => createPassword(length, options))

    set({ passwords, browserInfo: detected, detecting: false })

    // Save to history in background
    try {
      const entries = passwords.map((pw) => ({
        password: pw,
        domain: detected?.domain ?? '',
        url: detected?.url ?? '',
        browser: detected?.browser ?? '',
      }))
      const updated = await window.api.savePasswordHistory(entries)
      set({ history: updated as HistoryEntry[] })
    } catch {
      // ignore
    }
  },

  copyPassword: (pw) => {
    navigator.clipboard.writeText(pw)
  },

  copyAll: () => {
    const { passwords } = get()
    navigator.clipboard.writeText(passwords.join('\n'))
  },

  // History
  loadHistory: async () => {
    try {
      const history = await window.api.getPasswordHistory()
      set({ history: history as HistoryEntry[], historyLoaded: true })
    } catch {
      set({ historyLoaded: true })
    }
  },

  deleteHistoryEntry: async (id) => {
    try {
      const updated = await window.api.deletePasswordHistory(id)
      set({ history: updated as HistoryEntry[] })
    } catch {
      // ignore
    }
  },

  clearHistory: async () => {
    try {
      await window.api.clearPasswordHistory()
      set({ history: [] })
    } catch {
      // ignore
    }
  },
}))
