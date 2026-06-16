import { AlertTriangle, ArrowRight, CheckCircle2, Download, ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface UpdateAsset {
  name: string
  downloadUrl: string
  size: number
}

interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseUrl: string
  publishedAt: string
  assets: UpdateAsset[]
}

interface UpdateDialogProps {
  info: UpdateInfo
  onClose: () => void
  onDismissVersion: () => void
}

type InstallStage = 'idle' | 'downloading' | 'extracting' | 'installing' | 'done' | 'error'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function UpdateDialog({ info, onClose, onDismissVersion }: UpdateDialogProps) {
  const [stage, setStage] = useState<InstallStage>('idle')
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const isInstalling = stage === 'downloading' || stage === 'extracting' || stage === 'installing'

  // Listen for progress events from main process
  useEffect(() => {
    const cleanup = window.api?.onUpdateProgress(
      (progress: { stage: string; percent?: number; message?: string; error?: string }) => {
        setStage(progress.stage as InstallStage)
        if (progress.percent !== undefined) setPercent(progress.percent)
        if (progress.message) setMessage(progress.message)
        if (progress.error) setErrorMsg(progress.error)
      },
    )
    return () => cleanup?.()
  }, [])

  const handleInstall = () => {
    setStage('downloading')
    setPercent(0)
    setMessage('Preparing...')
    setErrorMsg('')
    window.api?.installUpdate()
  }

  const handleRestart = () => {
    window.api?.restartApp()
  }

  const handleRetry = () => {
    setStage('idle')
    setErrorMsg('')
    setMessage('')
  }

  const handleOpenRelease = () => {
    window.api?.openRelease(info.releaseUrl)
  }

  // Check if a .zip asset is available for in-app install
  const hasZipAsset = info.assets.some((a) => a.name.endsWith('.zip'))
  const zipSize = info.assets.find((a) => a.name.endsWith('.zip'))?.size

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={stage === 'done' || isInstalling ? undefined : onClose}
    >
      <div
        className="w-full max-w-[520px] bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] shadow-[0_20px_60px_rgba(0,0,0,0.7),0_0_0_1px_rgba(148,163,184,0.1)_inset] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-hairline)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <Download size={16} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--color-ink)] m-0 leading-tight">
                Update Available
              </h2>
              <p className="text-[11px] text-[var(--color-mute)] m-0 mt-0.5">
                Published {formatDate(info.publishedAt)}
              </p>
            </div>
          </div>
          {!isInstalling && stage !== 'done' && (
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-mute)] hover:text-[var(--color-ink)] hover:bg-[rgba(255,255,255,0.06)] transition-colors cursor-pointer border-none bg-transparent"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Version comparison */}
        <div className="px-6 py-5 flex items-center justify-center gap-4 border-b border-[var(--color-hairline)] bg-[var(--color-canvas-soft)]">
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)]">
              Current
            </span>
            <span className="font-[var(--font-mono)] text-lg font-[550] text-[var(--color-body)]">
              v{info.currentVersion}
            </span>
          </div>
          <ArrowRight size={18} className="text-[var(--color-primary)] shrink-0" />
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-primary)]">
              Latest
            </span>
            <span className="font-[var(--font-mono)] text-lg font-[550] text-[var(--color-primary)]">
              v{info.latestVersion}
            </span>
          </div>
        </div>

        {/* Release notes */}
        <div className="px-6 py-4 max-h-[200px] overflow-y-auto">
          <h3 className="text-[11px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)] m-0 mb-3">
            Release Notes
          </h3>
          <div className="text-sm text-[var(--color-body)] leading-relaxed whitespace-pre-wrap break-words font-[var(--font-sans)]">
            {info.releaseNotes}
          </div>
        </div>

        {/* Progress section — shown during install */}
        {(isInstalling || stage === 'done' || stage === 'error') && (
          <div className="px-6 py-4 border-t border-[var(--color-hairline)]">
            {/* Progress bar */}
            {isInstalling && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold text-[var(--color-ink)]">
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
                <div className="h-1.5 bg-[var(--color-canvas-soft)] rounded-full overflow-hidden border border-[var(--color-hairline)]">
                  {stage === 'downloading' && percent >= 0 ? (
                    <div
                      className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${percent}%` }}
                    />
                  ) : (
                    <div className="h-full bg-[var(--color-primary)] rounded-full w-1/3 animate-[indeterminate_1.5s_ease-in-out_infinite]" />
                  )}
                </div>
                <p className="text-[11px] text-[var(--color-mute)] mt-1.5 m-0">{message}</p>
              </div>
            )}

            {/* Done */}
            {stage === 'done' && (
              <div className="flex items-center gap-3">
                <CheckCircle2 size={18} className="text-[var(--color-primary)] shrink-0" />
                <div className="flex-1">
                  <span className="text-sm font-medium text-[var(--color-ink)] block">
                    Update installed successfully!
                  </span>
                  <span className="text-[11px] text-[var(--color-mute)]">
                    Restart the app to apply the update.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRestart}
                  className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold bg-[var(--color-primary)] text-[#101010] rounded-[var(--radius-sm)] border-none cursor-pointer hover:brightness-110 transition-all"
                >
                  Restart Now
                </button>
              </div>
            )}

            {/* Error */}
            {stage === 'error' && (
              <div className="flex items-start gap-3">
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-red-400 block">Update failed</span>
                  <span className="text-[11px] text-[var(--color-mute)] block mt-1 break-words">
                    {errorMsg}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="px-3 py-1.5 text-[12px] font-semibold text-[var(--color-ink)] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] cursor-pointer hover:border-[var(--color-primary)]/30 transition-all shrink-0"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}

        {/* Actions — only shown when idle or error */}
        {stage === 'idle' && (
          <div className="px-6 py-4 border-t border-[var(--color-hairline)] flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onDismissVersion}
              className="px-4 py-2 text-[13px] font-medium text-[var(--color-mute)] hover:text-[var(--color-body)] bg-transparent border-none cursor-pointer transition-colors"
            >
              Skip this version
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenRelease}
                className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium text-[var(--color-body)] bg-transparent border border-[var(--color-hairline)] rounded-[var(--radius-sm)] cursor-pointer hover:bg-[rgba(255,255,255,0.03)] transition-all"
              >
                <ExternalLink size={12} />
                GitHub
              </button>
              {hasZipAsset && (
                <button
                  type="button"
                  onClick={handleInstall}
                  className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold bg-[var(--color-primary)] text-[#101010] rounded-[var(--radius-sm)] border-none cursor-pointer hover:brightness-110 transition-all"
                >
                  <Download size={13} />
                  Install Update
                  {zipSize && (
                    <span className="text-[11px] opacity-70">({formatBytes(zipSize)})</span>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* CSS animation for indeterminate progress bar */}
      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  )
}
