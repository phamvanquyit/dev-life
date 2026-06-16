import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}

export function Badge({ children, className = '', style }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0 text-[10px] font-medium leading-tight rounded-[var(--radius-xs)] border border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] text-[var(--color-mute)] ${className}`}
      style={style}
    >
      {children}
    </span>
  )
}
