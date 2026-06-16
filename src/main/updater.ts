import type { BrowserWindow } from 'electron'
import { app, ipcMain, net, shell } from 'electron'

const GITHUB_REPO = 'phamvanquyit/dev-life'
// /releases/latest automatically excludes pre-releases and drafts (GitHub API behavior)
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
const INITIAL_DELAY_MS = 5_000 // 5 seconds after startup

export interface UpdateAsset {
  name: string
  downloadUrl: string
  size: number
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseUrl: string
  publishedAt: string
  assets: UpdateAsset[]
}

// Cache the latest update info so renderer can query it anytime
let cachedUpdateInfo: UpdateInfo | null = null
let dismissedVersion: string | null = null

/**
 * Check if a version string is a pre-release (contains hyphen, e.g. "1.0.0-beta.1").
 */
function isPreRelease(version: string): boolean {
  return version.replace(/^v/, '').includes('-')
}

/**
 * Compare two semver strings (e.g. "1.0.0" vs "1.1.0").
 * Strips pre-release suffix before comparing so "1.0.0-beta.1" < "1.0.0".
 * Returns true if `latest` is newer than `current`.
 */
function isNewerVersion(current: string, latest: string): boolean {
  // Strip pre-release suffix for numeric comparison
  const stripPre = (v: string) => v.replace(/^v/, '').replace(/-.*$/, '')
  const parseParts = (v: string) => stripPre(v).split('.').map(Number)
  const c = parseParts(current)
  const l = parseParts(latest)

  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0
    const lv = l[i] ?? 0
    if (lv > cv) return true
    if (lv < cv) return false
  }

  // Same numeric version — if current is pre-release and latest is stable, it's an upgrade
  if (isPreRelease(current) && !isPreRelease(latest)) return true

  return false
}

/**
 * Fetch the latest release from GitHub API.
 * Returns UpdateInfo if a newer version is available, null otherwise.
 */
async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const response = await net.fetch(GITHUB_API_URL, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': `DevLife/${app.getVersion()}`,
      },
    })

    if (!response.ok) {
      // 404 = no releases yet, or repo not found
      if (response.status === 404) {
        console.log('[Updater] No releases found on GitHub.')
        return null
      }
      console.warn(`[Updater] GitHub API returned ${response.status}`)
      return null
    }

    const data = (await response.json()) as {
      tag_name: string
      body: string | null
      html_url: string
      published_at: string
      assets: Array<{
        name: string
        browser_download_url: string
        size: number
      }>
    }

    const currentVersion = app.getVersion()
    const latestVersion = data.tag_name.replace(/^v/, '')

    // Safety: never auto-update to a pre-release version
    if (isPreRelease(latestVersion)) {
      console.log(`[Updater] Skipping pre-release: ${latestVersion}`)
      return null
    }

    if (!isNewerVersion(currentVersion, latestVersion)) {
      console.log(`[Updater] Up to date (current: ${currentVersion}, latest: ${latestVersion})`)
      cachedUpdateInfo = null
      return null
    }

    // Filter for macOS assets (.dmg, .zip)
    const macAssets = data.assets
      .filter((a) => /\.(dmg|zip)$/i.test(a.name))
      .map((a) => ({
        name: a.name,
        downloadUrl: a.browser_download_url,
        size: a.size,
      }))

    const updateInfo: UpdateInfo = {
      currentVersion,
      latestVersion,
      releaseNotes: data.body || 'No release notes available.',
      releaseUrl: data.html_url,
      publishedAt: data.published_at,
      assets: macAssets,
    }

    console.log(`[Updater] New version available: ${latestVersion} (current: ${currentVersion})`)
    cachedUpdateInfo = updateInfo
    return updateInfo
  } catch (error) {
    console.error('[Updater] Failed to check for updates:', error)
    return null
  }
}

/**
 * Setup auto-update checker with periodic polling + IPC handlers.
 */
export function setupAutoUpdateChecker(mainWindow: BrowserWindow): void {
  // Notify renderer if update is available
  const notifyRenderer = (info: UpdateInfo) => {
    if (dismissedVersion === info.latestVersion) return
    mainWindow.webContents.send('update:available', info)
  }

  // Check once after initial delay
  setTimeout(async () => {
    const info = await checkForUpdate()
    if (info) notifyRenderer(info)
  }, INITIAL_DELAY_MS)

  // Periodic check every 4 hours
  setInterval(async () => {
    const info = await checkForUpdate()
    if (info) notifyRenderer(info)
  }, CHECK_INTERVAL_MS)

  // IPC: Manual check from renderer
  ipcMain.handle('update:check-now', async () => {
    const info = await checkForUpdate()
    if (info && dismissedVersion !== info.latestVersion) {
      mainWindow.webContents.send('update:available', info)
      return { hasUpdate: true, info }
    }
    return { hasUpdate: false, info: null }
  })

  // IPC: Get cached update status (for when renderer first loads)
  ipcMain.handle('update:get-status', () => {
    if (cachedUpdateInfo && dismissedVersion !== cachedUpdateInfo.latestVersion) {
      return { hasUpdate: true, info: cachedUpdateInfo }
    }
    return { hasUpdate: false, info: null }
  })

  // IPC: Dismiss/skip a specific version
  ipcMain.handle('update:dismiss', (_event, version: string) => {
    dismissedVersion = version
    cachedUpdateInfo = null
    return { success: true }
  })

  // IPC: Open release URL in browser
  ipcMain.handle('update:open-release', (_event, url: string) => {
    shell.openExternal(url)
    return { success: true }
  })
}
