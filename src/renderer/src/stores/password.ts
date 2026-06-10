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
  createdAt: string
}

interface PasswordGeneratorState {
  // Generator settings
  length: number
  options: {
    uppercase: boolean
    lowercase: boolean
    numbers: boolean
    symbols: boolean
  }

  // Current generated password
  currentPassword: string

  // Browser detection
  browserInfo: BrowserInfo | null
  detecting: boolean

  // History
  history: HistoryEntry[]
  historyLoaded: boolean
  showHistory: boolean

  // Actions - settings
  setLength: (length: number) => void
  toggleOption: (key: 'uppercase' | 'lowercase' | 'numbers' | 'symbols') => void

  // Actions - core
  generate: () => Promise<void>
  copyPassword: (pw: string) => Promise<void>

  // Actions - history
  toggleHistory: () => void
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
  options: { uppercase: true, lowercase: true, numbers: true, symbols: true },
  currentPassword: '',
  browserInfo: null,
  detecting: false,
  history: [],
  historyLoaded: false,
  showHistory: false,

  // Settings
  setLength: (length) => set({ length }),
  toggleOption: (key) => set((s) => ({ options: { ...s.options, [key]: !s.options[key] } })),

  // Generate single password + auto-detect (no history save)
  generate: async () => {
    const { length, options } = get()

    set({ detecting: true })

    // Auto-detect browser
    let detected: BrowserInfo | null = null
    try {
      detected = await window.api.getActiveBrowserURL()
    } catch {
      // ignore
    }

    // Generate single password
    const password = createPassword(length, options)

    set({ currentPassword: password, browserInfo: detected, detecting: false })
  },

  copyPassword: async (pw) => {
    navigator.clipboard.writeText(pw)

    // Save to history only when user copies
    const { browserInfo } = get()
    try {
      const entries = [
        {
          password: pw,
          domain: browserInfo?.domain ?? '',
          url: browserInfo?.url ?? '',
          browser: browserInfo?.browser ?? '',
        },
      ]
      const updated = await window.api.savePasswordHistory(entries)
      set({ history: updated as HistoryEntry[] })
    } catch {
      // ignore
    }
  },

  // History
  toggleHistory: () => {
    const { showHistory, historyLoaded } = get()
    if (!showHistory && !historyLoaded) {
      get().loadHistory()
    }
    set({ showHistory: !showHistory })
  },

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
