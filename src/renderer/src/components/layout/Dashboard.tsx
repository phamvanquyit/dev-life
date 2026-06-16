import { Check, Copy, Server } from 'lucide-react'
import { useEffect, useState } from 'react'
import AppLogo from '../ui/AppLogo'

const MCP_PORT = 24816
const MCP_URL = `http://localhost:${MCP_PORT}/mcp`

type McpClient = 'antigravity' | 'claude'

const CLIENT_LABELS: Record<McpClient, string> = {
  antigravity: 'Antigravity',
  claude: 'Claude Desktop',
}

function getMcpConfig(client: McpClient): string {
  // Antigravity uses "serverUrl", Claude Desktop uses "url"
  const serverEntry = client === 'antigravity' ? { serverUrl: MCP_URL } : { url: MCP_URL }

  return JSON.stringify(
    {
      mcpServers: {
        'dev-life-miniapps': serverEntry,
      },
    },
    null,
    2,
  )
}

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

function McpConfigSection() {
  const [activeClient, setActiveClient] = useState<McpClient>('antigravity')
  const [copied, setCopied] = useState(false)

  const config = getMcpConfig(activeClient)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(config)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Section heading */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server size={16} className="text-[var(--color-primary)]" />
          <span className="text-sm font-semibold tracking-[2.52px] uppercase text-[var(--color-mute)] font-[var(--font-sans)]">
            MCP SERVER
          </span>
        </div>
      </div>

      <p className="text-sm text-[var(--color-body)] leading-[22px] m-0">
        Add this config to your AI editor to connect via{' '}
        <span className="font-[var(--font-mono)] text-[13px] text-[var(--color-canvas-text-soft)] bg-[var(--color-canvas-soft)] px-1.5 py-0.5 rounded">
          MCP
        </span>{' '}
        and manage mini apps with AI.
      </p>

      {/* Client tabs */}
      <div className="flex items-center gap-0 border border-[var(--color-hairline)] rounded-md w-fit overflow-hidden">
        {(Object.keys(CLIENT_LABELS) as McpClient[]).map((client) => (
          <button
            type="button"
            key={client}
            onClick={() => setActiveClient(client)}
            className={`px-4 py-2 text-[13px] font-medium transition-colors cursor-pointer border-none outline-none ${
              activeClient === client
                ? 'bg-[var(--color-primary)] text-[#101010]'
                : 'bg-[var(--color-canvas)] text-[var(--color-body)] hover:text-[var(--color-ink)] hover:bg-[var(--color-canvas-soft)]'
            }`}
          >
            {CLIENT_LABELS[client]}
          </button>
        ))}
      </div>

      {/* Code mockup card */}
      <div className="relative border border-[var(--color-hairline)] rounded-lg bg-[var(--color-canvas)] overflow-hidden">
        {/* Card header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-hairline)]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--color-mute)] font-[var(--font-mono)]">
              {activeClient === 'antigravity' ? 'mcp_config.json' : 'claude_desktop_config.json'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--color-hairline)] bg-[var(--color-canvas)] text-[var(--color-body)] hover:text-[var(--color-ink)] hover:bg-[var(--color-canvas-soft)] transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check size={12} className="text-[var(--color-primary)]" />
                <span className="text-[var(--color-primary)]">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        {/* Code block */}
        <pre className="m-0 px-5 py-4 overflow-x-auto">
          <code className="font-[var(--font-mono)] text-[13px] leading-[18px] text-[var(--color-canvas-text-soft)]">
            {config}
          </code>
        </pre>
      </div>
    </div>
  )
}

export default function Dashboard() {
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
    <div
      className={`max-w-6xl mx-auto w-full transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      {/* Page header — unified pattern */}
      <div className="flex flex-col items-start pt-2 pb-8">
        <div className="flex items-center gap-2 mb-4">
          <AppLogo size={24} />
          <span className="text-sm font-semibold tracking-[2.52px] uppercase text-[var(--color-primary)] font-[var(--font-sans)]">
            DEV LIFE
          </span>
        </div>

        <h1 className="text-5xl font-normal tracking-[-0.65px] leading-[56px] text-[var(--color-ink-strong)] m-0 mb-3">
          {getGreeting()}, <span className="text-[var(--color-primary)]">Developer</span>
        </h1>

        <p className="text-base font-normal leading-[26px] text-[var(--color-body)] max-w-[480px] m-0 mb-5">
          Your everyday developer toolkit. Fast, offline, and beautiful.
        </p>

        <div className="flex items-center gap-3">
          <span className="font-[var(--font-mono)] text-2xl font-[550] text-[var(--color-ink)] tracking-[-0.3px]">
            {time}
          </span>
          <span className="w-px h-[18px] bg-[var(--color-hairline)]" />
          <span className="text-sm text-[var(--color-mute)]">{getCurrentDate()}</span>
        </div>
      </div>

      {/* Dashed section divider */}
      <div className="w-full h-px border-t border-dashed border-[rgba(79,93,117,0.4)] mb-8" />

      {/* MCP Config Section */}
      <McpConfigSection />
    </div>
  )
}
