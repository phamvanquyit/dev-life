import { ReloadOutlined } from '@ant-design/icons'
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

  const fetchStatus = useCallback(async () => {
    try {
      const s = await window.api.getProxyStatus()
      setStatus(s)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    window.api
      .refreshProxyQuota()
      .then((res: any) => {
        if (res.success) fetchStatus()
      })
      .catch(() => {})

    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus])

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
      <div className="tray-quota-bar">
        {[0, 1, 2, 3, 4].map((i) => {
          const filled = i < segments
          let color = 'rgba(255,255,255,0.06)'
          if (filled) {
            if (isFull) color = 'rgba(255,255,255,0.25)'
            else if (segments <= 1) color = '#ff4d4f'
            else if (segments <= 2) color = '#faad14'
            else color = '#00d992'
          }
          return <div key={i} className="tray-quota-segment" style={{ backgroundColor: color }} />
        })}
        <span
          className="tray-quota-pct"
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
      <div className="tray-tool">
        <div className="tray-quota-empty">
          <span style={{ fontSize: 24, opacity: 0.5 }}>🔑</span>
          <span style={{ fontSize: 11, color: 'var(--color-mute)', textAlign: 'center' }}>
            No credentials configured
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="tray-tool">
      {/* Refresh button */}
      <div className="tray-quota-header">
        <span className="tray-quota-title">Model Quota</span>
        <button
          type="button"
          className="tray-quota-refresh"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <ReloadOutlined spin={refreshing} style={{ fontSize: 11 }} />
        </button>
      </div>

      {/* Quota items */}
      <div className="tray-quota-list">
        {sortedItems.length > 0 ? (
          sortedItems.map((item: any) => {
            const timeText = getRemainingTimeText(item.resetTime)
            return (
              <div key={item.modelId} className="tray-quota-item">
                <div className="tray-quota-item-top">
                  <span className="tray-quota-model">{item.displayName}</span>
                  {timeText && <span className="tray-quota-timer">{timeText}</span>}
                </div>
                {renderBar(item.remainingFraction)}
              </div>
            )
          })
        ) : (
          <div className="tray-quota-empty">
            <span style={{ fontSize: 11, color: 'var(--color-mute)' }}>No quota data</span>
          </div>
        )}
      </div>
    </div>
  )
}
