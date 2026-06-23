import {
  ArrowUpCircle,
  Check,
  CheckCircle,
  Copy,
  Download,
  Loader2,
  Server,
  Settings as SettingsIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '../ui/Badge'
import { toast } from '../ui/Toast'
import LlmProviders from './LlmProviders'

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

type InstallStage = 'idle' | 'downloading' | 'extracting' | 'installing' | 'done' | 'error'

function UpdateSection() {
  const [appVersion, setAppVersion] = useState('...')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<'idle' | 'up-to-date' | 'available'>('idle')
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [stage, setStage] = useState<InstallStage>('idle')
  const [percent, setPercent] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [preRelease, setPreRelease] = useState(false)

  const isInstalling = stage === 'downloading' || stage === 'extracting' || stage === 'installing'

  useEffect(() => {
    window.api?.getAppVersion().then((v: string) => setAppVersion(v || '...'))

    // Load pre-release preference
    window.api?.getConfig('include-prerelease').then((v: string | null) => {
      setPreRelease(v === 'true')
    })

    // Check cached update status
    window.api?.getUpdateStatus().then((result: { hasUpdate: boolean; info: any }) => {
      if (result?.hasUpdate && result.info) {
        setUpdateInfo(result.info)
        setCheckResult('available')
      }
    })

    // Listen for update events
    const cleanupUpdate = window.api?.onUpdateAvailable((info: any) => {
      setUpdateInfo(info)
      setCheckResult('available')
    })

    // Listen for install progress
    const cleanupProgress = window.api?.onUpdateProgress(
      (progress: { stage: string; percent?: number; message?: string; error?: string }) => {
        setStage(progress.stage as InstallStage)
        if (progress.percent !== undefined) setPercent(progress.percent)
        if (progress.message) setProgressMsg(progress.message)
        if (progress.error) setErrorMsg(progress.error)
      },
    )

    return () => {
      cleanupUpdate?.()
      cleanupProgress?.()
    }
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

  const handleInstall = () => {
    setStage('downloading')
    setPercent(0)
    setProgressMsg('Preparing...')
    setErrorMsg('')
    window.api?.installUpdate()
  }

  const handleRestart = () => {
    window.api?.restartApp()
  }

  const handleTogglePreRelease = async (enabled: boolean) => {
    setPreRelease(enabled)
    await window.api?.setConfig('include-prerelease', enabled ? 'true' : 'false')
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
            disabled={checking || isInstalling}
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

      {/* Pre-release toggle */}
      <div className="flex items-center justify-between px-4 py-3 mb-4 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas-soft)]">
        <div>
          <span className="text-sm font-medium text-[var(--color-ink)] block">
            Include pre-release updates
          </span>
          <span className="text-[11px] text-[var(--color-mute)]">
            Get notified about beta and alpha versions
          </span>
        </div>
        <button
          type="button"
          onClick={() => handleTogglePreRelease(!preRelease)}
          className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer border-none ${
            preRelease
              ? 'bg-[var(--color-primary)]'
              : 'bg-[var(--color-canvas)] border border-[var(--color-hairline)]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${
              preRelease ? 'translate-x-4 bg-[#101010]' : 'translate-x-0 bg-[var(--color-mute)]'
            }`}
          />
        </button>
      </div>

      {/* Update status */}
      {checkResult === 'up-to-date' && stage === 'idle' && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas-soft)]">
          <CheckCircle size={14} className="text-[var(--color-primary)]" />
          <span className="text-sm text-[var(--color-body)]">You're up to date!</span>
        </div>
      )}

      {checkResult === 'available' && updateInfo && stage === 'idle' && (
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
            onClick={handleInstall}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-[var(--color-primary)] text-[#101010] rounded-[var(--radius-sm)] border-none cursor-pointer hover:brightness-110 transition-all"
          >
            <Download size={11} />
            Install Update
          </button>
        </div>
      )}

      {/* Install progress */}
      {isInstalling && (
        <div className="px-4 py-3 rounded-lg border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] font-semibold text-[var(--color-ink)]">
              {stage === 'downloading'
                ? 'Downloading'
                : stage === 'extracting'
                  ? 'Extracting'
                  : 'Installing'}
            </span>
            {stage === 'downloading' && percent >= 0 && (
              <span className="text-[11px] font-[var(--font-mono)] text-[var(--color-mute)]">
                {percent}%
              </span>
            )}
          </div>
          <div className="h-1.5 bg-[var(--color-canvas)] rounded-full overflow-hidden border border-[var(--color-hairline)]">
            {stage === 'downloading' && percent >= 0 ? (
              <div
                className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            ) : (
              <div className="h-full bg-[var(--color-primary)] rounded-full w-1/3 animate-[indeterminate_1.5s_ease-in-out_infinite]" />
            )}
          </div>
          <p className="text-[11px] text-[var(--color-mute)] mt-1.5 m-0">{progressMsg}</p>
          <style>{`
            @keyframes indeterminate {
              0% { transform: translateX(-100%); }
              50% { transform: translateX(200%); }
              100% { transform: translateX(-100%); }
            }
          `}</style>
        </div>
      )}

      {/* Done */}
      {stage === 'done' && (
        <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5">
          <div className="flex items-center gap-3">
            <CheckCircle size={14} className="text-[var(--color-primary)]" />
            <span className="text-sm font-medium text-[var(--color-ink)]">
              Update installed! Restart to apply.
            </span>
          </div>
          <button
            type="button"
            onClick={handleRestart}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-[var(--color-primary)] text-[#101010] rounded-[var(--radius-sm)] border-none cursor-pointer hover:brightness-110 transition-all"
          >
            Restart Now
          </button>
        </div>
      )}

      {/* Error */}
      {stage === 'error' && (
        <div className="px-4 py-3 rounded-lg border border-red-500/20 bg-red-500/5">
          <div className="flex items-start gap-3">
            <Download size={14} className="text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-red-400 block">Update failed</span>
              <span className="text-[11px] text-[var(--color-mute)] block mt-1 break-words">
                {errorMsg}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setStage('idle')
                setErrorMsg('')
              }}
              className="px-3 py-1 text-[11px] font-semibold text-[var(--color-ink)] bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] cursor-pointer hover:border-[var(--color-primary)]/30 transition-all shrink-0"
            >
              Retry
            </button>
          </div>
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

      {/* LLM Providers Section */}
      <LlmProviders />

      {/* Dashed section divider */}
      <div className="w-full h-px border-t border-dashed border-[rgba(79,93,117,0.4)] my-8" />

      {/* About & Updates Section */}
      <UpdateSection />
    </div>
  )
}
