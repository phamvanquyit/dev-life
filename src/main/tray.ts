import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { BrowserWindow, nativeImage, screen, Tray } from 'electron'

let tray: Tray | null = null
let trayWindow: BrowserWindow | null = null
let blurTimeout: NodeJS.Timeout | null = null

function createTrayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 380,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#1e1e2a',
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Load renderer with tray panel flag
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?panel=tray`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { panel: 'tray' },
    })
  }

  // Show on all macOS desktops/Spaces
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  return win
}

function positionWindowBelowTray(win: BrowserWindow, trayBounds: Electron.Rectangle): void {
  const display = screen.getDisplayMatching(trayBounds)
  const winBounds = win.getBounds()

  // Center horizontally below tray icon
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2)
  // Position just below the menu bar
  const y = trayBounds.y + trayBounds.height + 4

  // Ensure window stays within screen bounds
  const maxX = display.bounds.x + display.bounds.width - winBounds.width
  const clampedX = Math.max(display.bounds.x, Math.min(x, maxX))

  win.setPosition(clampedX, y, false)
}

export function createTray(): void {
  // Load template icon
  let iconPath = join(__dirname, '../../resources/trayIconTemplate.png')
  try {
    const testIcon = nativeImage.createFromPath(iconPath)
    if (testIcon.isEmpty()) {
      iconPath = join(process.resourcesPath, 'trayIconTemplate.png')
    }
  } catch {
    iconPath = join(process.resourcesPath, 'trayIconTemplate.png')
  }
  const icon = nativeImage.createFromPath(iconPath)
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('Dev Life')
  tray.setIgnoreDoubleClickEvents(true)

  // Create the panel window
  trayWindow = createTrayWindow()

  // Hide panel when clicking outside, delayed to prevent click toggle race condition
  trayWindow.on('blur', () => {
    blurTimeout = setTimeout(() => {
      if (trayWindow && !trayWindow.isDestroyed()) {
        trayWindow.hide()
      }
      blurTimeout = null
    }, 100)
  })

  // Toggle on click
  tray.on('click', () => {
    if (!trayWindow || !tray) return

    if (blurTimeout) {
      clearTimeout(blurTimeout)
      blurTimeout = null
    }

    if (trayWindow.isVisible()) {
      trayWindow.hide()
    } else {
      const trayBounds = tray.getBounds()
      positionWindowBelowTray(trayWindow, trayBounds)
      trayWindow.show()
      trayWindow.focus()
    }
  })
}

export function destroyTray(): void {
  if (blurTimeout) {
    clearTimeout(blurTimeout)
    blurTimeout = null
  }
  if (trayWindow) {
    trayWindow.destroy()
    trayWindow = null
  }
  if (tray) {
    tray.destroy()
    tray = null
  }
}
