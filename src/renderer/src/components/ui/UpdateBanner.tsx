import { ArrowUpCircle, X } from 'lucide-react'

interface UpdateBannerProps {
  latestVersion: string
  onViewRelease: () => void
  onDismiss: () => void
}

export default function UpdateBanner({
  latestVersion,
  onViewRelease,
  onDismiss,
}: UpdateBannerProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-[var(--color-primary)]/5 border-b border-[var(--color-primary)]/15 shrink-0">
      <ArrowUpCircle size={14} className="text-[var(--color-primary)] shrink-0 animate-pulse" />
      <span className="text-[12px] text-[var(--color-body)] flex-1">
        <span className="font-medium text-[var(--color-ink)]">Dev Life v{latestVersion}</span> is
        available
      </span>
      <button
        type="button"
        onClick={onViewRelease}
        className="px-3 py-1 text-[11px] font-semibold bg-[var(--color-primary)] text-[#101010] rounded-[var(--radius-sm)] border-none cursor-pointer hover:brightness-110 transition-all"
      >
        View Update
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="w-5 h-5 flex items-center justify-center text-[var(--color-mute)] hover:text-[var(--color-ink)] bg-transparent border-none cursor-pointer transition-colors rounded-full hover:bg-[rgba(255,255,255,0.06)]"
      >
        <X size={10} />
      </button>
    </div>
  )
}
