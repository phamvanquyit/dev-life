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
        <div className="app-shell">
          {/* Unified titlebar - full width */}
          <div className="titlebar">
            <span className="titlebar-app-name">Dev Life</span>
            {meta && (
              <>
                <span className="titlebar-separator" />
                <span className="titlebar-tool-name">{meta.title}</span>
                <span className="titlebar-tool-desc">{meta.desc}</span>
              </>
            )}
            <span className="titlebar-spacer" />
            <span className="titlebar-version">v1.0.0</span>
          </div>

          {/* Main area: sidebar + content */}
          <div className="main-area">
            <Sidebar
              activeTool={activeTool}
              onToolSelect={handleToolSelect}
              collapsed={sidebarCollapsed}
            />

            <div className="content-area">
              <div className="content-body">
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
