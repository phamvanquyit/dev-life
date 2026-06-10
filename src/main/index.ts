import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { setupAntigravityIPC } from './antigravity'
import { setupAudioTranslatorIPC } from './audio-translator'
import { getActiveBrowserURL } from './browser-detect'
import { createMenu } from './menu'
import { setupPasswordHistoryIPC } from './password-history'
import { autoStartProxy, setupProxyIPC } from './proxy-server'
import { setupSystemCleanerIPC } from './system-cleaner'
import { syncAntigravityTokens } from './token-sync'
import { createTray, destroyTray } from './tray'

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

if (process.env.DEV_LIFE_PREVIEW === 'true') {
  app.setName('Dev Life Preview')
} else {
  app.setName('Dev Life')
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.zobite.dev-life')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()

  // Quit app fully when main window is closed
  mainWindow.on('close', () => {
    destroyTray()
    app.quit()
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
  createTray()

  // IPC handlers
  ipcMain.handle('get-app-version', () => app.getVersion())
  ipcMain.handle('get-active-browser-url', () => getActiveBrowserURL())
  setupPasswordHistoryIPC()
  setupAntigravityIPC()
  setupProxyIPC()
  setupSystemCleanerIPC()
  setupAudioTranslatorIPC()

  // Sync tokens then auto-start proxy
  syncAntigravityTokens()
    .then(() => autoStartProxy())
    .catch((err) => console.error('[startup] Token sync / proxy start failed:', err))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  destroyTray()
  app.quit()
})

app.on('before-quit', () => {
  destroyTray()
})

// Ensure tray cleanup when process is killed (e.g., Ctrl+C during dev)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    destroyTray()
    app.quit()
  })
}
