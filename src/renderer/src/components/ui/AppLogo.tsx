import { useId } from 'react'

export default function AppLogo({
  size = 24,
  className = '',
}: {
  size?: number
  className?: string
}) {
  const id = useId()
  const gradId = `${id}-grad`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Dev Life logo"
    >
      <title>Dev Life</title>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#00d992" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>

      {/* { */}
      <path
        d="M 160 96 Q 110 96, 110 146 L 110 216 Q 110 256, 65 256 Q 110 256, 110 296 L 110 366 Q 110 416, 160 416"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Single heartbeat pulse */}
      <polyline
        points="175,256 220,256 248,170 268,342 296,256 337,256"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* } */}
      <path
        d="M 352 96 Q 402 96, 402 146 L 402 216 Q 402 256, 447 256 Q 402 256, 402 296 L 402 366 Q 402 416, 352 416"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
