import {
  CloudServerOutlined,
  LaptopOutlined,
  RocketOutlined,
  ThunderboltOutlined,
  TranslationOutlined,
} from '@ant-design/icons'
import { useEffect, useState } from 'react'

interface DashboardProps {
  onToolSelect: (id: string) => void
}

const quickTools = [
  {
    id: 'antigravity-manager',
    icon: <RocketOutlined />,
    label: 'Antigravity',
    desc: 'Manage Antigravity 2.0 conversations',
    accent: '#00d992',
  },
  {
    id: 'ai-proxy',
    icon: <CloudServerOutlined />,
    label: 'AI Proxy',
    desc: 'OpenAI-compatible proxy for Gemini',
    accent: '#2fd6a1',
  },
  {
    id: 'system-cleaner',
    icon: <LaptopOutlined />,
    label: 'System Cleaner',
    desc: 'Scan & clean disk space',
    accent: '#10b981',
  },
  {
    id: 'audio-translator',
    icon: <TranslationOutlined />,
    label: 'Audio Translator',
    desc: 'Nghe tiếng Anh → Dịch tiếng Việt',
    accent: '#00d992',
  },
]

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function getCurrentTime(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function getCurrentDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function Dashboard({ onToolSelect }: DashboardProps) {
  const [time, setTime] = useState(getCurrentTime())
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const interval = setInterval(() => {
      setTime(getCurrentTime())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className={`dashboard ${mounted ? 'dashboard--visible' : ''}`}>
      {/* Hero welcome section */}
      <div className="dashboard-hero">
        <div className="dashboard-hero-glow" />

        <div className="dashboard-greeting-row">
          <ThunderboltOutlined className="dashboard-bolt-icon" />
          <span className="dashboard-eyebrow">DEV LIFE</span>
        </div>

        <h1 className="dashboard-headline">
          {getGreeting()}, <span className="dashboard-headline-accent">Developer</span>
        </h1>

        <p className="dashboard-subtitle">
          Your everyday developer toolkit. Fast, offline, and beautiful.
        </p>

        <div className="dashboard-time-row">
          <span className="dashboard-time">{time}</span>
          <span className="dashboard-time-sep" />
          <span className="dashboard-date">{getCurrentDate()}</span>
        </div>
      </div>

      {/* Dashed section divider */}
      <div className="dashboard-divider" />

      {/* Quick access section */}
      <div className="dashboard-section">
        <div className="dashboard-section-eyebrow">QUICK ACCESS</div>
        <div className="dashboard-tools-grid">
          {quickTools.map((tool, index) => (
            <div
              key={tool.id}
              className="dashboard-tool-card"
              onClick={() => onToolSelect(tool.id)}
              style={{ animationDelay: `${index * 80 + 200}ms` }}
            >
              <div className="dashboard-tool-icon" style={{ color: tool.accent }}>
                {tool.icon}
              </div>
              <div className="dashboard-tool-info">
                <div className="dashboard-tool-label">{tool.label}</div>
                <div className="dashboard-tool-desc">{tool.desc}</div>
              </div>
              <div className="dashboard-tool-arrow">→</div>
            </div>
          ))}
        </div>
      </div>

      {/* Status bar */}
      <div className="dashboard-status-bar">
        <div className="dashboard-status-item">
          <span className="dashboard-status-dot dashboard-status-dot--live" />
          <span className="dashboard-status-label">System Online</span>
        </div>
        <div className="dashboard-status-item">
          <span className="dashboard-status-label-mono">v1.0.0</span>
        </div>
        <div className="dashboard-status-item">
          <span className="dashboard-status-label-mono">Electron + React</span>
        </div>
      </div>
    </div>
  )
}
