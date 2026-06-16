import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { setupAiAgentIPC } from './ai-agent'
import { setupLlmProvidersIPC } from './llm-providers'
import { startMcpServer, stopMcpServer } from './mcp-server'
import { createMenu } from './menu'
import { loadAllMiniApps, setupMiniAppIPC, unloadAllMiniApps } from './mini-app-runtime'
import { createTray, destroyTray } from './tray'
import { setupAutoUpdateChecker } from './updater'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

try {
  if (app.getPath('exe').includes('Dev Life Preview.app')) {
    process.env.DEV_LIFE_PREVIEW = 'true'
  }
} catch (e) {
  console.error('Failed to detect app path:', e)
}

if (process.env.DEV_LIFE_PREVIEW === 'true') {
  app.setName('Dev Life Preview')
} else {
  app.setName('Dev Life')
}

let forceQuit = false

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.zobite.dev-life')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()

  // Ensure dock icon is visible on macOS
  app.dock?.show()

  // Hide window instead of quitting when clicking the X button
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // Setup menu
  createMenu(
    (tool: string) => {
      mainWindow.webContents.send('navigate-tool', tool)
    },
    () => {
      mainWindow.webContents.send('toggle-sidebar')
    },
  )

  // Setup tray icon with popup panel
  createTray(mainWindow)

  // IPC handlers
  ipcMain.handle('get-app-version', () => app.getVersion())

  setupMiniAppIPC()
  setupLlmProvidersIPC()
  setupAiAgentIPC()

  // Load all enabled mini apps
  loadAllMiniApps()

  // Start embedded MCP server
  startMcpServer()

  // Setup auto-update checker (checks GitHub Releases periodically)
  setupAutoUpdateChecker(mainWindow)

  app.on('activate', () => {
    const allWindows = BrowserWindow.getAllWindows()
    if (allWindows.length === 0) {
      createWindow()
    } else {
      // Re-show the hidden main window when clicking the dock icon
      mainWindow.show()
    }
  })
})

app.on('window-all-closed', () => {
  // Do nothing — keep app running in background with tray
})

app.on('before-quit', async () => {
  forceQuit = true
  await unloadAllMiniApps()
  stopMcpServer()
  destroyTray()
})

// Ensure tray cleanup when process is killed (e.g., Ctrl+C during dev)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    destroyTray()
    app.quit()
  })
}
