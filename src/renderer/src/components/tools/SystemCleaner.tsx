import {
  CheckCircleOutlined,
  ClearOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  HddOutlined,
  LoadingOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Button, Modal, message, Progress, Tag, Tooltip } from 'antd'
import { useCallback, useMemo, useState } from 'react'

interface DiskUsageItem {
  path: string
  label: string
  size: string
  sizeBytes: number
  cleanable: boolean
  cleanId: string
  description: string
  category: string
}

interface DiskOverview {
  total: string
  used: string
  available: string
  percentUsed: number
}

const cleanIdRisk: Record<string, 'safe' | 'caution' | 'warning'> = {
  // Package Managers - all safe
  'npm-cache': 'safe',
  'bun-cache': 'safe',
  'yarn-cache': 'safe',
  'pip-cache': 'safe',
  'uv-cache': 'safe',
  'go-cache': 'safe',
  // Dev Tools
  docker: 'caution',
  'xcode-derived': 'safe',
  'xcode-archives': 'caution',
  'ios-device-support': 'caution',
  'ios-simulators': 'caution',
  cursor: 'caution',
  // AI/ML
  huggingface: 'caution',
  puppeteer: 'safe',
  // Browsers
  'chrome-cache': 'safe',
  'safari-cache': 'safe',
  // App Caches
  'slack-cache': 'safe',
  'discord-cache': 'safe',
  'vscode-cache': 'caution',
  'zalo-cache': 'caution',
  'telegram-cache': 'caution',
  // System
  'system-caches': 'safe',
  'system-logs': 'safe',
  'user-cache': 'safe',
  trash: 'safe',
  downloads: 'warning',
  'local-data': 'warning',
  nvm: 'warning',
}

const riskConfig = {
  safe: { color: '#52c41a', label: 'Safe', icon: <CheckCircleOutlined /> },
  caution: { color: '#faad14', label: 'Caution', icon: <ExclamationCircleOutlined /> },
  warning: { color: '#ff4d4f', label: 'Risky', icon: <WarningOutlined /> },
}

const categoryIcons: Record<string, string> = {
  'Package Managers': '📦',
  'Dev Tools': '🛠',
  'AI/ML': '🤖',
  Browsers: '🌐',
  'App Caches': '💬',
  System: '⚙️',
}

const categoryOrder = ['Package Managers', 'Dev Tools', 'AI/ML', 'Browsers', 'App Caches', 'System']

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export default function SystemCleaner() {
  const [overview, setOverview] = useState<DiskOverview | null>(null)
  const [items, setItems] = useState<DiskUsageItem[]>([])
  const [scanning, setScanning] = useState(false)
  const [cleaning, setCleaning] = useState<Record<string, boolean>>({})
  const [cleaned, setCleaned] = useState<Record<string, string>>({})
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({})
  const [hasScanned, setHasScanned] = useState(false)

  const loadData = useCallback(async () => {
    setScanning(true)
    try {
      const [diskOverview, usage] = await Promise.all([
        window.api.getDiskOverview(),
        window.api.scanDiskUsage(),
      ])
      setOverview(diskOverview)
      setItems(usage)
      setHasScanned(true)
    } catch (_err) {
      message.error('Failed to scan disk usage')
    } finally {
      setScanning(false)
    }
  }, [])

  const doClean = useCallback(
    async (item: DiskUsageItem) => {
      setCleaning((prev) => ({ ...prev, [item.cleanId]: true }))
      try {
        const result = await window.api.systemClean(item.cleanId)
        if (result.success) {
          message.success(`${item.label} cleaned! Freed ${result.freed}`)
          setCleaned((prev) => ({ ...prev, [item.cleanId]: result.freed }))
          loadData()
        } else {
          message.error(result.message)
        }
      } catch (_err) {
        message.error(`Failed to clean ${item.label}`)
      } finally {
        setCleaning((prev) => ({ ...prev, [item.cleanId]: false }))
      }
    },
    [loadData],
  )

  const handleClean = useCallback(
    async (item: DiskUsageItem) => {
      const risk = cleanIdRisk[item.cleanId] || 'warning'

      if (risk !== 'safe') {
        Modal.confirm({
          title: `Clean ${item.label}?`,
          icon: <ExclamationCircleOutlined style={{ color: riskConfig[risk].color }} />,
          content: (
            <div>
              <p>
                This will free up approximately <strong>{item.size}</strong>.
              </p>
              <p style={{ color: '#9090a8', fontSize: 13 }}>{item.description}</p>
              {risk === 'warning' && (
                <p style={{ color: '#ff4d4f', fontSize: 13, marginTop: 8 }}>
                  ⚠️ This action may remove important data. Proceed with caution.
                </p>
              )}
            </div>
          ),
          okText: 'Clean',
          okButtonProps: { danger: risk === 'warning' },
          cancelText: 'Cancel',
          onOk: () => doClean(item),
        })
      } else {
        doClean(item)
      }
    },
    [doClean],
  )

  const handleCleanAll = useCallback(() => {
    const safeItems = items.filter((item) => cleanIdRisk[item.cleanId] === 'safe')
    if (safeItems.length === 0) {
      message.info('No safe items to clean')
      return
    }

    const totalSize = safeItems.reduce((sum, item) => sum + item.sizeBytes, 0)

    Modal.confirm({
      title: 'Clean all safe items?',
      icon: <ClearOutlined style={{ color: '#52c41a' }} />,
      content: (
        <div>
          <p>
            This will clean <strong>{safeItems.length}</strong> safe items, freeing up approximately{' '}
            <strong>{formatBytes(totalSize)}</strong>.
          </p>
          <div style={{ marginTop: 8 }}>
            {safeItems.map((item) => (
              <div key={item.cleanId} style={{ color: '#9090a8', fontSize: 13 }}>
                • {item.label} ({item.size})
              </div>
            ))}
          </div>
        </div>
      ),
      okText: 'Clean All Safe',
      cancelText: 'Cancel',
      onOk: async () => {
        for (const item of safeItems) {
          await doClean(item)
        }
      },
    })
  }, [items, doClean])

  const grouped = useMemo(() => {
    const groups: Record<string, DiskUsageItem[]> = {}
    for (const item of items) {
      const cat = item.category || 'Other'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(item)
    }
    // Sort by category order
    const sorted: [string, DiskUsageItem[]][] = []
    for (const cat of categoryOrder) {
      if (groups[cat]) {
        sorted.push([cat, groups[cat]])
        delete groups[cat]
      }
    }
    // Add remaining
    for (const [cat, items] of Object.entries(groups)) {
      sorted.push([cat, items])
    }
    return sorted
  }, [items])

  const getProgressColor = (percent: number) => {
    if (percent >= 80) return '#ff4d4f'
    if (percent >= 60) return '#faad14'
    return '#52c41a'
  }

  const totalCleanable = items
    .filter((i) => cleanIdRisk[i.cleanId] === 'safe')
    .reduce((sum, i) => sum + i.sizeBytes, 0)

  const totalScanned = items.reduce((sum, i) => sum + i.sizeBytes, 0)

  const toggleCategory = (cat: string) => {
    setCollapsedCats((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  const maxSizeBytes = items[0]?.sizeBytes || 1

  // Initial screen: only show Scan button
  if (!hasScanned && !scanning) {
    return (
      <div className="system-cleaner">
        <div className="sc-initial">
          <div className="sc-initial-icon">
            <HddOutlined />
          </div>
          <div className="sc-initial-title">System Cleaner</div>
          <div className="sc-initial-desc">
            Scan your system to find cache files, logs, and other cleanable items to free up disk
            space.
          </div>
          <Button
            type="primary"
            size="large"
            icon={<ReloadOutlined />}
            onClick={loadData}
            className="sc-initial-btn"
          >
            Scan Now
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="system-cleaner">
      {/* Disk Overview Card */}
      <div className="sc-overview">
        <div className="sc-overview-left">
          <div className="sc-overview-icon">
            <HddOutlined />
          </div>
          <div className="sc-overview-info">
            <div className="sc-overview-title">Disk Storage</div>
            {overview ? (
              <div className="sc-overview-stats">
                <span className="sc-stat">
                  <span className="sc-stat-value">{overview.available}</span>
                  <span className="sc-stat-label">available</span>
                </span>
                <span className="sc-stat-sep">•</span>
                <span className="sc-stat">
                  <span className="sc-stat-value">{overview.used}</span>
                  <span className="sc-stat-label">used</span>
                </span>
                <span className="sc-stat-sep">•</span>
                <span className="sc-stat">
                  <span className="sc-stat-value">{overview.total}</span>
                  <span className="sc-stat-label">total</span>
                </span>
              </div>
            ) : (
              <div className="sc-overview-stats">Scanning...</div>
            )}
          </div>
        </div>
        <div className="sc-overview-right">
          {overview && (
            <Progress
              type="dashboard"
              percent={overview.percentUsed}
              size={80}
              strokeColor={getProgressColor(overview.percentUsed)}
              format={(p) => <div style={{ fontSize: 14, fontWeight: 600 }}>{p}%</div>}
            />
          )}
        </div>
      </div>

      {/* Actions Bar */}
      <div className="sc-actions">
        <div className="sc-actions-left">
          <span className="sc-actions-title">
            {items.length > 0
              ? `${items.length} items • ${formatBytes(totalScanned)} scanned`
              : scanning
                ? 'Scanning...'
                : 'No items found'}
          </span>
          {totalCleanable > 0 && (
            <Tag color="green" style={{ marginLeft: 8 }}>
              {formatBytes(totalCleanable)} safe to clean
            </Tag>
          )}
        </div>
        <div className="sc-actions-right">
          <Button
            icon={<ClearOutlined />}
            onClick={handleCleanAll}
            disabled={scanning || totalCleanable === 0}
            type="primary"
            ghost
          >
            Clean All Safe
          </Button>
          <Button
            icon={scanning ? <LoadingOutlined /> : <ReloadOutlined />}
            onClick={loadData}
            disabled={scanning}
          >
            {scanning ? 'Scanning...' : 'Rescan'}
          </Button>
        </div>
      </div>

      {/* Grouped Items List */}
      <div className="sc-list">
        {scanning && items.length === 0 ? (
          <div className="sc-loading">
            <LoadingOutlined style={{ fontSize: 24 }} />
            <span>Scanning disk usage...</span>
          </div>
        ) : (
          grouped.map(([category, categoryItems]) => {
            const catSize = categoryItems.reduce((s, i) => s + i.sizeBytes, 0)
            const isCollapsed = collapsedCats[category]

            return (
              <div key={category} className="sc-category">
                <div className="sc-category-header" onClick={() => toggleCategory(category)}>
                  <span className="sc-category-icon">{categoryIcons[category] || '📁'}</span>
                  <span className="sc-category-name">{category}</span>
                  <span className="sc-category-count">{categoryItems.length} items</span>
                  <span className="sc-category-size">{formatBytes(catSize)}</span>
                  <span className={`sc-category-chevron ${isCollapsed ? 'collapsed' : ''}`}>▾</span>
                </div>

                {!isCollapsed && (
                  <div className="sc-category-items">
                    {categoryItems.map((item) => {
                      const risk = cleanIdRisk[item.cleanId] || 'warning'
                      const rc = riskConfig[risk]
                      const isNotCleanable = !cleanIdRisk[item.cleanId]
                      const isCleaning = cleaning[item.cleanId]
                      const wasCleaned = cleaned[item.cleanId]

                      return (
                        <div key={item.cleanId} className="sc-item">
                          <div className="sc-item-left">
                            <div className="sc-item-header">
                              <span className="sc-item-label">{item.label}</span>
                              <Tooltip
                                title={
                                  risk === 'safe'
                                    ? 'Safe to clean'
                                    : risk === 'caution'
                                      ? 'Review before cleaning'
                                      : 'May remove important data'
                                }
                              >
                                <Tag
                                  color={rc.color}
                                  style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
                                >
                                  {rc.icon} {rc.label}
                                </Tag>
                              </Tooltip>
                              {wasCleaned && (
                                <Tag color="blue" style={{ fontSize: 11 }}>
                                  Freed {wasCleaned}
                                </Tag>
                              )}
                            </div>
                            <div className="sc-item-desc">{item.description}</div>
                            <div className="sc-item-path">{item.path}</div>
                          </div>

                          <div className="sc-item-right">
                            <div className="sc-item-size">{item.size}</div>
                            <div className="sc-item-bar-wrap">
                              <div
                                className="sc-item-bar"
                                style={{
                                  width: `${Math.min(100, (item.sizeBytes / maxSizeBytes) * 100)}%`,
                                  background: rc.color,
                                }}
                              />
                            </div>
                            {!isNotCleanable && (
                              <Button
                                size="small"
                                danger={risk === 'warning'}
                                type={risk === 'safe' ? 'primary' : 'default'}
                                icon={isCleaning ? <LoadingOutlined /> : <DeleteOutlined />}
                                disabled={isCleaning}
                                onClick={() => handleClean(item)}
                                style={{ marginTop: 6 }}
                              >
                                {isCleaning ? 'Cleaning...' : 'Clean'}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
