import { Button, message, Tag, Tooltip } from 'antd'
import { Copy, Plug, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

declare global {
  interface Window {
    api: any
  }
}

const PROXY_PORT = 18981

interface ProxyStatus {
  running: boolean
  port: number
  url: string
  baseUrl: string
  requestCount: number
  lastRequestAt: string | null
  hasCredentials: boolean
  credentials: {
    client_id: string | null
    access_token: string | null
    refresh_token: string | null
    default_project: string | null
    user_agent: string | null
    endpoint: string | null
  } | null
  profile: {
    name: string | null
    email: string | null
    picture: string | null
    account_type: string
  } | null
  models: any[]
  quota: any | null
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
    return `Refreshes in ${hours} hour${hours > 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`
  }
  return `Refreshes in ${minutes} minute${minutes !== 1 ? 's' : ''}`
}

const isStandardModel = (modelId: string) => {
  return modelOrder.includes(modelId)
}

export default function AIProxy() {
  const [status, setStatus] = useState<ProxyStatus | null>(null)
  const [refreshingModels, setRefreshingModels] = useState(false)

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

    // Trigger a fresh quota fetch on mount
    window.api
      .refreshProxyQuota()
      .then((res: any) => {
        if (res.success) {
          fetchStatus()
        }
      })
      .catch(() => {})

    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const _running = status?.running || false
  const models = status?.models || []

  const handleRefreshModels = useCallback(async () => {
    setRefreshingModels(true)
    try {
      const res = await window.api.refreshProxyModels()
      if (res.success) {
        message.success('Models list updated!')
        await fetchStatus()
      } else {
        message.error('Failed to update models')
      }
    } catch {
      message.error('Error updating models')
    } finally {
      setRefreshingModels(false)
    }
  }, [fetchStatus])

  const renderSegments = (remainingFraction: number) => {
    const filledSegments = Math.min(5, Math.max(0, Math.round(remainingFraction * 5)))
    const isFull = filledSegments === 5
    const activeColor = isFull ? 'rgba(255, 255, 255, 0.4)' : '#00d992'
    const inactiveColor = 'rgba(255, 255, 255, 0.06)'

    return (
      <div className="flex gap-1 w-full mt-2">
        {[0, 1, 2, 3, 4].map((index) => {
          const isFilled = index < filledSegments
          return (
            <div
              key={index}
              className="flex-1 h-1 rounded-sm transition-colors duration-300"
              style={{ backgroundColor: isFilled ? activeColor : inactiveColor }}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full gap-4 overflow-y-auto -m-6 p-5">
      <div className="flex flex-col gap-4">
        {/* Account Profile */}
        {status?.profile && (
          <div className="flex items-center gap-4 py-4 px-5 bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[var(--radius-md)]">
            {status.profile.picture ? (
              <img
                src={status.profile.picture}
                alt="Profile"
                className="w-11 h-11 rounded-full border-2 border-[var(--color-hairline)]"
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-[var(--color-canvas-soft)] flex items-center border-2 border-[var(--color-hairline)]">
                <span className="m-auto text-lg text-[var(--color-mute)]">👤</span>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-semibold text-[var(--color-ink)]">
                {status.profile.name}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-mute)]">{status.profile.email}</span>
                <Tag
                  color={status.profile.account_type === 'Personal' ? 'cyan' : 'gold'}
                  style={{ margin: 0, fontSize: 10, lineHeight: '16px', height: 18 }}
                >
                  {status.profile.account_type}
                </Tag>
              </div>
            </div>
          </div>
        )}

        {/* Endpoint Info */}
        <div className="bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] overflow-hidden">
          <div className="flex items-center gap-2 py-3 px-4 text-[13px] font-semibold text-[var(--color-ink)] border-b border-[var(--color-hairline)]">
            <Plug size={13} /> Endpoint Configuration
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-[var(--color-mute)] uppercase tracking-[0.5px]">
                  Base URL
                </span>
                <div className="flex items-center gap-2">
                  <code className="py-1.5 px-2.5 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] text-[13px] font-[var(--font-mono)] text-[var(--color-primary-soft)] flex-1">
                    {status?.baseUrl || `http://127.0.0.1:${PROXY_PORT}/v1`}
                  </code>
                  <Tooltip title="Copy">
                    <Copy
                      size={14}
                      className="cursor-pointer text-[var(--color-mute)] transition-colors duration-150 text-sm hover:text-[var(--color-primary)]"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          status?.baseUrl || `http://127.0.0.1:${PROXY_PORT}/v1`,
                        )
                        message.success('Base URL copied!')
                      }}
                    />
                  </Tooltip>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-[var(--color-mute)] uppercase tracking-[0.5px]">
                  API Key
                </span>
                <div className="flex items-center gap-2">
                  <code className="py-1.5 px-2.5 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] text-[13px] font-[var(--font-mono)] text-[var(--color-primary-soft)] flex-1">
                    not-needed
                  </code>
                  <Tooltip title="Copy">
                    <Copy
                      size={14}
                      className="cursor-pointer text-[var(--color-mute)] transition-colors duration-150 text-sm hover:text-[var(--color-primary)]"
                      onClick={() => {
                        navigator.clipboard.writeText('not-needed')
                        message.success('API Key copied!')
                      }}
                    />
                  </Tooltip>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Tag color="green">GET /v1/models</Tag>
              <Tag color="blue">POST /v1/chat/completions</Tag>
              <Tag color="purple">POST /v1/completions</Tag>
              <Tag color="orange">POST /v1/responses</Tag>
              <Tag>GET /health</Tag>
            </div>
          </div>
        </div>

        {/* Model Quota */}
        {status?.hasCredentials &&
          (() => {
            const buckets = status?.quota?.buckets || []
            const displayItems =
              buckets.length > 0
                ? buckets
                    .filter((b: any) => isStandardModel(b.modelId))
                    .map((b: any) => {
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

            const sortedDisplayItems = [...displayItems].sort((a, b) => {
              const idxA = modelOrder.indexOf(a.modelId)
              const idxB = modelOrder.indexOf(b.modelId)
              if (idxA === -1 && idxB === -1) return a.modelId.localeCompare(b.modelId)
              if (idxA === -1) return 1
              if (idxB === -1) return -1
              return idxA - idxB
            })

            return (
              <div className="mt-2">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-[15px] font-semibold text-[var(--color-ink)] m-0">
                    Model Quota
                  </h3>
                  <div className="flex gap-2">
                    <Button
                      type="text"
                      size="small"
                      icon={
                        <RefreshCw size={14} className={refreshingModels ? 'animate-spin' : ''} />
                      }
                      loading={refreshingModels}
                      onClick={handleRefreshModels}
                      style={{ color: 'var(--color-mute)' }}
                    />
                  </div>
                </div>

                <div className="bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[10px] overflow-hidden">
                  {sortedDisplayItems.length > 0 ? (
                    <div className="flex flex-col">
                      {sortedDisplayItems.map((item, index) => {
                        const isLast = index === sortedDisplayItems.length - 1
                        const remainingTimeText = getRemainingTimeText(item.resetTime)

                        return (
                          <div
                            key={item.modelId}
                            className={`flex flex-col py-4 px-5 ${isLast ? '' : 'border-b border-[var(--color-hairline)]'}`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium text-[rgba(255,255,255,0.9)]">
                                {item.displayName}
                              </span>
                              {remainingTimeText && (
                                <span className="text-xs text-[rgba(255,255,255,0.35)]">
                                  {remainingTimeText}
                                </span>
                              )}
                            </div>
                            {renderSegments(item.remainingFraction)}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-[var(--color-mute)] text-[13px]">
                      No models loaded. Click reload to fetch models.
                    </div>
                  )}
                </div>

                {/* Model IDs List */}
                {models.length > 0 && (
                  <div className="mt-5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-[13px] font-semibold text-[var(--color-mute)]">
                        Available Models
                      </span>
                      <span className="text-[11px] text-[var(--color-mute)] opacity-60">
                        ({models.length})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {models.map((model) => (
                        <div
                          key={model.id}
                          className="py-1 px-2 bg-[rgba(255,255,255,0.02)] border border-[var(--color-hairline)] rounded text-[11px] font-[var(--font-mono)] text-[var(--color-mute)]"
                        >
                          {model.id}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
      </div>
    </div>
  )
}
