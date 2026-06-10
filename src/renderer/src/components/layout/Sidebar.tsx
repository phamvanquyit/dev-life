import {
  CloudServerOutlined,
  HomeOutlined,
  LaptopOutlined,
  RocketOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  TranslationOutlined,
} from '@ant-design/icons'
import { useMemo, useState } from 'react'

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
    icon: <RocketOutlined />,
    shortcut: '⌘1',
    category: 'Integrations',
    desc: 'Manage conversations',
  },
  {
    id: 'ai-proxy',
    label: 'AI Proxy',
    icon: <CloudServerOutlined />,
    shortcut: '⌘2',
    category: 'Integrations',
    desc: 'Gemini proxy server',
  },
  {
    id: 'system-cleaner',
    label: 'System Cleaner',
    icon: <LaptopOutlined />,
    shortcut: '⌘3',
    category: 'System',
    desc: 'Clean disk space',
  },
  {
    id: 'audio-translator',
    label: 'Audio Translator',
    icon: <TranslationOutlined />,
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
    onToolSelect(id)
  }

  const isHome = !activeTool

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Brand header */}
      <div className="sidebar-header">
        <div
          className={`sidebar-home-btn ${isHome ? 'active' : ''}`}
          onClick={() => onToolSelect('')}
        >
          <div className="sidebar-logo">
            <ThunderboltOutlined />
          </div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">Dev Life</span>
            <span className="sidebar-brand-tag">Developer Toolkit</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="sidebar-search">
        <div className={`sidebar-search-wrap ${searchFocused ? 'focused' : ''}`}>
          <SearchOutlined className="sidebar-search-icon" />
          <input
            type="text"
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          {search && (
            <button type="button" className="sidebar-search-clear" onClick={() => setSearch('')}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="sidebar-nav">
        {/* Home item */}
        <div
          className={`sidebar-item sidebar-item--home ${isHome ? 'active' : ''}`}
          onClick={() => onToolSelect('')}
        >
          <span className="sidebar-item-indicator" />
          <span className="sidebar-item-icon">
            <HomeOutlined />
          </span>
          <span className="sidebar-item-label">Dashboard</span>
        </div>

        {/* Separator */}
        <div className="sidebar-nav-sep" />

        {/* Grouped tools */}
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="sidebar-group">
            <div className="sidebar-section-title">
              <span className="sidebar-section-title-text">{category}</span>
              <span className="sidebar-section-title-line" />
            </div>
            {items.map((tool) => (
              <div
                key={tool.id}
                className={`sidebar-item ${activeTool === tool.id ? 'active' : ''}`}
                onClick={() => handleClick(tool.id)}
              >
                <span className="sidebar-item-indicator" />
                <span className="sidebar-item-icon">{tool.icon}</span>
                <span className="sidebar-item-label">{tool.label}</span>
                {tool.shortcut && <span className="sidebar-item-shortcut">{tool.shortcut}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-status">
          <span className="sidebar-footer-dot" />
          <span className="sidebar-footer-text">System Online</span>
        </div>
        <span className="sidebar-footer-version">v1.0.0</span>
      </div>
    </div>
  )
}
