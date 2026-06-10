import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { arch, homedir, platform } from 'node:os'
import { join } from 'node:path'
import { getSqlite } from './db'

// ─── Paths ───────────────────────────────────────────────────────────────────

const IDE_APP_PATH = '/Applications/Antigravity IDE.app'
const IDE_BINARY_DIR = join(IDE_APP_PATH, 'Contents/Resources/app/extensions/antigravity/bin')

const DESKTOP_APP_PATH = '/Applications/Antigravity.app'
const DESKTOP_BINARY = join(DESKTOP_APP_PATH, 'Contents/Resources/bin/language_server')

const PROXY_SERVER_DIR = join(homedir(), 'scripts/ai-proxy-server')
const GEMINI_CONFIG = join(PROXY_SERVER_DIR, 'gemini_token.json')
const GEMINI_OAUTH = join(homedir(), '.gemini/oauth_creds.json')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

/**
 * Get the path to Antigravity's state.vscdb based on the current platform
 */
function getAntigravityStoragePath(): string {
  const home = homedir()
  const os = platform()

  if (os === 'darwin') {
    return join(home, 'Library/Application Support/antigravity/User/globalStorage/state.vscdb')
  }
  if (os === 'win32') {
    return join(home, 'AppData/Roaming/antigravity/User/globalStorage/state.vscdb')
  }
  return join(home, '.config/antigravity/User/globalStorage/state.vscdb')
}

/**
 * Upsert a key-value pair into the configurations table
 */
function upsertConfig(key: string, value: string): void {
  const sqlite = getSqlite()
  const stmt = sqlite.prepare(`
    INSERT INTO configurations (key, value, updated_at) 
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `)
  stmt.run(key, value)
}

// ─── Find language_server binary ─────────────────────────────────────────────

function findLanguageServerBinary(): string | null {
  // Prefer IDE binary
  if (existsSync(IDE_BINARY_DIR)) {
    const a = arch() === 'arm64' ? 'arm' : 'x64'
    const binaryName = `language_server_macos_${a}`
    const binaryPath = join(IDE_BINARY_DIR, binaryName)
    if (existsSync(binaryPath)) return binaryPath

    // Fallback: try any language_server* in the dir
    const files = readdirSync(IDE_BINARY_DIR)
    const lsBinary = files.find((f) => f.startsWith('language_server') && !f.endsWith('.log'))
    if (lsBinary) return join(IDE_BINARY_DIR, lsBinary)
  }

  // Fallback to Desktop app binary
  if (existsSync(DESKTOP_BINARY)) return DESKTOP_BINARY

  return null
}

// ─── Extract CLIENT_ID & CLIENT_SECRET from binary ───────────────────────────

function extractClientCredentials(binaryPath: string): {
  clientIds: string[]
  clientSecrets: string[]
} {
  const clientIds: string[] = []
  const clientSecrets: string[] = []

  // Extract CLIENT_IDs
  const idOutput = exec(
    `strings "${binaryPath}" | grep -oE "[0-9]+-[a-z0-9]+\\.apps\\.googleusercontent\\.com"`,
  )
  if (idOutput) {
    const matches = idOutput.match(/\d{5,}-[a-z0-9]+\.apps\.googleusercontent\.com/g)
    if (matches) {
      for (const m of matches) {
        if (!clientIds.includes(m)) clientIds.push(m)
      }
    }
  }

  // Extract CLIENT_SECRETs
  const secretRaw = exec(`strings "${binaryPath}" | grep "GOCSPX"`)
  if (secretRaw) {
    const parts = secretRaw.split(/(?=GOCSPX-)/)
    for (const part of parts) {
      const m = part.match(/^(GOCSPX-[A-Za-z0-9_-]{28})/)
      if (m && !clientSecrets.includes(m[1])) {
        clientSecrets.push(m[1])
      }
    }
  }

  return { clientIds, clientSecrets }
}

// ─── Extract tokens from raw protobuf/base64 data ───────────────────────────

function extractTokens(data: string): {
  accessToken: string | null
  refreshToken: string | null
} {
  let accessToken: string | null = null
  let refreshToken: string | null = null

  // Decode outer base64
  let decoded: string
  try {
    decoded = Buffer.from(data, 'base64').toString('utf8')
  } catch {
    decoded = data
  }

  // Strategy 1: Find base64 chunks and decode them
  const base64Chunks = decoded.match(/Co[A-Za-z0-9+/=]{20,}/g) || []
  for (const chunk of base64Chunks) {
    try {
      const d = Buffer.from(chunk, 'base64').toString('utf8')
      if (!accessToken) {
        const m = d.match(/ya29\.[A-Za-z0-9_.-]+/)
        if (m) accessToken = m[0]
      }
      if (!refreshToken) {
        const m = d.match(/1\/\/[A-Za-z0-9_-]+/)
        if (m) refreshToken = m[0]
      }
    } catch {
      // ignore decode errors
    }
  }

  // Strategy 2: Try extracting directly from the raw string
  if (!accessToken) {
    const m = decoded.match(/ya29\.[A-Za-z0-9_.-]+/)
    if (m) accessToken = m[0]
  }
  if (!refreshToken) {
    const m = decoded.match(/1\/\/[A-Za-z0-9_-]+/)
    if (m) refreshToken = m[0]
  }

  return { accessToken, refreshToken }
}

// ─── Get App Version ─────────────────────────────────────────────────────────

function getAppVersion(): string {
  if (existsSync(IDE_APP_PATH)) {
    const version = exec(
      `defaults read "${IDE_APP_PATH}/Contents/Info" CFBundleShortVersionString 2>/dev/null`,
    )
    if (version) return version
  }

  if (existsSync(DESKTOP_APP_PATH)) {
    const version = exec(
      `defaults read "${DESKTOP_APP_PATH}/Contents/Info" CFBundleShortVersionString 2>/dev/null`,
    )
    if (version) return version
  }

  return 'unknown'
}

// ─── Get Default Project ─────────────────────────────────────────────────────

function getDefaultProject(): string {
  try {
    if (existsSync(GEMINI_CONFIG)) {
      const config = JSON.parse(readFileSync(GEMINI_CONFIG, 'utf8'))
      if (config.project) return config.project
    }
  } catch {
    // ignore
  }
  return ''
}

// ─── Get Access Token (from multiple sources) ────────────────────────────────

function getAccessToken(storagePath: string): string {
  // 1. From state.vscdb (Antigravity Desktop app storage)
  try {
    if (existsSync(storagePath)) {
      const query = `SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken';`
      const rawData = exec(`sqlite3 "${storagePath}" "${query}"`)
      if (rawData) {
        const { accessToken } = extractTokens(rawData)
        if (accessToken) return accessToken
      }
    }
  } catch {
    // ignore (db locked, etc.)
  }

  // 2. From gemini_token.json
  try {
    if (existsSync(GEMINI_CONFIG)) {
      const config = JSON.parse(readFileSync(GEMINI_CONFIG, 'utf8'))
      if (config.bearerToken) {
        return config.bearerToken.replace(/^Bearer\s+/i, '')
      }
    }
  } catch {
    /* ignore */
  }

  // 3. From ~/.gemini/oauth_creds.json
  try {
    if (existsSync(GEMINI_OAUTH)) {
      const creds = JSON.parse(readFileSync(GEMINI_OAUTH, 'utf8'))
      if (creds.access_token) return creds.access_token
    }
  } catch {
    /* ignore */
  }

  return ''
}

// ─── Get Refresh Token ───────────────────────────────────────────────────────

function getRefreshToken(storagePath: string): string {
  // 1. From state.vscdb
  try {
    if (existsSync(storagePath)) {
      const query = `SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken';`
      const rawData = exec(`sqlite3 "${storagePath}" "${query}"`)
      if (rawData) {
        const { refreshToken } = extractTokens(rawData)
        if (refreshToken) return refreshToken
      }
    }
  } catch {
    // ignore
  }

  // 2. From gemini_token.json
  try {
    if (existsSync(GEMINI_CONFIG)) {
      const config = JSON.parse(readFileSync(GEMINI_CONFIG, 'utf8'))
      if (config.refreshToken) return config.refreshToken
    }
  } catch {
    // ignore
  }

  // 3. From ~/.gemini/oauth_creds.json
  try {
    if (existsSync(GEMINI_OAUTH)) {
      const creds = JSON.parse(readFileSync(GEMINI_OAUTH, 'utf8'))
      if (creds.refresh_token) return creds.refresh_token
    }
  } catch {
    // ignore
  }

  return ''
}

// ─── Get Endpoint ────────────────────────────────────────────────────────────

function getEndpoint(): string {
  // Check running process for endpoint
  const processInfo = exec('ps aux | grep language_server_macos | grep -v grep | head -1')
  if (processInfo) {
    const endpointMatch = processInfo.match(/--cloud_code_endpoint\s+(\S+)/)
    if (endpointMatch) return endpointMatch[1]
  }

  // From config
  try {
    if (existsSync(GEMINI_CONFIG)) {
      const config = JSON.parse(readFileSync(GEMINI_CONFIG, 'utf8'))
      if (config.endpoint) {
        const url = new URL(config.endpoint)
        return `${url.protocol}//${url.host}`
      }
    }
  } catch {
    // ignore
  }

  return 'https://cloudcode-pa.googleapis.com'
}

// ─── Main: Sync all credentials ─────────────────────────────────────────────

/**
 * Sync all Antigravity credentials into the app's SQLite database.
 * Extracts: client_id, client_secret, access_token, refresh_token,
 * project, user_agent, endpoint, and more.
 *
 * Called on app startup.
 */
export async function syncAntigravityTokens(): Promise<void> {
  const storagePath = getAntigravityStoragePath()
  const binaryPath = findLanguageServerBinary()

  // Extract client credentials from binary
  let clientId = ''
  let clientSecret = ''
  let allClientIds: string[] = []
  let allClientSecrets: string[] = []

  if (binaryPath) {
    const { clientIds, clientSecrets } = extractClientCredentials(binaryPath)
    allClientIds = clientIds
    allClientSecrets = clientSecrets
    // Pick the IDE OAuth client (1071006060591... is used for token refresh)
    clientId = clientIds.find((id) => id.startsWith('1071006060591')) || clientIds[0] || ''
    clientSecret = clientSecrets[0] || ''
  }

  // Extract tokens
  const accessToken = getAccessToken(storagePath)
  const refreshToken = getRefreshToken(storagePath)
  const version = getAppVersion()
  const project = getDefaultProject()
  const endpoint = getEndpoint()

  if (!accessToken && !refreshToken && !clientId) {
    console.warn('[token-sync] Could not extract any credentials')
    return
  }

  const credentials = {
    client_id: clientId || null,
    client_secret: clientSecret || null,
    access_token: accessToken || null,
    refresh_token: refreshToken || null,
    default_project: project || null,
    user_agent: `antigravity/${version} ${platform()}/${arch()}`,
    version,
    endpoint,
    oauth_token_url: 'https://oauth2.googleapis.com/token',
    binary_path: binaryPath,
    all_client_ids: allClientIds,
    all_client_secrets: allClientSecrets,
    updated_at: new Date().toISOString(),
  }

  try {
    upsertConfig('antigravity_credentials', JSON.stringify(credentials))
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[token-sync] Error saving credentials:', msg)

    if (msg.includes('database is locked')) {
      console.warn(
        '[token-sync] Antigravity database is locked - app may be running. Will retry next launch.',
      )
    }
  }
}
