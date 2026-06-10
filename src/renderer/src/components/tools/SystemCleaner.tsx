import { Button, Modal, message, Progress, Tag, Tooltip } from 'antd'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Eraser,
  HardDrive,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
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
  safe: { color: '#52c41a', label: 'Safe', icon: <CheckCircle size={14} /> },
  caution: { color: '#faad14', label: 'Caution', icon: <AlertCircle size={14} /> },
  warning: { color: '#ff4d4f', label: 'Risky', icon: <AlertTriangle size={14} /> },
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
          icon: <AlertCircle size={14} style={{ color: riskConfig[risk].color }} />,
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
      icon: <Eraser size={14} style={{ color: '#52c41a' }} />,
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
      <div className="flex flex-col gap-4 h-full">
        <div className="flex flex-col items-center justify-center flex-1 min-h-[400px] gap-4 text-center py-10 px-5">
          <div className="w-20 h-20 flex items-center justify-center rounded-[20px] bg-[var(--color-primary-glow)] text-[var(--color-primary-soft)] text-4xl mb-2">
            <HardDrive size={16} />
          </div>
          <div className="text-[22px] font-normal tracking-[-0.65px] text-[var(--color-ink)]">
            System Cleaner
          </div>
          <div className="text-sm text-[var(--color-mute)] max-w-[400px] leading-[1.65] mb-2">
            Scan your system to find cache files, logs, and other cleanable items to free up disk
            space.
          </div>
          <Button
            type="primary"
            size="large"
            icon={<RefreshCw size={14} />}
            onClick={loadData}
            style={{
              height: 44,
              padding: '0 32px',
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 'var(--radius-sm)',
            }}
          >
            Scan Now
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Disk Overview Card */}
      <div className="flex items-center justify-between py-5 px-6 bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-glow)] text-[var(--color-primary-soft)] text-[22px] shrink-0">
            <HardDrive size={16} />
          </div>
          <div>
            <div className="text-base font-semibold text-[var(--color-ink)] mb-1.5">
              Disk Storage
            </div>
            {overview ? (
              <div className="flex items-center gap-1.5 text-[13px] text-[var(--color-mute)]">
                <span className="flex items-baseline gap-1">
                  <span className="font-semibold text-[var(--color-ink)] font-[var(--font-mono)] text-sm">
                    {overview.available}
                  </span>
                  <span className="text-[11px] text-[var(--color-mute)]">available</span>
                </span>
                <span className="text-[var(--color-hairline)] text-[10px]">•</span>
                <span className="flex items-baseline gap-1">
                  <span className="font-semibold text-[var(--color-ink)] font-[var(--font-mono)] text-sm">
                    {overview.used}
                  </span>
                  <span className="text-[11px] text-[var(--color-mute)]">used</span>
                </span>
                <span className="text-[var(--color-hairline)] text-[10px]">•</span>
                <span className="flex items-baseline gap-1">
                  <span className="font-semibold text-[var(--color-ink)] font-[var(--font-mono)] text-sm">
                    {overview.total}
                  </span>
                  <span className="text-[11px] text-[var(--color-mute)]">total</span>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[13px] text-[var(--color-mute)]">
                Scanning...
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0">
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
      <div className="flex items-center justify-between py-2.5 px-4 bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[var(--radius-md)]">
        <div className="flex items-center">
          <span className="text-[13px] font-medium text-[var(--color-body)]">
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
        <div className="flex gap-2">
          <Button
            icon={<Eraser size={14} />}
            onClick={handleCleanAll}
            disabled={scanning || totalCleanable === 0}
            type="primary"
            ghost
          >
            Clean All Safe
          </Button>
          <Button
            icon={
              scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />
            }
            onClick={loadData}
            disabled={scanning}
          >
            {scanning ? 'Scanning...' : 'Rescan'}
          </Button>
        </div>
      </div>

      {/* Grouped Items List */}
      <div className="flex flex-col gap-1.5">
        {scanning && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-[60px] px-5 text-[var(--color-mute)] text-sm">
            <Loader2 size={24} className="animate-spin" />
            <span>Scanning disk usage...</span>
          </div>
        ) : (
          grouped.map(([category, categoryItems]) => {
            const catSize = categoryItems.reduce((s, i) => s + i.sizeBytes, 0)
            const isCollapsed = collapsedCats[category]

            return (
              <div
                key={category}
                className="border border-[var(--color-hairline)] rounded-[var(--radius-md)] overflow-hidden bg-[var(--color-canvas)]"
              >
                <div
                  className="flex items-center gap-2 py-2.5 px-4 cursor-pointer transition-[background] duration-150 select-none border-b border-transparent hover:bg-[rgba(255,255,255,0.03)]"
                  onClick={() => toggleCategory(category)}
                >
                  <span className="text-[15px] w-[22px] text-center shrink-0">
                    {categoryIcons[category] || '📁'}
                  </span>
                  <span className="text-[13px] font-semibold text-[var(--color-ink)] flex-1">
                    {category}
                  </span>
                  <span className="text-[11px] text-[var(--color-mute)] bg-[var(--color-canvas-soft)] px-2 py-px rounded-[var(--radius-pill)]">
                    {categoryItems.length} items
                  </span>
                  <span className="text-[13px] font-semibold font-[var(--font-mono)] text-[var(--color-primary)] min-w-[60px] text-right">
                    {formatBytes(catSize)}
                  </span>
                  <span
                    className={`text-xs text-[var(--color-mute)] transition-transform duration-200 w-4 text-center ${isCollapsed ? '-rotate-90' : ''}`}
                  >
                    ▾
                  </span>
                </div>

                {!isCollapsed && (
                  <div className="border-t border-[var(--color-hairline)]">
                    {categoryItems.map((item) => {
                      const risk = cleanIdRisk[item.cleanId] || 'warning'
                      const rc = riskConfig[risk]
                      const isNotCleanable = !cleanIdRisk[item.cleanId]
                      const isCleaning = cleaning[item.cleanId]
                      const wasCleaned = cleaned[item.cleanId]

                      return (
                        <div
                          key={item.cleanId}
                          className="flex items-start justify-between py-3.5 px-[18px] bg-[var(--color-canvas)] border-b border-[var(--color-hairline)] last:border-b-0 transition-all duration-200 gap-5 hover:border-[rgba(0,217,146,0.3)]"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-sm font-semibold text-[var(--color-ink)]">
                                {item.label}
                              </span>
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
                            <div className="text-xs text-[var(--color-mute)] mb-0.5">
                              {item.description}
                            </div>
                            <div className="text-[11px] font-[var(--font-mono)] text-[var(--color-mute)] opacity-60 whitespace-nowrap overflow-hidden text-ellipsis">
                              {item.path}
                            </div>
                          </div>

                          <div className="flex flex-col items-end min-w-[100px] shrink-0">
                            <div className="text-base font-bold font-[var(--font-mono)] text-[var(--color-ink)] mb-1.5">
                              {item.size}
                            </div>
                            <div className="w-full h-1 bg-[var(--color-canvas-soft)] rounded-sm overflow-hidden">
                              <div
                                className="h-full rounded-sm transition-[width] duration-[600ms] min-w-1"
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
                                icon={
                                  isCleaning ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={14} />
                                  )
                                }
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
