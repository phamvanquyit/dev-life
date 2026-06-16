import {
  ArrowUpCircle,
  Check,
  CheckCircle,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Server,
  Settings as SettingsIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '../ui/Badge'
import { toast } from '../ui/Toast'

// ─── Constants ───────────────────────────────────────────────────────────────

// ─── MCP Settings Section ────────────────────────────────────────────────────

const MCP_PORT = 24816
const MCP_URL = `http://localhost:${MCP_PORT}/mcp`

function McpSection() {
  const [copied, setCopied] = useState<string | null>(null)

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        'dev-life-miniapps': {
          serverUrl: MCP_URL,
        },
      },
    },
    null,
    2,
  )

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    toast.success(`Copied ${label}!`)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div>
      {/* Status */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 flex items-center justify-center">
          <Server size={18} className="text-[var(--color-primary)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[var(--color-ink)] leading-tight">
            MCP Server
          </h3>
          <p className="text-xs text-[var(--color-mute)]">
            Model Context Protocol endpoint for AI tools
          </p>
        </div>
        <Badge className="!text-[10px] !m-0 !border-[var(--color-primary)]/30 !bg-[var(--color-primary)]/10 !text-[var(--color-primary)]">
          RUNNING
        </Badge>
      </div>

      {/* Endpoint URL */}
      <div className="border border-[var(--color-hairline)] rounded-lg bg-[var(--color-canvas-soft)] p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)]">
            Endpoint URL
          </span>
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] text-[var(--color-primary)] bg-transparent border-none cursor-pointer transition-opacity hover:opacity-80"
            onClick={() => copyText(MCP_URL, 'URL')}
          >
            {copied === 'URL' ? <Check size={10} /> : <Copy size={10} />}
            {copied === 'URL' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <code className="block text-sm font-[var(--font-mono)] text-[var(--color-primary)] select-all break-all">
          {MCP_URL}
        </code>
      </div>

      {/* Config JSON */}
      <div className="border border-[var(--color-hairline)] rounded-lg bg-[var(--color-canvas-soft)] p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)]">
            MCP Configuration
          </span>
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] text-[var(--color-primary)] bg-transparent border-none cursor-pointer transition-opacity hover:opacity-80"
            onClick={() => copyText(mcpConfig, 'config')}
          >
            {copied === 'config' ? <Check size={10} /> : <Copy size={10} />}
            {copied === 'config' ? 'Copied' : 'Copy JSON'}
          </button>
        </div>
        <pre className="text-xs font-[var(--font-mono)] text-[var(--color-body)] bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-md p-3 overflow-x-auto select-all m-0 leading-relaxed">
          {mcpConfig}
        </pre>
      </div>
    </div>
  )
}

// ─── About & Updates Section ─────────────────────────────────────────────────

function UpdateSection() {
  const [appVersion, setAppVersion] = useState('...')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<'idle' | 'up-to-date' | 'available'>('idle')
  const [updateInfo, setUpdateInfo] = useState<any>(null)

  useEffect(() => {
    window.api?.getAppVersion().then((v: string) => setAppVersion(v || '1.0.0'))

    // Check cached update status
    window.api?.getUpdateStatus().then((result: { hasUpdate: boolean; info: any }) => {
      if (result?.hasUpdate && result.info) {
        setUpdateInfo(result.info)
        setCheckResult('available')
      }
    })

    // Listen for update events
    const cleanup = window.api?.onUpdateAvailable((info: any) => {
      setUpdateInfo(info)
      setCheckResult('available')
    })
    return () => cleanup?.()
  }, [])

  const handleCheckUpdate = async () => {
    setChecking(true)
    setCheckResult('idle')
    try {
      const result = await window.api?.checkForUpdate()
      if (result?.hasUpdate && result.info) {
        setUpdateInfo(result.info)
        setCheckResult('available')
      } else {
        setCheckResult('up-to-date')
      }
    } catch {
      toast.error('Failed to check for updates')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 flex items-center justify-center">
          <ArrowUpCircle size={18} className="text-[var(--color-primary)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[var(--color-ink)] leading-tight">
            About & Updates
          </h3>
          <p className="text-xs text-[var(--color-mute)]">App version and update management</p>
        </div>
      </div>

      {/* Version info card */}
      <div className="border border-[var(--color-hairline)] rounded-lg bg-[var(--color-canvas-soft)] p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)] block mb-1">
              Current Version
            </span>
            <span className="font-[var(--font-mono)] text-sm font-[550] text-[var(--color-ink)]">
              v{appVersion}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCheckUpdate}
            disabled={checking}
            className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold bg-[var(--color-canvas)] text-[var(--color-ink)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] cursor-pointer hover:border-[var(--color-primary)]/30 hover:bg-[rgba(255,255,255,0.03)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checking ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <ArrowUpCircle size={13} />
                Check for Updates
              </>
            )}
          </button>
        </div>
      </div>

      {/* Update status */}
      {checkResult === 'up-to-date' && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas-soft)]">
          <CheckCircle size={14} className="text-[var(--color-primary)]" />
          <span className="text-sm text-[var(--color-body)]">You're up to date!</span>
        </div>
      )}

      {checkResult === 'available' && updateInfo && (
        <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5">
          <div className="flex items-center gap-3">
            <Download size={14} className="text-[var(--color-primary)]" />
            <div>
              <span className="text-sm font-medium text-[var(--color-ink)] block">
                v{updateInfo.latestVersion} is available
              </span>
              <span className="text-xs text-[var(--color-mute)]">
                Released {new Date(updateInfo.publishedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.api?.openRelease(updateInfo.releaseUrl)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-[var(--color-primary)] text-[#101010] rounded-[var(--radius-sm)] border-none cursor-pointer hover:brightness-110 transition-all"
          >
            <ExternalLink size={11} />
            Download
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Settings Component ──────────────────────────────────────────────────────

export default function Settings() {
  return (
    <div className="max-w-6xl mx-auto w-full">
      {/* Page header — unified pattern (matches Dashboard) */}
      <div className="flex flex-col items-start pt-2 pb-8">
        <div className="flex items-center gap-2 mb-4">
          <SettingsIcon size={16} className="text-[var(--color-primary)]" />
          <span className="text-sm font-semibold tracking-[2.52px] uppercase text-[var(--color-primary)] font-[var(--font-sans)]">
            SETTINGS
          </span>
        </div>

        <h1 className="text-[36px] font-normal tracking-[-0.9px] leading-[40px] text-[var(--color-ink-strong)] m-0 mb-3">
          App <span className="text-[var(--color-primary)]">Settings</span>
        </h1>

        <p className="text-base font-normal leading-[26px] text-[var(--color-body)] max-w-[480px] m-0">
          Configuration, integrations, and update management.
        </p>
      </div>

      {/* Dashed section divider */}
      <div className="w-full h-px border-t border-dashed border-[rgba(79,93,117,0.4)] mb-8" />

      {/* MCP Section */}
      <McpSection />

      {/* Dashed section divider */}
      <div className="w-full h-px border-t border-dashed border-[rgba(79,93,117,0.4)] my-8" />

      {/* About & Updates Section */}
      <UpdateSection />
    </div>
  )
}
