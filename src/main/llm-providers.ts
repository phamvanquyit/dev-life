import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { ipcMain } from 'electron'
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}
