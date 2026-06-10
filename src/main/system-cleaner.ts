import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { ipcMain } from 'electron'

interface DiskUsageItem {
  path: string
  label: string
  size: string
  sizeBytes: number
  cleanable: boolean
  cleanId: string
  description: string
  category: string
}

interface DiskOverview {
  total: string
  used: string
  available: string
  percentUsed: number
}

function runCmd(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 120000 }, (_error, stdout) => {
      resolve(stdout?.trim() || '')
    })
  })
}

function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.trim().match(/^([\d.]+)\s*([BKMGTP]i?)?$/i)
  if (!match) return 0
  const num = Number.parseFloat(match[1])
  const unit = (match[2] || 'B').toUpperCase()
  const multipliers: Record<string, number> = {
    B: 1,
    K: 1024,
    KI: 1024,
    M: 1024 ** 2,
    MI: 1024 ** 2,
    G: 1024 ** 3,
    GI: 1024 ** 3,
    T: 1024 ** 4,
    TI: 1024 ** 4,
  }
  return Math.round(num * (multipliers[unit] || 1))
}

async function getDiskOverview(): Promise<DiskOverview> {
  const output = await runCmd('df -h / | tail -1')
  const parts = output.split(/\s+/)
  return {
    total: parts[1] || '0',
    used: parts[2] || '0',
    available: parts[3] || '0',
    percentUsed: Number.parseInt(parts[4]?.replace('%', '') || '0', 10),
  }
}

async function scanDiskUsage(): Promise<DiskUsageItem[]> {
  const home = homedir()
  const targets: {
    path: string
    label: string
    cleanId: string
    description: string
    category: string
  }[] = [
    // === Package Managers ===
    {
      path: `${home}/.npm`,
      label: 'npm Cache',
      cleanId: 'npm-cache',
      description: 'npm package cache',
      category: 'Package Managers',
    },
    {
      path: `${home}/.bun/install/cache`,
      label: 'Bun Cache',
      cleanId: 'bun-cache',
      description: 'Bun package cache',
      category: 'Package Managers',
    },
    {
      path: `${home}/.yarn`,
      label: 'Yarn Cache',
      cleanId: 'yarn-cache',
      description: 'Yarn package cache',
      category: 'Package Managers',
    },
    {
      path: `${home}/.cache/pip`,
      label: 'Pip Cache',
      cleanId: 'pip-cache',
      description: 'Python pip package cache',
      category: 'Package Managers',
    },
    {
      path: `${home}/.cache/uv`,
      label: 'uv Cache',
      cleanId: 'uv-cache',
      description: 'Python uv package cache',
      category: 'Package Managers',
    },
    {
      path: `${home}/go/pkg/mod`,
      label: 'Go Module Cache',
      cleanId: 'go-cache',
      description: 'Go module download cache',
      category: 'Package Managers',
    },

    // === Dev Tools ===
    {
      path: `${home}/.nvm`,
      label: 'nvm (Node versions)',
      cleanId: 'nvm',
      description: 'Node.js versions managed by nvm',
      category: 'Dev Tools',
    },
    {
      path: `${home}/Library/Containers/com.docker.docker`,
      label: 'Docker Data',
      cleanId: 'docker',
      description: 'Docker images, containers & volumes',
      category: 'Dev Tools',
    },
    {
      path: `${home}/Library/Developer/Xcode/DerivedData`,
      label: 'Xcode DerivedData',
      cleanId: 'xcode-derived',
      description: 'Xcode build cache (safe to clean)',
      category: 'Dev Tools',
    },
    {
      path: `${home}/Library/Developer/Xcode/Archives`,
      label: 'Xcode Archives',
      cleanId: 'xcode-archives',
      description: 'Xcode archived builds',
      category: 'Dev Tools',
    },
    {
      path: `${home}/Library/Developer/Xcode/iOS DeviceSupport`,
      label: 'iOS DeviceSupport',
      cleanId: 'ios-device-support',
      description: 'iOS device symbols (can be very large)',
      category: 'Dev Tools',
    },
    {
      path: `${home}/Library/Developer/CoreSimulator`,
      label: 'iOS Simulators',
      cleanId: 'ios-simulators',
      description: 'iOS simulator runtime data',
      category: 'Dev Tools',
    },
    {
      path: `${home}/Library/Application Support/Cursor`,
      label: 'Cursor Editor',
      cleanId: 'cursor',
      description: 'Cursor editor data and cache',
      category: 'Dev Tools',
    },

    // === AI/ML ===
    {
      path: `${home}/.cache/huggingface`,
      label: 'Hugging Face Models',
      cleanId: 'huggingface',
      description: 'AI model cache (will re-download if needed)',
      category: 'AI/ML',
    },
    {
      path: `${home}/.cache/puppeteer`,
      label: 'Puppeteer Browsers',
      cleanId: 'puppeteer',
      description: 'Headless browser binaries',
      category: 'AI/ML',
    },

    // === Browsers ===
    {
      path: `${home}/Library/Application Support/Google/Chrome`,
      label: 'Chrome Data',
      cleanId: 'chrome-cache',
      description: 'Chrome cache, code cache & service workers',
      category: 'Browsers',
    },
    {
      path: `${home}/Library/Safari`,
      label: 'Safari Cache',
      cleanId: 'safari-cache',
      description: 'Safari local storage & databases',
      category: 'Browsers',
    },

    // === App Caches ===
    {
      path: `${home}/Library/Application Support/Slack`,
      label: 'Slack Cache',
      cleanId: 'slack-cache',
      description: 'Slack cache & service workers',
      category: 'App Caches',
    },
    {
      path: `${home}/Library/Application Support/discord`,
      label: 'Discord Cache',
      cleanId: 'discord-cache',
      description: 'Discord cache & code cache',
      category: 'App Caches',
    },
    {
      path: `${home}/Library/Application Support/Code`,
      label: 'VS Code Data',
      cleanId: 'vscode-cache',
      description: 'VS Code cache & workspace storage',
      category: 'App Caches',
    },
    {
      path: `${home}/Library/Application Support/ZaloData`,
      label: 'Zalo Data',
      cleanId: 'zalo-cache',
      description: 'Zalo messages, files & media cache',
      category: 'App Caches',
    },
    {
      path: `${home}/Library/Application Support/Telegram Desktop`,
      label: 'Telegram Cache',
      cleanId: 'telegram-cache',
      description: 'Telegram media & message cache',
      category: 'App Caches',
    },

    // === System ===
    {
      path: `${home}/Library/Caches`,
      label: 'System Caches',
      cleanId: 'system-caches',
      description: 'macOS & app caches (safe to clean)',
      category: 'System',
    },
    {
      path: `${home}/Library/Logs`,
      label: 'System Logs',
      cleanId: 'system-logs',
      description: 'Application & system log files',
      category: 'System',
    },
    {
      path: `${home}/.cache`,
      label: 'User Cache (~/.cache)',
      cleanId: 'user-cache',
      description: 'General user cache directory',
      category: 'System',
    },
    {
      path: `${home}/.Trash`,
      label: 'Trash',
      cleanId: 'trash',
      description: 'Files in Trash',
      category: 'System',
    },
    {
      path: `${home}/Downloads`,
      label: 'Downloads',
      cleanId: 'downloads',
      description: 'Downloaded files',
      category: 'System',
    },
    {
      path: `${home}/.local`,
      label: 'Local Data (~/.local)',
      cleanId: 'local-data',
      description: 'Local binaries and data',
      category: 'System',
    },
  ]

  const results: DiskUsageItem[] = []

  const promises = targets.map(async (t) => {
    if (!existsSync(t.path)) return
    const output = await runCmd(`du -sh "${t.path}" 2>/dev/null`)
    if (output) {
      const size = output.split('\t')[0]?.trim()
      if (size && size !== '0B') {
        results.push({
          path: t.path,
          label: t.label,
          size,
          sizeBytes: parseSizeToBytes(size),
          cleanable: true,
          cleanId: t.cleanId,
          description: t.description,
          category: t.category,
        })
      }
    }
  })

  await Promise.all(promises)
  results.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return results
}

async function runClean(
  cleanId: string,
): Promise<{ success: boolean; message: string; freed: string }> {
  const home = homedir()

  const cleanCommands: Record<string, { cmd: string; label: string }> = {
    // Package Managers
    'npm-cache': {
      cmd: 'npm cache clean --force 2>&1',
      label: 'npm cache',
    },
    'bun-cache': {
      cmd: 'bun pm cache rm 2>&1',
      label: 'Bun cache',
    },
    'yarn-cache': {
      cmd: 'yarn cache clean 2>&1',
      label: 'Yarn cache',
    },
    'pip-cache': {
      cmd: 'pip3 cache purge 2>&1 || pip cache purge 2>&1',
      label: 'Pip cache',
    },
    'uv-cache': {
      cmd: 'uv cache clean 2>&1',
      label: 'uv cache',
    },
    'go-cache': {
      cmd: 'go clean -modcache 2>&1',
      label: 'Go module cache',
    },

    // Dev Tools
    docker: {
      cmd: 'docker system prune -a -f 2>&1 || /Applications/Docker.app/Contents/Resources/bin/docker system prune -a -f 2>&1',
      label: 'Docker',
    },
    'xcode-derived': {
      cmd: `rm -rf "${home}/Library/Developer/Xcode/DerivedData/"* 2>&1 && echo "Cleared Xcode DerivedData"`,
      label: 'Xcode DerivedData',
    },
    'xcode-archives': {
      cmd: `rm -rf "${home}/Library/Developer/Xcode/Archives/"* 2>&1 && echo "Cleared Xcode Archives"`,
      label: 'Xcode Archives',
    },
    'ios-device-support': {
      cmd: `rm -rf "${home}/Library/Developer/Xcode/iOS DeviceSupport/"* 2>&1 && echo "Cleared iOS DeviceSupport"`,
      label: 'iOS DeviceSupport',
    },
    'ios-simulators': {
      cmd: 'xcrun simctl delete unavailable 2>&1 || echo "No unavailable simulators"',
      label: 'iOS Simulators',
    },
    cursor: {
      cmd: `rm -rf "${home}/Library/Application Support/Cursor/CachedData" "${home}/Library/Application Support/Cursor/Cache" "${home}/Library/Application Support/Cursor/WebStorage" 2>&1 && echo "Cleared Cursor cache"`,
      label: 'Cursor cache',
    },

    // AI/ML
    huggingface: {
      cmd: `rm -rf "${home}/.cache/huggingface" 2>&1 && echo "Cleared Hugging Face cache"`,
      label: 'Hugging Face',
    },
    puppeteer: {
      cmd: `rm -rf "${home}/.cache/puppeteer" 2>&1 && echo "Cleared Puppeteer browsers"`,
      label: 'Puppeteer',
    },

    // Browsers
    'chrome-cache': {
      cmd: `rm -rf "${home}/Library/Application Support/Google/Chrome/Default/Service Worker" "${home}/Library/Application Support/Google/Chrome/Default/Cache" "${home}/Library/Application Support/Google/Chrome/Default/Code Cache" 2>&1 && echo "Cleared Chrome cache"`,
      label: 'Chrome cache',
    },
    'safari-cache': {
      cmd: `rm -rf "${home}/Library/Safari/LocalStorage/"* "${home}/Library/Safari/Databases/"* "${home}/Library/Safari/Cache.db" 2>&1 && echo "Cleared Safari cache"`,
      label: 'Safari cache',
    },

    // App Caches
    'slack-cache': {
      cmd: `rm -rf "${home}/Library/Application Support/Slack/Service Worker/CacheStorage" "${home}/Library/Application Support/Slack/Cache" 2>&1 && echo "Cleared Slack cache"`,
      label: 'Slack cache',
    },
    'discord-cache': {
      cmd: `rm -rf "${home}/Library/Application Support/discord/Cache" "${home}/Library/Application Support/discord/Code Cache" 2>&1 && echo "Cleared Discord cache"`,
      label: 'Discord cache',
    },
    'vscode-cache': {
      cmd: `rm -rf "${home}/Library/Application Support/Code/CachedData" "${home}/Library/Application Support/Code/Cache" "${home}/Library/Application Support/Code/User/workspaceStorage" 2>&1 && echo "Cleared VS Code cache"`,
      label: 'VS Code cache',
    },
    'zalo-cache': {
      cmd: `rm -rf "${home}/Library/Application Support/Zalo/Cache" "${home}/Library/Application Support/ZaloPC/Cache" "${home}/Library/Application Support/ZaloData/"*/Cache 2>&1 && echo "Cleared Zalo cache"`,
      label: 'Zalo cache',
    },
    'telegram-cache': {
      cmd: `rm -rf "${home}/Library/Application Support/Telegram Desktop/tdata/user_data/"*/cache 2>&1; rm -rf "${home}/Library/Group Containers/"*".keepcoder.Telegram/account-"*/postbox/media 2>&1; echo "Cleared Telegram cache"`,
      label: 'Telegram cache',
    },

    // System
    'system-caches': {
      cmd: `find "${home}/Library/Caches" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>&1 && echo "Cleared system caches"`,
      label: 'System caches',
    },
    'system-logs': {
      cmd: `find "${home}/Library/Logs" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>&1 && echo "Cleared system logs"`,
      label: 'System logs',
    },
    trash: {
      cmd: `rm -rf "${home}/.Trash/"* 2>&1 && echo "Emptied Trash"`,
      label: 'Trash',
    },
    'user-cache': {
      cmd: `rm -rf "${home}/.cache/"* 2>&1 && echo "Cleared user cache"`,
      label: 'User cache',
    },
  }

  const cleanAction = cleanCommands[cleanId]
  if (!cleanAction) {
    return { success: false, message: `No clean action for: ${cleanId}`, freed: '0' }
  }

  // Get size before
  const beforeOutput = await runCmd('df -h / | tail -1')
  const beforeAvail = beforeOutput.split(/\s+/)[3] || '0'

  try {
    await runCmd(cleanAction.cmd)

    // Get size after
    const afterOutput = await runCmd('df -h / | tail -1')
    const afterAvail = afterOutput.split(/\s+/)[3] || '0'

    const beforeBytes = parseSizeToBytes(beforeAvail)
    const afterBytes = parseSizeToBytes(afterAvail)
    const freedBytes = afterBytes - beforeBytes

    let freedStr = '0B'
    if (freedBytes > 1024 ** 3) {
      freedStr = `${(freedBytes / 1024 ** 3).toFixed(1)} GB`
    } else if (freedBytes > 1024 ** 2) {
      freedStr = `${(freedBytes / 1024 ** 2).toFixed(0)} MB`
    } else if (freedBytes > 1024) {
      freedStr = `${(freedBytes / 1024).toFixed(0)} KB`
    }

    return {
      success: true,
      message: `✅ ${cleanAction.label} cleaned successfully`,
      freed: freedStr,
    }
  } catch (err) {
    return {
      success: false,
      message: `❌ Failed to clean ${cleanAction.label}: ${err}`,
      freed: '0',
    }
  }
}

export function setupSystemCleanerIPC(): void {
  ipcMain.handle('system:disk-overview', async () => {
    return getDiskOverview()
  })

  ipcMain.handle('system:scan-usage', async () => {
    return scanDiskUsage()
  })

  ipcMain.handle('system:clean', async (_event, cleanId: string) => {
    return runClean(cleanId)
  })
}
