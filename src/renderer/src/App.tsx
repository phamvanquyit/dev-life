import { StyleProvider } from '@ant-design/cssinjs'
import { ConfigProvider, theme } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Dashboard from './components/layout/Dashboard'
import Sidebar from './components/layout/Sidebar'
import AIProxy from './components/tools/AIProxy'
import AntigravityManager from './components/tools/AntigravityManager'
import AudioTranslator from './components/tools/AudioTranslator'
import SystemCleaner from './components/tools/SystemCleaner'

const toolMeta: Record<string, { title: string; desc: string }> = {
  'antigravity-manager': {
    title: 'Antigravity Manager',
    desc: 'Manage Antigravity 2.0 conversations',
  },
  'ai-proxy': { title: 'AI Proxy', desc: 'OpenAI-compatible proxy for Gemini' },
  'system-cleaner': { title: 'System Cleaner', desc: 'Scan & clean disk space' },
  'audio-translator': {
    title: 'Audio Translator',
    desc: 'Nghe tiếng Anh → Hiện transcript + dịch tiếng Việt',
  },
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Derive activeTool from current path
  const activeTool = location.pathname.replace(/^\//, '') || ''

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

  const meta = activeTool ? toolMeta[activeTool] : null

  return (
    <StyleProvider layer>
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: '#00d992',
            borderRadius: 6,
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
            colorBgContainer: '#101010',
            colorBgElevated: '#1a1a1a',
            colorBorder: '#3d3a39',
            colorText: '#f2f2f2',
            colorTextSecondary: '#bdbdbd',
          },
          components: {
            Button: {
              controlHeight: 34,
              fontSize: 13,
            },
            Input: {
              controlHeight: 36,
            },
            Tag: {
              fontSize: 11,
            },
          },
        }}
      >
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
              v1.0.0
            </span>
          </div>

          {/* Main area: sidebar + content */}
          <div className="flex flex-1 overflow-hidden">
            <Sidebar
              activeTool={activeTool}
              onToolSelect={handleToolSelect}
              collapsed={sidebarCollapsed}
            />

            <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-canvas)]">
              <div className="flex-1 overflow-y-auto p-6">
                <Routes>
                  <Route path="/" element={<Dashboard onToolSelect={handleToolSelect} />} />
                  <Route path="/antigravity-manager" element={<AntigravityManager />} />
                  <Route path="/ai-proxy" element={<AIProxy />} />
                  <Route path="/system-cleaner" element={<SystemCleaner />} />
                  <Route path="/audio-translator" element={<AudioTranslator />} />
                </Routes>
              </div>
            </div>
          </div>
        </div>
      </ConfigProvider>
    </StyleProvider>
  )
}
