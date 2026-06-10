import { Cloud, Home, Languages, Laptop, Rocket, Search, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { usePulseGlow } from '../../hooks/useAnimations'

export interface ToolItem {
  id: string
  label: string
  icon: React.ReactNode
  shortcut: string
  category: string
  desc: string
}

export const tools: ToolItem[] = [
  {
    id: 'antigravity-manager',
    label: 'Antigravity',
    icon: <Rocket size={16} />,
    shortcut: '⌘1',
    category: 'Integrations',
    desc: 'Manage conversations',
  },
  {
    id: 'ai-proxy',
    label: 'AI Proxy',
    icon: <Cloud size={16} />,
    shortcut: '⌘2',
    category: 'Integrations',
    desc: 'Gemini proxy server',
  },
  {
    id: 'system-cleaner',
    label: 'System Cleaner',
    icon: <Laptop size={16} />,
    shortcut: '⌘3',
    category: 'System',
    desc: 'Clean disk space',
  },
  {
    id: 'audio-translator',
    label: 'Audio Translator',
    icon: <Languages size={16} />,
    shortcut: '⌘4',
    category: 'AI Tools',
    desc: 'English → Vietnamese',
  },
]

interface SidebarProps {
  activeTool: string
  onToolSelect: (id: string) => void
  collapsed: boolean
}

export default function Sidebar({ activeTool, onToolSelect, collapsed }: SidebarProps) {
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)

  const filteredTools = useMemo(() => {
    const visibleTools = tools.filter(
      (t) => t.id !== 'system-cleaner' && t.id !== 'audio-translator',
    )
    if (!search.trim()) return visibleTools
    const q = search.toLowerCase()
    return visibleTools.filter((t) => t.label.toLowerCase().includes(q))
  }, [search])

  const grouped = useMemo(() => {
    const groups: Record<string, ToolItem[]> = {}
    for (const tool of filteredTools) {
      if (!groups[tool.category]) groups[tool.category] = []
      groups[tool.category].push(tool)
    }
    return groups
  }, [filteredTools])

  const handleClick = (id: string) => {
    if (id === 'antigravity-manager') {
      window.api?.ensureAntigravityRunning?.()
    }
    onToolSelect(id)
  }

  const isHome = !activeTool
  const sidebarDotRef = usePulseGlow()

  return (
    <div
      className={`h-full bg-[var(--color-canvas)] border-r border-[var(--color-hairline)] flex flex-col relative z-10 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${collapsed ? 'w-0 min-w-0 border-r-0 overflow-hidden' : 'w-[var(--sidebar-width)] min-w-[var(--sidebar-width)]'}`}
    >
      {/* Brand header */}
      <div className="pt-3 px-3 pb-1 [-webkit-app-region:no-drag]">
        <div
          className={`flex items-center gap-2.5 py-2 px-2.5 rounded-[var(--radius-md)] cursor-pointer transition-all duration-200 relative ${isHome ? 'bg-[var(--color-primary-glow)]' : 'hover:bg-[rgba(255,255,255,0.03)]'}`}
          onClick={() => onToolSelect('')}
        >
          <div className="w-[30px] h-[30px] flex items-center justify-center rounded-[var(--radius-sm)] bg-linear-to-br from-[var(--color-primary)] to-[var(--color-primary-deep)] text-[var(--color-on-primary)] text-[15px] shrink-0 transition-transform duration-[250ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] shadow-[0_2px_8px_rgba(0,217,146,0.2)] hover:scale-[1.06]">
            <Zap size={15} />
          </div>
          <div className="flex flex-col gap-px min-w-0">
            <span className="text-[13px] font-semibold text-[var(--color-ink)] leading-[1.2] tracking-[-0.2px]">
              Dev Life
            </span>
            <span className="text-[10px] text-[var(--color-mute)] leading-[1.2] tracking-[0.3px]">
              Developer Toolkit
            </span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="py-2 px-3 [-webkit-app-region:no-drag]">
        <div className="relative flex items-center">
          <Search
            size={12}
            className={`absolute left-2.5 pointer-events-none transition-colors duration-200 ${searchFocused ? 'text-[var(--color-primary)]' : 'text-[var(--color-mute)]'}`}
          />
          <input
            type="text"
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full h-[30px] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] pr-7 pl-[30px] text-[var(--color-ink)] text-xs outline-none transition-all duration-200 placeholder:text-[var(--color-mute)] focus:border-[var(--color-primary)] focus:shadow-[0_0_0_2px_var(--color-primary-glow)] focus:bg-[rgba(26,26,26,0.8)]"
          />
          {search && (
            <button
              type="button"
              className="absolute right-1.5 w-[18px] h-[18px] flex items-center justify-center bg-[var(--color-hairline)] border-none rounded-full text-[var(--color-body)] text-[8px] cursor-pointer transition-all duration-150 leading-none hover:bg-[var(--color-primary)] hover:text-[var(--color-on-primary)]"
              onClick={() => setSearch('')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-1 px-3 [-webkit-app-region:no-drag]">
        {/* Home item */}
        <div
          className={`group flex items-center gap-2.5 py-[7px] px-2.5 rounded-[var(--radius-sm)] cursor-pointer text-[13px] transition-all duration-150 select-none [-webkit-app-region:no-drag] relative my-px ${isHome ? 'bg-[var(--color-primary-glow)] text-[var(--color-primary)]' : 'text-[var(--color-body)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--color-ink)]'}`}
          onClick={() => onToolSelect('')}
        >
          <span
            className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-sm bg-[var(--color-primary)] transition-[height] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isHome ? 'h-4 shadow-[0_0_8px_rgba(0,217,146,0.3)]' : 'h-0 group-hover:h-3 group-hover:bg-[var(--color-hairline)]'}`}
          />
          <span
            className={`text-[15px] w-5 text-center shrink-0 transition-transform duration-200 group-hover:scale-110 ${isHome ? 'text-[var(--color-primary)]' : ''}`}
          >
            <Home size={15} />
          </span>
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            Dashboard
          </span>
        </div>

        {/* Separator */}
        <div className="h-px bg-[var(--color-hairline)] mx-2.5 my-2 opacity-60" />

        {/* Grouped tools */}
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="mb-1">
            <div className="flex items-center gap-2 pt-3.5 pb-1.5 px-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-[2.52px] text-[var(--color-mute)] whitespace-nowrap shrink-0">
                {category}
              </span>
              <span className="flex-1 h-px bg-linear-to-r from-[var(--color-hairline)] to-transparent opacity-50" />
            </div>
            {items.map((tool) => {
              const isActive = activeTool === tool.id
              return (
                <div
                  key={tool.id}
                  className={`group flex items-center gap-2.5 py-[7px] px-2.5 rounded-[var(--radius-sm)] cursor-pointer text-[13px] transition-all duration-150 select-none [-webkit-app-region:no-drag] relative my-px ${isActive ? 'bg-[var(--color-primary-glow)] text-[var(--color-primary)]' : 'text-[var(--color-body)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--color-ink)]'}`}
                  onClick={() => handleClick(tool.id)}
                >
                  <span
                    className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-sm bg-[var(--color-primary)] transition-[height] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isActive ? 'h-4 shadow-[0_0_8px_rgba(0,217,146,0.3)]' : 'h-0 group-hover:h-3 group-hover:bg-[var(--color-hairline)]'}`}
                  />
                  <span
                    className={`text-[15px] w-5 text-center shrink-0 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-[var(--color-primary)]' : ''}`}
                  >
                    {tool.icon}
                  </span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {tool.label}
                  </span>
                  {tool.shortcut && (
                    <span className="ml-auto text-[10px] font-[var(--font-mono)] text-[var(--color-mute)] bg-[rgba(255,255,255,0.03)] py-0.5 px-[5px] rounded-[3px] border border-[rgba(61,58,57,0.5)] opacity-0 translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
                      {tool.shortcut}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="py-2.5 px-4 border-t border-[var(--color-hairline)] flex items-center justify-between [-webkit-app-region:no-drag] shrink-0">
        <div className="flex items-center gap-1.5">
          <span
            ref={sidebarDotRef}
            className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] shadow-[0_0_6px_rgba(0,217,146,0.5)]"
          />
          <span className="text-[11px] text-[var(--color-body)]">System Online</span>
        </div>
        <span className="text-[10px] font-[var(--font-mono)] text-[var(--color-mute)] bg-[rgba(255,255,255,0.03)] py-0.5 px-1.5 rounded-[3px] border border-[rgba(61,58,57,0.4)]">
          v1.0.0
        </span>
      </div>
    </div>
  )
}
