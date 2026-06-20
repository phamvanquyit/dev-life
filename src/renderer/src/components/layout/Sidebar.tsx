import * as LucideIcons from 'lucide-react'
import { Box, Home, Package, Search, Settings } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { MiniAppInfo } from '../../App'
import AppLogo from '../ui/AppLogo'

interface SidebarProps {
  activeTool: string
  onToolSelect: (id: string) => void
  collapsed: boolean
  miniApps?: MiniAppInfo[]
  updateAvailable?: boolean
}

// Resolve a string icon name to a Lucide React component
function getLucideIcon(name: string, size = 15): React.ReactNode {
  const icons = LucideIcons as any
  const Icon = icons[name]
  if (Icon && typeof Icon === 'function') {
    return <Icon size={size} />
  }
  return <Box size={size} />
}

export default function Sidebar({
  activeTool,
  onToolSelect,
  collapsed,
  miniApps = [],
  updateAvailable = false,
}: SidebarProps) {
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)

  const filteredMiniApps = useMemo(() => {
    if (!search.trim()) return miniApps
    const q = search.toLowerCase()
    return miniApps.filter((a) => a.name.toLowerCase().includes(q))
  }, [search, miniApps])

  const isHome = !activeTool

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
          <div className="w-[30px] h-[30px] flex items-center justify-center shrink-0 transition-transform duration-[250ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.06]">
            <AppLogo size={30} />
          </div>
          <div className="flex flex-col gap-px min-w-0">
            <span className="text-[13px] font-semibold text-[var(--color-ink)] leading-[1.2] tracking-[-0.2px]">
              {import.meta.env.DEV ? 'Dev Life - Development' : 'Dev Life'}
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

        {/* Manage Apps */}
        <div
          className={`group flex items-center gap-2.5 py-[7px] px-2.5 rounded-[var(--radius-sm)] cursor-pointer text-[13px] transition-all duration-150 select-none [-webkit-app-region:no-drag] relative my-px ${activeTool === 'mini-apps' ? 'bg-[var(--color-primary-glow)] text-[var(--color-primary)]' : 'text-[var(--color-body)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--color-ink)]'}`}
          onClick={() => onToolSelect('mini-apps')}
        >
          <span
            className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-sm bg-[var(--color-primary)] transition-[height] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${activeTool === 'mini-apps' ? 'h-4 shadow-[0_0_8px_rgba(0,217,146,0.3)]' : 'h-0 group-hover:h-3 group-hover:bg-[var(--color-hairline)]'}`}
          />
          <span
            className={`text-[15px] w-5 text-center shrink-0 transition-transform duration-200 group-hover:scale-110 ${activeTool === 'mini-apps' ? 'text-[var(--color-primary)]' : ''}`}
          >
            <Package size={15} />
          </span>
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            Apps
          </span>
        </div>

        {/* Mini Apps section */}
        {(filteredMiniApps.length > 0 || !search.trim()) && (
          <div className="mb-1">
            <div className="flex items-center gap-2 pt-3.5 pb-1.5 px-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-[2.52px] text-[var(--color-mute)] whitespace-nowrap shrink-0">
                Mini Apps
              </span>
              <span className="flex-1 h-px bg-linear-to-r from-[var(--color-hairline)] to-transparent opacity-50" />
            </div>

            {/* Installed mini apps */}
            {filteredMiniApps.map((app) => {
              const routeId = `mini/${app.id}`
              const isActive = activeTool === routeId
              return (
                <div
                  key={app.id}
                  className={`group flex items-center gap-2.5 py-[7px] px-2.5 rounded-[var(--radius-sm)] cursor-pointer text-[13px] transition-all duration-150 select-none [-webkit-app-region:no-drag] relative my-px ${isActive ? 'bg-[var(--color-primary-glow)] text-[var(--color-primary)]' : 'text-[var(--color-body)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--color-ink)]'}`}
                  onClick={() => onToolSelect(routeId)}
                >
                  <span
                    className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-sm bg-[var(--color-primary)] transition-[height] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isActive ? 'h-4 shadow-[0_0_8px_rgba(0,217,146,0.3)]' : 'h-0 group-hover:h-3 group-hover:bg-[var(--color-hairline)]'}`}
                  />
                  <span
                    className={`text-[15px] w-5 text-center shrink-0 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-[var(--color-primary)]' : ''}`}
                  >
                    {getLucideIcon(app.icon)}
                  </span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {app.name}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="px-3 pb-1 [-webkit-app-region:no-drag] pb-3">
        <div
          className={`group flex items-center gap-2.5 py-[7px] px-2.5 rounded-[var(--radius-sm)] cursor-pointer text-[13px] transition-all duration-150 select-none relative my-px ${activeTool === 'settings' ? 'bg-[var(--color-primary-glow)] text-[var(--color-primary)]' : 'text-[var(--color-mute)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--color-ink)]'}`}
          onClick={() => onToolSelect('settings')}
        >
          <span
            className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-sm bg-[var(--color-primary)] transition-[height] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${activeTool === 'settings' ? 'h-4 shadow-[0_0_8px_rgba(0,217,146,0.3)]' : 'h-0 group-hover:h-3 group-hover:bg-[var(--color-hairline)]'}`}
          />
          <span
            className={`text-[15px] w-5 text-center shrink-0 transition-transform duration-200 group-hover:scale-110 ${activeTool === 'settings' ? 'text-[var(--color-primary)]' : ''}`}
          >
            <Settings size={15} />
          </span>
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            Settings
          </span>
          {updateAvailable && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-primary)] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-primary)]" />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
