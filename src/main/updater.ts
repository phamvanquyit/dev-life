import { execFileSync } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { app, ipcMain, net, shell } from 'electron'
import { getDb } from './db'
import { configurations } from './db/schema'

/**
 * Detect the GitHub repo (owner/name) from package.json's `repository` field.
 * This makes the updater fork-friendly: forked repos just update package.json.
 */
function detectGitHubRepo(): string {
  try {
    const pkgPath = join(app.getAppPath(), 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    const repoUrl: string =
      typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || ''
    const match =
      repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/) || repoUrl.match(/^([^/]+\/[^/]+)$/)
    if (match) return match[1].replace(/\.git$/, '')
  } catch {
    // Fall through to fallback
  }
  console.warn('[Updater] Could not detect repo from package.json, using fallback')
  return 'phamvanquyit/dev-life'
}

const GITHUB_REPO = detectGitHubRepo()
const GITHUB_API_LATEST = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const GITHUB_API_ALL = `https://api.github.com/repos/${GITHUB_REPO}/releases`
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
const INITIAL_DELAY_MS = 5_000 // 5 seconds after startup
const CONFIG_KEY_PRERELEASE = 'include-prerelease'

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

export interface UpdateProgress {
  stage: 'downloading' | 'extracting' | 'installing' | 'done' | 'error'
  percent?: number
  message?: string
  error?: string
}

// Cache the latest update info so renderer can query it anytime
let cachedUpdateInfo: UpdateInfo | null = null
let dismissedVersion: string | null = null
let includePreRelease = false

/**
 * Load pre-release preference from DB.
 */
async function loadPreReleaseConfig(): Promise<void> {
  try {
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const row = await db
      .select()
      .from(configurations)
      .where(eq(configurations.key, CONFIG_KEY_PRERELEASE))
      .get()
    includePreRelease = row?.value === 'true'
  } catch {
    includePreRelease = false
  }
}

/**
 * Check if a version string is a pre-release (contains hyphen, e.g. "1.0.0-beta.1").
 */
function isPreRelease(version: string): boolean {
  return version.replace(/^v/, '').includes('-')
}

/**
 * Compare two semver strings. Returns true if `latest` is newer than `current`.
 */
function isNewerVersion(current: string, latest: string): boolean {
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

// ─── Helpers for in-app update ─────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Find the .app bundle inside an extracted directory (up to 2 levels deep).
 */
function findAppBundle(dir: string): string | null {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    if (entry.endsWith('.app') && statSync(join(dir, entry)).isDirectory()) {
      return entry
    }
  }
  // One level deeper (some zips wrap in a folder)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      for (const sub of readdirSync(fullPath)) {
        if (sub.endsWith('.app') && statSync(join(fullPath, sub)).isDirectory()) {
          return join(entry, sub)
        }
      }
    }
  }
  return null
}

/**
 * Resolve the running app's .app bundle path.
 * Returns null when running in dev (unpackaged).
 */
function resolveAppBundlePath(): string | null {
  if (!app.isPackaged) return null
  const exePath = app.getPath('exe')
  // e.g. /Applications/Dev Life.app/Contents/MacOS/Dev Life
  const parts = exePath.split('/')
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].endsWith('.app')) {
      return parts.slice(0, i + 1).join('/')
    }
  }
  return null
}

// ─── Download & Install ────────────────────────────────────────────────────────

/**
 * Download a .zip from GitHub Releases, extract it, replace the current
 * app bundle, clear quarantine attrs, and notify the renderer.
 */
async function downloadAndInstallUpdate(
  assetUrl: string,
  mainWindow: BrowserWindow,
): Promise<void> {
  let lastProgressTime = 0
  const sendProgress = (progress: UpdateProgress) => {
    mainWindow.webContents.send('update:progress', progress)
  }
  const throttledProgress = (progress: UpdateProgress) => {
    const now = Date.now()
    if (now - lastProgressTime > 150 || progress.stage !== 'downloading') {
      sendProgress(progress)
      lastProgressTime = now
    }
  }

  const tempDir = join(app.getPath('temp'), `devlife-update-${Date.now()}`)
  const zipPath = join(tempDir, 'update.zip')
  const extractDir = join(tempDir, 'extracted')

  try {
    mkdirSync(tempDir, { recursive: true })
    mkdirSync(extractDir, { recursive: true })

    // ── Step 1: Download ────────────────────────────────────────────
    sendProgress({ stage: 'downloading', percent: 0, message: 'Starting download...' })

    const response = await net.fetch(assetUrl, {
      headers: { 'User-Agent': `DevLife/${app.getVersion()}` },
    })

    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`)
    }

    const contentLength = Number(response.headers.get('content-length') || 0)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Failed to read download stream')

    const writeStream = createWriteStream(zipPath)
    let downloaded = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      if (!writeStream.write(chunk)) {
        await new Promise<void>((r) => writeStream.once('drain', r))
      }
      downloaded += chunk.byteLength
      const percent = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : -1
      const total = contentLength > 0 ? ` / ${formatBytes(contentLength)}` : ''
      throttledProgress({
        stage: 'downloading',
        percent,
        message: `Downloading... ${formatBytes(downloaded)}${total}`,
      })
    }

    writeStream.end()
    await new Promise<void>((res, rej) => {
      writeStream.on('finish', res)
      writeStream.on('error', rej)
    })

    sendProgress({
      stage: 'downloading',
      percent: 100,
      message: `Downloaded ${formatBytes(downloaded)}`,
    })

    // ── Step 2: Extract ─────────────────────────────────────────────
    sendProgress({ stage: 'extracting', message: 'Extracting update...' })

    // macOS `unzip` preserves permissions, symlinks, and extended attrs
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', extractDir], {
      timeout: 120_000,
    })

    // ── Step 3: Locate .app bundle ──────────────────────────────────
    const appBundleName = findAppBundle(extractDir)
    if (!appBundleName) {
      throw new Error('No .app bundle found in the downloaded archive')
    }
    const newAppPath = join(extractDir, appBundleName)

    // ── Step 4: Resolve current install path ────────────────────────
    const currentAppPath = resolveAppBundlePath()
    if (!currentAppPath) {
      throw new Error(
        'Cannot determine app location. Auto-update is not available in development mode.',
      )
    }

    // ── Step 5: Replace app bundle ──────────────────────────────────
    sendProgress({ stage: 'installing', message: 'Installing update...' })

    const backupPath = `${currentAppPath}.bak`

    // Remove leftover backup from a previous failed attempt
    // NOTE: Temporarily disable Electron's asar support so that rmSync
    // treats .asar files as regular files instead of virtual directories.
    // Without this, rmSync({ recursive: true }) calls rmdir on app.asar
    // which fails with ENOTDIR.
    if (existsSync(backupPath)) {
      const prevNoAsar = process.noAsar
      process.noAsar = true
      try {
        rmSync(backupPath, { recursive: true, force: true })
      } finally {
        process.noAsar = prevNoAsar
      }
    }

    // Backup: atomic rename on same filesystem
    execFileSync('mv', [currentAppPath, backupPath])

    try {
      // Copy new app into place
      try {
        execFileSync('cp', ['-R', newAppPath, currentAppPath])
      } catch (cpError: any) {
        const msg = cpError?.stderr?.toString() || cpError?.message || ''
        if (msg.includes('Permission denied') || msg.includes('Operation not permitted')) {
          throw new Error(
            'Permission denied. Please make sure Dev Life is installed in a location ' +
              'you have write access to (e.g. drag to /Applications as your user).',
          )
        }
        throw cpError
      }

      // Clear macOS quarantine / Gatekeeper extended attributes
      try {
        execFileSync('xattr', ['-cr', currentAppPath])
      } catch {
        console.warn('[Updater] xattr -cr failed (non-critical)')
      }

      // Verify new bundle integrity
      const macosDir = join(currentAppPath, 'Contents', 'MacOS')
      const prevNoAsar2 = process.noAsar
      process.noAsar = true
      try {
        if (!existsSync(macosDir)) {
          throw new Error('New app bundle appears invalid (missing Contents/MacOS)')
        }
      } finally {
        process.noAsar = prevNoAsar2
      }

      // Remove backup
      const prevNoAsar3 = process.noAsar
      process.noAsar = true
      try {
        rmSync(backupPath, { recursive: true, force: true })
      } finally {
        process.noAsar = prevNoAsar3
      }
    } catch (installError) {
      // ── ROLLBACK ──────────────────────────────────────────────────
      console.error('[Updater] Install failed, rolling back:', installError)
      const prevNoAsar4 = process.noAsar
      process.noAsar = true
      try {
        if (existsSync(currentAppPath)) {
          rmSync(currentAppPath, { recursive: true, force: true })
        }
      } catch {
        /* ignore cleanup during rollback */
      } finally {
        process.noAsar = prevNoAsar4
      }
      if (existsSync(backupPath)) {
        execFileSync('mv', [backupPath, currentAppPath])
      }
      throw installError
    }

    // Cleanup temp files
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }

    sendProgress({ stage: 'done', message: 'Update installed! Restart to apply.' })
  } catch (error: any) {
    // Cleanup temp on error
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }

    const msg = error?.message || 'Unknown error during update'
    console.error('[Updater] Install failed:', msg)
    sendProgress({ stage: 'error', error: msg })
  }
}

// ─── GitHub Release check ──────────────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string
  body: string | null
  html_url: string
  published_at: string
  prerelease: boolean
  draft: boolean
  assets: Array<{
    name: string
    browser_download_url: string
    size: number
  }>
}

/**
 * Fetch the latest release from GitHub API.
 * When includePreRelease is true, also considers pre-release versions.
 * Returns UpdateInfo if a newer version is available, null otherwise.
 */
async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    // Reload config each check so toggle takes effect immediately
    await loadPreReleaseConfig()

    const apiUrl = includePreRelease ? GITHUB_API_ALL : GITHUB_API_LATEST
    const response = await net.fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': `DevLife/${app.getVersion()}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        console.log('[Updater] No releases found on GitHub.')
        return null
      }
      console.warn(`[Updater] GitHub API returned ${response.status}`)
      return null
    }

    let release: GitHubRelease

    if (includePreRelease) {
      // /releases returns an array — pick the first non-draft release
      const releases = (await response.json()) as GitHubRelease[]
      const candidate = releases.find((r) => !r.draft)
      if (!candidate) {
        console.log('[Updater] No non-draft releases found.')
        return null
      }
      release = candidate
    } else {
      // /releases/latest returns a single object (excludes pre-releases & drafts)
      release = (await response.json()) as GitHubRelease
    }

    const currentVersion = app.getVersion()
    const latestVersion = release.tag_name.replace(/^v/, '')

    // Skip pre-releases unless the user opted in
    if (!includePreRelease && isPreRelease(latestVersion)) {
      console.log(`[Updater] Skipping pre-release: ${latestVersion}`)
      return null
    }

    if (!isNewerVersion(currentVersion, latestVersion)) {
      console.log(`[Updater] Up to date (current: ${currentVersion}, latest: ${latestVersion})`)
      cachedUpdateInfo = null
      return null
    }

    const macAssets = release.assets
      .filter((a) => /\.(dmg|zip)$/i.test(a.name))
      .map((a) => ({
        name: a.name,
        downloadUrl: a.browser_download_url,
        size: a.size,
      }))

    const updateInfo: UpdateInfo = {
      currentVersion,
      latestVersion,
      releaseNotes: release.body || 'No release notes available.',
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
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

// ─── Setup ─────────────────────────────────────────────────────────────────────

/**
 * Setup auto-update checker with periodic polling + IPC handlers.
 */
export function setupAutoUpdateChecker(mainWindow: BrowserWindow): void {
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

  // IPC: Get cached update status
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

  // IPC: Download + install update in-app
  ipcMain.handle('update:install', async () => {
    if (!cachedUpdateInfo) {
      sendErrorProgress(mainWindow, 'No update info available. Please check for updates first.')
      return { success: false }
    }

    // Find the right .zip for the current architecture
    const arch = process.arch // arm64 | x64
    const zips = cachedUpdateInfo.assets.filter((a) => a.name.endsWith('.zip'))
    const archZip = zips.find((a) => a.name.includes(arch)) || zips[0]

    if (!archZip) {
      sendErrorProgress(mainWindow, 'No compatible .zip file found in this release.')
      return { success: false }
    }

    console.log(`[Updater] Installing from: ${archZip.name} (arch: ${arch})`)
    await downloadAndInstallUpdate(archZip.downloadUrl, mainWindow)
    return { success: true }
  })

  // IPC: Restart app after successful update
  ipcMain.handle('update:restart', () => {
    app.relaunch()
    app.exit(0)
  })
}

function sendErrorProgress(mainWindow: BrowserWindow, error: string) {
  mainWindow.webContents.send('update:progress', {
    stage: 'error',
    error,
  } satisfies UpdateProgress)
}
