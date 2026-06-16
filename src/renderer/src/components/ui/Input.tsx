import type { InputHTMLAttributes } from 'react'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'small' | 'middle' | 'large'
}

export function Input({ size = 'middle', className = '', ...props }: InputProps) {
  const sizeClasses: Record<string, string> = {
    small: 'h-7 px-2.5 text-[12px]',
    middle: 'h-9 px-3 text-sm',
    large: 'h-10 px-3.5 text-sm',
  }

  return (
    <input
      {...props}
      className={`w-full bg-[var(--color-canvas)] text-[var(--color-ink)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] outline-none transition-colors placeholder:text-[var(--color-mute)] focus:border-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses[size]} ${className}`}
    />
  )
}
