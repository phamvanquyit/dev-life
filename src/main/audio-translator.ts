import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, desktopCapturer, ipcMain, session, systemPreferences } from 'electron'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_TRANSCRIPTION_URL = 'https://openrouter.ai/api/v1/audio/transcriptions'
const ASR_MODELS = [
  'qwen/qwen3-asr-flash-2026-02-10',
  'openai/whisper-large-v3-turbo',
  'openai/whisper-1',
]
const TRANSLATE_MODEL = 'qwen/qwen-2.5-7b-instruct'

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------
const CONFIG_DIR = join(app.getPath('userData'), 'audio-translator')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

interface ATConfig {
  apiKey?: string
}

function getConfig(): ATConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch {
    /* ignore */
  }
  return {}
}

function saveConfig(config: ATConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

function getApiKey(): string | null {
  const config = getConfig()
  return config.apiKey || null
}

// ---------------------------------------------------------------------------
// Step 1: Transcribe audio → English text  (Qwen3 ASR via OpenRouter)
// ---------------------------------------------------------------------------
async function transcribeAudio(
  apiKey: string,
  audioBase64: string,
  mimeType: string,
): Promise<string> {
  const sizeKB = ((audioBase64.length * 3) / 4 / 1024).toFixed(1)
  const format = mimeType.replace(/^audio\//, '').split(';')[0] || 'webm'

  let lastError: any = null

  for (const model of ASR_MODELS) {
    try {
      const response = await fetch(OPENROUTER_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input_audio: {
            data: audioBase64,
            format,
          },
          language: 'en',
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        console.warn(
          `[AT] ASR: Model ${model} failed with status ${response.status}:`,
          errText.substring(0, 150),
        )
        lastError = new Error(`ASR ${response.status} (${model}): ${errText.substring(0, 100)}`)
        continue
      }

      const data = (await response.json()) as any
      const text: string = data.text ?? data.choices?.[0]?.message?.content ?? ''
      return text.trim()
    } catch (err: any) {
      console.warn(`[AT] ASR: Model ${model} threw error:`, err.message)
      lastError = err
    }
  }

  throw lastError || new Error('All ASR models failed to transcribe audio')
}

// ---------------------------------------------------------------------------
// Step 2: Translate English → Vietnamese  (Gemma 3 4B)
// ---------------------------------------------------------------------------
async function translateToVietnamese(apiKey: string, englishText: string): Promise<string> {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TRANSLATE_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a translator. Translate the given English text to Vietnamese. Return ONLY the Vietnamese translation, nothing else.',
        },
        { role: 'user', content: englishText },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    console.error(`[AT] Translate error ${response.status}:`, errText.substring(0, 300))
    throw new Error(`Translate ${response.status}: ${errText.substring(0, 150)}`)
  }

  const data = (await response.json()) as any
  const text: string = data.choices?.[0]?.message?.content ?? ''
  return text.trim()
}

// ---------------------------------------------------------------------------
// Combined pipeline
// ---------------------------------------------------------------------------
async function transcribeAndTranslate(
  audioBase64: string,
  mimeType: string,
): Promise<{ english: string; vietnamese: string }> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenRouter API key chưa được cấu hình')

  const english = await transcribeAudio(apiKey, audioBase64, mimeType)
  if (!english) return { english: '', vietnamese: '' }

  let vietnamese = ''
  try {
    vietnamese = await translateToVietnamese(apiKey, english)
  } catch (err: any) {
    console.error('[AT] Translation failed:', err.message)
  }

  return { english, vietnamese }
}

// ---------------------------------------------------------------------------
// IPC Setup
// ---------------------------------------------------------------------------
export function setupAudioTranslatorIPC(): void {
  // Display-media handler for system audio
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' })
      } else {
        callback({ video: undefined as any })
      }
    } catch (err) {
      console.error('[AT] Display media error:', err)
      callback({ video: undefined as any })
    }
  })

  ipcMain.handle('audio-translator:set-api-key', async (_event, key: string) => {
    try {
      saveConfig({ ...getConfig(), apiKey: key })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('audio-translator:get-api-key', async () => getApiKey())

  ipcMain.handle(
    'audio-translator:transcribe',
    async (_event, audioBase64: string, mimeType: string) => {
      try {
        const result = await transcribeAndTranslate(audioBase64, mimeType)
        return { success: true, ...result }
      } catch (err: any) {
        console.error('[AT] IPC error:', err.message)
        return { success: false, error: err.message, english: '', vietnamese: '' }
      }
    },
  )

  ipcMain.handle('audio-translator:get-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 160, height: 100 },
      })
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        appIcon: s.appIcon?.toDataURL() || null,
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle('audio-translator:check-permissions', async () => ({
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
  }))

  ipcMain.handle('audio-translator:request-mic-permission', async () =>
    systemPreferences.askForMediaAccess('microphone'),
  )
}
