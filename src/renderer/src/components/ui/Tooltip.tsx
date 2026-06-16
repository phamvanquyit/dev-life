import { type ReactNode, useRef, useState } from 'react'

interface TooltipProps {
  title: ReactNode
  children: ReactNode
  placement?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ title, children, placement = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(true)
  }

  const hide = () => {
    timeoutRef.current = setTimeout(() => setVisible(false), 100)
  }

  const placementClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }

  if (!title) return <>{children}</>

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div
          className={`absolute z-50 px-2 py-1 text-[11px] font-medium text-[var(--color-ink)] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] shadow-lg whitespace-nowrap pointer-events-none ${placementClasses[placement]}`}
        >
          {title}
        </div>
      )}
    </div>
  )
}
