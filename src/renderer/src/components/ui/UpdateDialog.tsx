import { ArrowRight, Download, ExternalLink, FileDown, X } from 'lucide-react'
import { useState } from 'react'

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
  const [downloading, setDownloading] = useState<string | null>(null)

  const handleDownloadAsset = (url: string, name: string) => {
    setDownloading(name)
    window.api?.openRelease(url)
    setTimeout(() => setDownloading(null), 2000)
  }

  const handleOpenRelease = () => {
    window.api?.openRelease(info.releaseUrl)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
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
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-mute)] hover:text-[var(--color-ink)] hover:bg-[rgba(255,255,255,0.06)] transition-colors cursor-pointer border-none bg-transparent"
          >
            <X size={14} />
          </button>
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

        {/* Download assets */}
        {info.assets.length > 0 && (
          <div className="px-6 py-4 border-t border-[var(--color-hairline)]">
            <h3 className="text-[11px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)] m-0 mb-3">
              Downloads
            </h3>
            <div className="flex flex-col gap-2">
              {info.assets.map((asset) => (
                <button
                  type="button"
                  key={asset.name}
                  onClick={() => handleDownloadAsset(asset.downloadUrl, asset.name)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-canvas)] hover:bg-[rgba(255,255,255,0.03)] hover:border-[var(--color-primary)]/30 transition-all cursor-pointer group"
                >
                  <FileDown
                    size={14}
                    className="text-[var(--color-mute)] group-hover:text-[var(--color-primary)] transition-colors shrink-0"
                  />
                  <span className="flex-1 text-left text-[13px] font-[var(--font-mono)] text-[var(--color-ink)] truncate">
                    {asset.name}
                  </span>
                  <span className="text-[11px] text-[var(--color-mute)] shrink-0">
                    {downloading === asset.name ? '✓ Opening...' : formatBytes(asset.size)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-6 py-4 border-t border-[var(--color-hairline)] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onDismissVersion}
            className="px-4 py-2 text-[13px] font-medium text-[var(--color-mute)] hover:text-[var(--color-body)] bg-transparent border-none cursor-pointer transition-colors"
          >
            Skip this version
          </button>
          <button
            type="button"
            onClick={handleOpenRelease}
            className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold bg-[var(--color-primary)] text-[#101010] rounded-[var(--radius-sm)] border-none cursor-pointer hover:brightness-110 transition-all"
          >
            <ExternalLink size={13} />
            View on GitHub
          </button>
        </div>
      </div>
    </div>
  )
}
