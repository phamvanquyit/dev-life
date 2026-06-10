import { ApiOutlined, CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, message, Tag, Tooltip } from 'antd'
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
      <div style={{ display: 'flex', gap: 4, width: '100%', marginTop: 8 }}>
        {[0, 1, 2, 3, 4].map((index) => {
          const isFilled = index < filledSegments
          return (
            <div
              key={index}
              style={{
                flex: 1,
                height: 4,
                backgroundColor: isFilled ? activeColor : inactiveColor,
                borderRadius: 2,
                transition: 'background-color 0.3s ease',
              }}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className="ai-proxy-page">
      <div className="proxy-content">
        {/* Account Profile */}
        {status?.profile && (
          <div
            className="proxy-card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '16px 20px',
              background: 'var(--color-canvas)',
            }}
          >
            {status.profile.picture ? (
              <img
                src={status.profile.picture}
                alt="Profile"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  border: '2px solid var(--color-border)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'var(--color-bg-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  border: '2px solid var(--color-border)',
                }}
              >
                <span style={{ margin: 'auto', fontSize: 18, color: 'var(--color-text-muted)' }}>
                  👤
                </span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {status.profile.name}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {status.profile.email}
                </span>
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
        <div className="proxy-card">
          <div className="proxy-card-header">
            <ApiOutlined /> Endpoint Configuration
          </div>
          <div className="proxy-card-body">
            <div className="endpoint-grid">
              <div className="endpoint-item">
                <span className="endpoint-label">Base URL</span>
                <div className="endpoint-value-row">
                  <code className="endpoint-code">
                    {status?.baseUrl || `http://127.0.0.1:${PROXY_PORT}/v1`}
                  </code>
                  <Tooltip title="Copy">
                    <CopyOutlined
                      className="endpoint-copy"
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
              <div className="endpoint-item">
                <span className="endpoint-label">API Key</span>
                <div className="endpoint-value-row">
                  <code className="endpoint-code">not-needed</code>
                  <Tooltip title="Copy">
                    <CopyOutlined
                      className="endpoint-copy"
                      onClick={() => {
                        navigator.clipboard.writeText('not-needed')
                        message.success('API Key copied!')
                      }}
                    />
                  </Tooltip>
                </div>
              </div>
            </div>
            <div className="endpoint-routes">
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
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <h3
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: 'var(--color-text-primary)',
                      margin: 0,
                    }}
                  >
                    Model Quota
                  </h3>
                  <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={refreshingModels}
                    onClick={handleRefreshModels}
                    style={{ color: 'var(--color-text-muted)' }}
                  />
                </div>

                <div
                  style={{
                    background: 'var(--color-canvas)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 10,
                    overflow: 'hidden',
                  }}
                >
                  {sortedDisplayItems.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {sortedDisplayItems.map((item, index) => {
                        const isLast = index === sortedDisplayItems.length - 1
                        const remainingTimeText = getRemainingTimeText(item.resetTime)

                        return (
                          <div
                            key={item.modelId}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              padding: '16px 20px',
                              borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 14,
                                  fontWeight: 500,
                                  color: 'rgba(255, 255, 255, 0.9)',
                                }}
                              >
                                {item.displayName}
                              </span>
                              {remainingTimeText && (
                                <span
                                  style={{
                                    fontSize: 12,
                                    color: 'rgba(255, 255, 255, 0.35)',
                                  }}
                                >
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
                    <div
                      style={{
                        textAlign: 'center',
                        padding: '32px 0',
                        color: 'var(--color-text-muted)',
                        fontSize: 13,
                      }}
                    >
                      No models loaded. Click reload to fetch models.
                    </div>
                  )}
                </div>

                {/* Model IDs List */}
                {models.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span
                        style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}
                      >
                        Available Models
                      </span>
                      <span
                        style={{ fontSize: 11, color: 'var(--color-text-muted)', opacity: 0.6 }}
                      >
                        ({models.length})
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                      }}
                    >
                      {models.map((model) => (
                        <div
                          key={model.id}
                          style={{
                            padding: '4px 8px',
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 4,
                            fontSize: 11,
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--color-text-muted)',
                          }}
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
