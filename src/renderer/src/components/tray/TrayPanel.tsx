import { StyleProvider } from '@ant-design/cssinjs'
import {
  BgColorsOutlined,
  DashboardOutlined,
  LeftOutlined,
  SafetyOutlined,
} from '@ant-design/icons'
import { ConfigProvider, theme } from 'antd'
import { useState } from 'react'
import TrayColorPicker from './TrayColorPicker'
import TrayPasswordGenerator from './TrayPasswordGenerator'
import TrayQuota from './TrayQuota'

interface TrayTool {
  id: string
  label: string
  desc: string
  icon: React.ReactNode
}

const trayTools: TrayTool[] = [
  {
    id: 'quota',
    label: 'Antigravity Quota',
    desc: 'Model usage & limits',
    icon: <DashboardOutlined />,
  },
  {
    id: 'password',
    label: 'Password Generator',
    desc: 'Generate secure passwords',
    icon: <SafetyOutlined />,
  },
  { id: 'color', label: 'Color Picker', desc: 'Pick & convert colors', icon: <BgColorsOutlined /> },
]

const toolComponents: Record<string, React.ReactNode> = {
  quota: <TrayQuota />,
  password: <TrayPasswordGenerator />,
  color: <TrayColorPicker />,
}

export default function TrayPanel() {
  const [activeTool, setActiveTool] = useState<string | null>(null)

  const activeLabel = activeTool ? trayTools.find((t) => t.id === activeTool)?.label : null

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
            Button: { controlHeight: 32, fontSize: 12 },
            Input: { controlHeight: 32 },
          },
        }}
      >
        <div className="tray-panel">
          <div className="tray-panel-inner">
            {/* Header */}
            <div className="tray-header">
              {activeTool ? (
                <div className="tray-header-back" onClick={() => setActiveTool(null)}>
                  <LeftOutlined style={{ fontSize: 12 }} />
                  <span>{activeLabel}</span>
                </div>
              ) : (
                <div className="tray-header-title">
                  <span className="tray-header-logo">Dev Life</span>
                  <span className="tray-header-subtitle">Quick Tools</span>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="tray-content">
              {activeTool ? (
                toolComponents[activeTool]
              ) : (
                <div className="tray-tool-list">
                  {trayTools.map((tool) => (
                    <div
                      key={tool.id}
                      className="tray-tool-item"
                      onClick={() => setActiveTool(tool.id)}
                    >
                      <div className="tray-tool-item-icon">{tool.icon}</div>
                      <div className="tray-tool-item-info">
                        <div className="tray-tool-item-label">{tool.label}</div>
                        <div className="tray-tool-item-desc">{tool.desc}</div>
                      </div>
                      <div className="tray-tool-item-arrow">›</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </ConfigProvider>
    </StyleProvider>
  )
}
