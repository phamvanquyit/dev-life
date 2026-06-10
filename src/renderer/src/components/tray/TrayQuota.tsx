import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

declare global {
  interface Window {
    api: any
  }
}

interface QuotaBucket {
  modelId: string
  remainingFraction: number
  resetTime: string | null
}

const modelOrder = ['claude-opus-4-6-thinking', 'gemini-3.1-pro-high', 'gemini-3.5-flash-low']

const getModelDisplayName = (modelId: string, defaultName?: string) => {
  const overrides: Record<string, string> = {
    'gemini-3.5-flash-low': 'Gemini 3.5 Flash (Medium)',
    'gemini-3.5-flash-agent': 'Gemini 3.5 Flash (High)',
    'gemini-3.5-flash-extra-low': 'Gemini 3.5 Flash (Low)',
    'gemini-3.1-pro-low': 'Gemini 3.1 Pro (Low)',
    'gemini-3.1-pro-high': 'Gemini 3.1 Pro (High)',
    'gemini-pro-agent': 'Gemini 3.1 Pro (High)',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6 (Thinking)',
    'claude-opus-4-6-thinking': 'Claude Opus 4.6 (Thinking)',
    'gpt-oss-120b-medium': 'GPT-OSS 120B (Medium)',
  }
  return overrides[modelId] || defaultName || modelId
}

const getRemainingTimeText = (resetTimeStr: string | null | undefined) => {
  if (!resetTimeStr) return ''
  const diffMs = new Date(resetTimeStr).getTime() - Date.now()
  if (diffMs <= 0) return 'Refreshes shortly'

  const totalMinutes = Math.floor(diffMs / (60 * 1000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

const isStandardModel = (modelId: string) => modelOrder.includes(modelId)

export default function TrayQuota() {
  const [status, setStatus] = useState<any>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [isWindowVisible, setIsWindowVisible] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const s = await window.api.getProxyStatus()
      setStatus(s)
    } catch {
      /* ignore */
    }
  }, [])

  // Listen for tray window visibility changes
  useEffect(() => {
    window.api.isTrayVisible().then((visible: boolean) => {
      setIsWindowVisible(visible)
    })

    const unsubscribe = window.api.onTrayVisibilityChange((visible: boolean) => {
      setIsWindowVisible(visible)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Manage data fetching interval based on window visibility
  useEffect(() => {
    if (!isWindowVisible) return

    // Load once immediately when window becomes visible
    fetchStatus()
    window.api
      .refreshProxyQuota()
      .then((res: any) => {
        if (res.success) fetchStatus()
      })
      .catch(() => {})

    // Load every 10s while open
    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)
  }, [isWindowVisible, fetchStatus])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await window.api.refreshProxyQuota()
      if (res.success) await fetchStatus()
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false)
    }
  }, [fetchStatus])

  const buckets: QuotaBucket[] = status?.quota?.buckets || []
  const models = status?.models || []

  const displayItems =
    buckets.length > 0
      ? buckets
          .filter((b: QuotaBucket) => isStandardModel(b.modelId))
          .map((b: QuotaBucket) => {
            const model = models.find((m: any) => m.id === b.modelId)
            return {
              modelId: b.modelId,
              displayName: getModelDisplayName(b.modelId, model?.display_name),
              remainingFraction: b.remainingFraction ?? 1.0,
              resetTime: b.resetTime,
            }
          })
      : models
          .filter((m: any) => isStandardModel(m.id))
          .map((m: any) => ({
            modelId: m.id,
            displayName: getModelDisplayName(m.id, m.display_name),
            remainingFraction: 1.0,
            resetTime: null,
          }))

  const sortedItems = [...displayItems].sort((a: any, b: any) => {
    const idxA = modelOrder.indexOf(a.modelId)
    const idxB = modelOrder.indexOf(b.modelId)
    if (idxA === -1 && idxB === -1) return a.modelId.localeCompare(b.modelId)
    if (idxA === -1) return 1
    if (idxB === -1) return -1
    return idxA - idxB
  })

  const renderBar = (fraction: number) => {
    const pct = Math.round(fraction * 100)
    const segments = Math.min(5, Math.max(0, Math.round(fraction * 5)))
    const isFull = segments === 5

    return (
      <div className="flex items-center gap-1">
        {[0, 1, 2, 3, 4].map((i) => {
          const filled = i < segments
          let color = 'rgba(255,255,255,0.06)'
          if (filled) {
            if (isFull) color = 'rgba(255,255,255,0.25)'
            else if (segments <= 1) color = '#ff4d4f'
            else if (segments <= 2) color = '#faad14'
            else color = '#00d992'
          }
          return (
            <div
              key={i}
              className="flex-1 h-[3px] rounded-[1.5px] transition-colors duration-300"
              style={{ backgroundColor: color }}
            />
          )
        })}
        <span
          className="text-[9px] font-semibold min-w-[26px] text-right font-[var(--font-mono)]"
          style={{
            color: pct <= 20 ? '#ff4d4f' : pct <= 40 ? '#faad14' : 'rgba(255,255,255,0.35)',
          }}
        >
          {pct}%
        </span>
      </div>
    )
  }

  if (!status?.hasCredentials) {
    return (
      <div className="flex flex-col">
        <div className="flex flex-col items-center justify-center py-[30px] px-3 gap-2">
          <span style={{ fontSize: 24, opacity: 0.5 }}>🔑</span>
          <span className="text-[11px] text-[var(--color-mute)] text-center">
            No credentials configured
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Refresh button */}
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-semibold text-[var(--color-primary)] tracking-[-0.2px]">
          Model Quota
        </span>
        <button
          type="button"
          className="w-6 h-6 rounded-md border border-[var(--color-hairline)] bg-transparent text-[var(--color-mute)] cursor-pointer flex items-center justify-center transition-all duration-150 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Quota items */}
      <div className="flex flex-col gap-0 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[10px] overflow-hidden">
        {sortedItems.length > 0 ? (
          sortedItems.map((item: any) => {
            const timeText = getRemainingTimeText(item.resetTime)
            return (
              <div
                key={item.modelId}
                className="py-2.5 px-3 border-b border-[var(--color-hairline)] last:border-b-0 transition-[background] duration-150 hover:bg-[rgba(255,255,255,0.02)]"
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-[rgba(255,255,255,0.85)] tracking-[-0.1px]">
                    {item.displayName}
                  </span>
                  {timeText && (
                    <span className="text-[10px] text-[rgba(255,255,255,0.3)]">{timeText}</span>
                  )}
                </div>
                {renderBar(item.remainingFraction)}
              </div>
            )
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-[30px] px-3 gap-2">
            <span className="text-[11px] text-[var(--color-mute)]">No quota data</span>
          </div>
        )}
      </div>
    </div>
  )
}
