import { useCallback, useEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import Dashboard from './components/layout/Dashboard'
import Sidebar from './components/layout/Sidebar'
import MiniAppEditor from './components/tools/MiniAppEditor'
import MiniAppManager from './components/tools/MiniAppManager'
import MiniAppRenderer from './components/tools/MiniAppRenderer'
import Settings from './components/tools/Settings'
import { ConfirmProvider } from './components/ui/ConfirmDialog'
import { ToastProvider } from './components/ui/Toast'
import UpdateBanner from './components/ui/UpdateBanner'
import UpdateDialog from './components/ui/UpdateDialog'

const toolMeta: Record<string, { title: string; desc: string }> = {
  'mini-apps': { title: 'Mini Apps', desc: 'Manage & install mini apps' },
  settings: { title: 'Settings', desc: 'App configuration & integrations' },
}

// Wrapper to extract appId from route params and pass to MiniAppRenderer
function MiniAppRoute() {
  const { appId } = useParams<{ appId: string }>()
  if (!appId) return null
  return <MiniAppRenderer appId={appId} />
}

export interface MiniAppInfo {
  id: string
  name: string
  description: string
  icon: string
  category: string
  enabled: boolean
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [miniApps, setMiniApps] = useState<MiniAppInfo[]>([])
  const [appVersion, setAppVersion] = useState('...')
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // Derive activeTool from current path
  const activeTool = location.pathname.replace(/^\//, '') || ''

  // Load mini apps list
  const loadMiniApps = useCallback(async () => {
    try {
      const list = await window.api?.listMiniApps()
      setMiniApps(list?.filter((a: any) => a.enabled) || [])
    } catch {
      // silently fail
    }
  }, [])

  useEffect(() => {
    loadMiniApps()
    window.api?.getAppVersion().then((v: string) => setAppVersion(v || '0.0.0'))
  }, [loadMiniApps])

  // Reload mini apps periodically while on manager page (so sidebar updates on toggle)
  useEffect(() => {
    if (activeTool !== 'mini-apps') return
    const interval = setInterval(loadMiniApps, 2000)
    return () => {
      clearInterval(interval)
      // Also reload when leaving the page
      loadMiniApps()
    }
  }, [activeTool, loadMiniApps])

  const handleToolSelect = useCallback(
    (id: string) => {
      navigate(id ? `/${id}` : '/')
    },
    [navigate],
  )

  // Listen for IPC from menu bar
  useEffect(() => {
    const cleanupNav = window.api?.onNavigateTool((tool: string) => {
      navigate(`/${tool}`)
    })
    const cleanupSidebar = window.api?.onToggleSidebar(() => {
      setSidebarCollapsed((prev) => !prev)
    })
    return () => {
      cleanupNav?.()
      cleanupSidebar?.()
    }
  }, [navigate])

  // Auto-update: listen for update events + check cached status on mount
  useEffect(() => {
    // Check if there's already a cached update status
    window.api?.getUpdateStatus().then((result: { hasUpdate: boolean; info: any }) => {
      if (result?.hasUpdate && result.info) {
        setUpdateInfo(result.info)
      }
    })

    // Listen for new update notifications from main process
    const cleanup = window.api?.onUpdateAvailable((info: any) => {
      setUpdateInfo(info)
      setBannerDismissed(false)
    })
    return () => cleanup?.()
  }, [])

  const handleDismissUpdate = useCallback(() => {
    setBannerDismissed(true)
  }, [])

  const handleSkipVersion = useCallback(() => {
    if (updateInfo) {
      window.api?.dismissUpdate(updateInfo.latestVersion)
      setUpdateInfo(null)
      setShowUpdateDialog(false)
      setBannerDismissed(false)
    }
  }, [updateInfo])

  // Check if current route is a mini app
  const miniAppMatch = activeTool.startsWith('mini/') ? activeTool.replace('mini/', '') : null
  const activeMiniApp = miniAppMatch ? miniApps.find((a) => a.id === miniAppMatch) : null

  const meta = activeMiniApp
    ? { title: activeMiniApp.name, desc: activeMiniApp.description }
    : activeTool
      ? toolMeta[activeTool] || null
      : null

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="flex flex-col h-screen w-screen overflow-hidden">
          {/* Unified titlebar - full width */}
          <div className="h-[var(--header-height)] flex items-center px-4 pl-[78px] bg-[var(--color-canvas)] border-b border-[var(--color-hairline)] [-webkit-app-region:drag] shrink-0 gap-3 z-20">
            <span className="text-[13px] font-semibold text-[var(--color-body)] [-webkit-app-region:drag]">
              Dev Life
            </span>
            {meta && (
              <>
                <span className="w-px h-3.5 bg-[var(--color-hairline)] shrink-0" />
                <span className="text-xs font-medium text-[var(--color-ink)] [-webkit-app-region:no-drag]">
                  {meta.title}
                </span>
                <span className="text-[11px] text-[var(--color-mute)] [-webkit-app-region:no-drag]">
                  {meta.desc}
                </span>
              </>
            )}
            <span className="flex-1" />
            <span className="text-[10px] text-[var(--color-mute)] font-[var(--font-mono)] [-webkit-app-region:no-drag]">
              v{appVersion}
            </span>
          </div>

          {/* Main area: sidebar + content */}
          <div className="flex flex-1 overflow-hidden">
            <Sidebar
              activeTool={activeTool}
              onToolSelect={handleToolSelect}
              collapsed={sidebarCollapsed}
              miniApps={miniApps}
              updateAvailable={!!updateInfo}
            />

            <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-canvas)]">
              {/* Update banner */}
              {updateInfo && !bannerDismissed && (
                <UpdateBanner
                  latestVersion={updateInfo.latestVersion}
                  onViewRelease={() => setShowUpdateDialog(true)}
                  onDismiss={handleDismissUpdate}
                />
              )}
              <Routes>
                {/* Mini app route: full height, no padding for panel split */}
                <Route
                  path="/mini/:appId"
                  element={
                    <div className="flex-1 overflow-hidden">
                      <MiniAppRoute />
                    </div>
                  }
                />
                {/* Regular tools: padded scrollable */}
                <Route
                  path="/"
                  element={
                    <div className="flex-1 overflow-y-auto p-6">
                      <Dashboard />
                    </div>
                  }
                />

                <Route
                  path="/mini-apps"
                  element={
                    <div className="flex-1 overflow-y-auto p-6">
                      <MiniAppManager />
                    </div>
                  }
                />
                <Route
                  path="/mini-apps/new"
                  element={
                    <div className="flex-1 overflow-hidden">
                      <MiniAppEditor />
                    </div>
                  }
                />
                <Route
                  path="/mini-apps/edit/:appId"
                  element={
                    <div className="flex-1 overflow-hidden">
                      <MiniAppEditor />
                    </div>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <div className="flex-1 overflow-y-auto p-6">
                      <Settings />
                    </div>
                  }
                />
              </Routes>
            </div>
          </div>
        </div>

        {/* Update dialog */}
        {showUpdateDialog && updateInfo && (
          <UpdateDialog
            info={updateInfo}
            onClose={() => setShowUpdateDialog(false)}
            onDismissVersion={handleSkipVersion}
          />
        )}
      </ConfirmProvider>
    </ToastProvider>
  )
}
