import { StyleProvider } from '@ant-design/cssinjs'
import { ConfigProvider, theme } from 'antd'
import { ChevronLeft, Gauge, Palette, Shield } from 'lucide-react'
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
    icon: <Gauge size={18} />,
  },
  {
    id: 'password',
    label: 'Password Generator',
    desc: 'Generate secure passwords',
    icon: <Shield size={18} />,
  },
  {
    id: 'color',
    label: 'Color Picker',
    desc: 'Pick & convert colors',
    icon: <Palette size={18} />,
  },
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
        <div className="w-full h-full flex flex-col items-center p-0 font-[var(--font-sans)] bg-transparent">
          <div className="flex-1 w-full bg-[var(--color-canvas)] rounded-xl border border-[var(--color-hairline)] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="py-2.5 px-3 border-b border-[var(--color-hairline)] flex items-center">
              {activeTool ? (
                <div
                  className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary-soft)] cursor-pointer transition-colors duration-150 select-none hover:text-[var(--color-primary)]"
                  onClick={() => setActiveTool(null)}
                >
                  <ChevronLeft size={12} />
                  <span>{activeLabel}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-[var(--color-primary)]">
                    Dev Life
                  </span>
                  <span className="text-[11px] text-[var(--color-mute)]">Quick Tools</span>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3">
              {activeTool ? (
                toolComponents[activeTool]
              ) : (
                <div className="flex flex-col gap-1.5">
                  {trayTools.map((tool) => (
                    <div
                      key={tool.id}
                      className="flex items-center gap-3 p-3 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] cursor-pointer transition-all duration-150 select-none hover:border-[var(--color-primary)]"
                      onClick={() => setActiveTool(tool.id)}
                    >
                      <div className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-glow)] text-[var(--color-primary-soft)] text-base shrink-0">
                        {tool.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-[var(--color-ink)]">
                          {tool.label}
                        </div>
                        <div className="text-[11px] text-[var(--color-mute)] mt-px">
                          {tool.desc}
                        </div>
                      </div>
                      <div className="text-lg text-[var(--color-mute)] shrink-0">›</div>
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
