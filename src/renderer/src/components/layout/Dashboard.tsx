import gsap from 'gsap'
import { Cloud, Rocket, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useGlowPulse, usePulseGlow } from '../../hooks/useAnimations'

interface DashboardProps {
  onToolSelect: (id: string) => void
}

const quickTools = [
  {
    id: 'antigravity-manager',
    icon: <Rocket size={18} />,
    label: 'Antigravity',
    desc: 'Manage Antigravity 2.0 conversations',
    accent: '#00d992',
  },
  {
    id: 'ai-proxy',
    icon: <Cloud size={18} />,
    label: 'AI Proxy',
    desc: 'OpenAI-compatible proxy for Gemini',
    accent: '#2fd6a1',
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

  // GSAP refs
  const glowRef = useGlowPulse(6)
  const dotRef = usePulseGlow(
    '0 0 4px rgba(0, 217, 146, 0.3)',
    '0 0 10px rgba(0, 217, 146, 0.7)',
    2,
  )
  const cardsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
    const interval = setInterval(() => {
      setTime(getCurrentTime())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Card entrance animation
  useEffect(() => {
    if (!mounted || !cardsRef.current) return
    const cards = cardsRef.current.querySelectorAll('[data-card]')
    gsap.fromTo(
      cards,
      { opacity: 0, y: 12 },
      {
        opacity: 1,
        y: 0,
        duration: 0.4,
        ease: 'power2.out',
        stagger: 0.08,
        delay: 0.2,
      },
    )
  }, [mounted])

  return (
    <div
      className={`flex flex-col h-full p-0 transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      {/* Hero welcome section */}
      <div className="relative flex flex-col items-start pt-12 pb-10 overflow-hidden">
        <div
          ref={glowRef}
          className="absolute -top-[60px] -left-10 w-80 h-80 rounded-full bg-[radial-gradient(circle,rgba(0,217,146,0.08)_0%,transparent_70%)] pointer-events-none"
        />

        <div className="flex items-center gap-2 mb-4 relative z-[1]">
          <Zap size={16} className="text-[var(--color-primary)]" />
          <span className="text-sm font-semibold tracking-[2.52px] uppercase text-[var(--color-primary)] font-[var(--font-sans)]">
            DEV LIFE
          </span>
        </div>

        <h1 className="text-5xl font-normal tracking-[-0.65px] leading-[56px] text-[var(--color-ink-strong)] m-0 mb-3 relative z-[1]">
          {getGreeting()}, <span className="text-[var(--color-primary)]">Developer</span>
        </h1>

        <p className="text-base font-normal leading-[26px] text-[var(--color-body)] max-w-[480px] m-0 mb-5 relative z-[1]">
          Your everyday developer toolkit. Fast, offline, and beautiful.
        </p>

        <div className="flex items-center gap-3 relative z-[1]">
          <span className="font-[var(--font-mono)] text-2xl font-[550] text-[var(--color-ink)] tracking-[-0.3px]">
            {time}
          </span>
          <span className="w-px h-[18px] bg-[var(--color-hairline)]" />
          <span className="text-sm text-[var(--color-mute)]">{getCurrentDate()}</span>
        </div>
      </div>

      {/* Dashed section divider */}
      <div className="w-full h-px border-t border-dashed border-[rgba(79,93,117,0.4)] mt-2 mb-8" />

      {/* Quick access section */}
      <div className="flex-1 min-h-0">
        <div className="text-xs font-semibold tracking-[2.52px] uppercase text-[var(--color-mute)] mb-4">
          QUICK ACCESS
        </div>
        <div ref={cardsRef} className="grid grid-cols-2 gap-3">
          {quickTools.map((tool) => (
            <div
              key={tool.id}
              data-card
              className="group flex items-center gap-3.5 py-4 px-[18px] bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] cursor-pointer transition-all duration-200 relative overflow-hidden opacity-0 before:content-[''] before:absolute before:inset-0 before:bg-linear-to-br before:from-[rgba(0,217,146,0.04)] before:to-transparent before:opacity-0 before:transition-opacity before:duration-[250ms] before:pointer-events-none hover:border-[var(--color-primary)] hover:shadow-[0_0_15px_rgba(0,217,146,0.08)] hover:before:opacity-100 active:scale-[0.985]"
              onClick={() => {
                if (tool.id === 'antigravity-manager') {
                  window.api?.ensureAntigravityRunning?.()
                }
                onToolSelect(tool.id)
              }}
            >
              <div
                className="w-10 h-10 flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-glow)] text-lg shrink-0 transition-transform duration-200 group-hover:scale-[1.08]"
                style={{ color: tool.accent }}
              >
                {tool.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[var(--color-ink)] leading-5">
                  {tool.label}
                </div>
                <div className="text-xs text-[var(--color-mute)] leading-4 mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                  {tool.desc}
                </div>
              </div>
              <div className="text-base text-[var(--color-mute)] shrink-0 transition-all duration-200 group-hover:text-[var(--color-primary)] group-hover:translate-x-[3px]">
                →
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-6 pt-5 mt-auto border-t border-dashed border-[rgba(79,93,117,0.4)]">
        <div className="flex items-center gap-2">
          <span
            ref={dotRef}
            className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] shadow-[0_0_8px_rgba(0,217,146,0.5)]"
          />
          <span className="text-xs text-[var(--color-body)]">System Online</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-[var(--font-mono)] text-[11px] text-[var(--color-mute)]">
            v1.0.0
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-[var(--font-mono)] text-[11px] text-[var(--color-mute)]">
            Electron + React
          </span>
        </div>
      </div>
    </div>
  )
}
