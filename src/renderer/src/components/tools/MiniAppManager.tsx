import { Box, Download, Package, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Switch } from '../ui/Switch'
import { toast } from '../ui/Toast'

// ─── Types ───────────────────────────────────────────────────────────────────

interface MiniAppListItem {
  id: string
  name: string
  description: string
  icon: string
  category: string
  version: string
  enabled: boolean
  hasBackend: boolean
  hasFrontend: boolean
  hasPanel: boolean
  createdAt: string
  updatedAt: string
}

// ─── Mini App Manager Component ──────────────────────────────────────────────

export default function MiniAppManager() {
  const [apps, setApps] = useState<MiniAppListItem[]>([])
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const loadApps = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api?.listMiniApps()
      setApps(list || [])
    } catch {
      toast.error('Failed to load mini apps')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadApps()
  }, [loadApps])

  const handleDelete = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Delete "${name}"? This will permanently remove the mini app and all its stored data.`,
      )
    )
      return
    try {
      await window.api?.deleteMiniApp(id)
      toast.success(`Deleted "${name}"`)
      loadApps()
    } catch {
      toast.error('Failed to delete mini app')
    }
  }

  const handleToggle = async (id: string) => {
    try {
      const result = await window.api?.toggleMiniApp(id)
      if (result?.missingConfigs && result.missingConfigs.length > 0) {
        toast.warning(
          `Please fill in required config before enabling: ${result.missingConfigs.join(', ')}`,
        )
        navigate(`/mini-apps/edit/${id}`)
        return
      }
      if (result?.success) {
        toast.success(result.enabled ? 'App enabled' : 'App disabled')
        loadApps()
      }
    } catch {
      toast.error('Failed to toggle mini app')
    }
  }

  const handleExport = async (id: string) => {
    try {
      const result = await window.api?.exportMiniApp(id)
      if (result?.success && result.data) {
        const blob = new Blob([result.data], { type: 'application/zip' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const app = apps.find((app) => app.id === id)
        const slug = (app?.name || 'miniapp').toLowerCase().replace(/\s+/g, '-')
        a.download = `${slug}.miniapp.zip`
        a.click()
        URL.revokeObjectURL(url)
        toast.success('Exported as ZIP')
      }
    } catch {
      toast.error('Failed to export mini app')
    }
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      if (!file.name.endsWith('.zip')) {
        toast.error('Please select a .miniapp.zip file')
        return
      }

      const buffer = await file.arrayBuffer()
      const result = await window.api?.importMiniAppZip(buffer)
      if (result?.success) {
        toast.success(
          result.updated ? `Updated "${file.name}" (existing app)` : `Imported "${file.name}"`,
        )
        loadApps()
      } else {
        toast.error(result?.error || 'Import failed')
      }
    } catch {
      toast.error('Failed to import mini app')
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="max-w-6xl mx-auto w-full">
      {/* Page header — unified pattern (matches Dashboard) */}
      <div className="flex flex-col items-start pt-2 pb-8">
        <div className="flex items-center gap-2 mb-4">
          <Package size={16} className="text-[var(--color-primary)]" />
          <span className="text-sm font-semibold tracking-[2.52px] uppercase text-[var(--color-primary)] font-[var(--font-sans)]">
            MINI APPS
          </span>
        </div>

        <h1 className="text-[36px] font-normal tracking-[-0.9px] leading-[40px] text-[var(--color-ink-strong)] m-0 mb-3">
          Manage <span className="text-[var(--color-primary)]">Apps</span>
        </h1>

        <p className="text-base font-normal leading-[26px] text-[var(--color-body)] max-w-[480px] m-0 mb-5">
          {apps.length} app{apps.length !== 1 ? 's' : ''} installed. Create, import, and manage your
          mini apps.
        </p>

        <div className="flex items-center gap-2">
          <Button size="small" icon={<Upload size={13} />} onClick={handleImport}>
            Import
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<Plus size={13} />}
            onClick={() => navigate('/mini-apps/new')}
          >
            New App
          </Button>
        </div>
      </div>

      {/* Dashed section divider */}
      <div className="w-full h-px border-t border-dashed border-[rgba(79,93,117,0.4)] mb-8" />

      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.miniapp.zip"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* App List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-14 h-14 rounded-[var(--radius-md)] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] flex items-center justify-center">
            <Box size={24} className="text-[var(--color-mute)]" />
          </div>
          <div className="text-center">
            <p className="text-sm text-[var(--color-ink)] font-medium mb-1">No mini apps yet</p>
            <p className="text-xs text-[var(--color-mute)]">
              Create your first mini app or import one from a JSON file
            </p>
          </div>
          <div className="flex gap-2 mt-2">
            <Button size="small" icon={<Upload size={13} />} onClick={handleImport}>
              Import
            </Button>
            <Button
              type="primary"
              size="small"
              icon={<Plus size={13} />}
              onClick={() => navigate('/mini-apps/new')}
            >
              Create
            </Button>
          </div>
        </div>
      ) : (
        (() => {
          const activeApps = apps.filter((a) => a.enabled)
          const inactiveApps = apps.filter((a) => !a.enabled)

          const renderAppCard = (app: MiniAppListItem) => (
            <div
              key={app.id}
              onClick={() => navigate(`/mini-apps/edit/${app.id}`)}
              className={`group relative flex flex-col p-4 bg-[var(--color-canvas)] border rounded-[var(--radius-md)] transition-all duration-200 hover:border-[var(--color-primary)]/30 cursor-pointer ${
                app.enabled
                  ? 'border-[var(--color-hairline)]'
                  : 'border-[var(--color-hairline)] opacity-60'
              }`}
            >
              {/* Top row: Icon + Toggle */}
              <div className="flex items-start justify-between mb-3">
                <div
                  className={`w-9 h-9 rounded-[var(--radius-sm)] flex items-center justify-center shrink-0 ${app.enabled ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20' : 'bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)]'}`}
                >
                  <Box
                    size={16}
                    className={
                      app.enabled ? 'text-[var(--color-primary)]' : 'text-[var(--color-mute)]'
                    }
                  />
                </div>
                <Switch
                  size="small"
                  checked={app.enabled}
                  onClick={(_checked, e) => {
                    e.stopPropagation()
                    handleToggle(app.id)
                  }}
                  className="shrink-0"
                />
              </div>

              {/* Name + Version */}
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[13px] font-semibold truncate ${app.enabled ? 'text-[var(--color-ink)]' : 'text-[var(--color-mute)]'}`}
                >
                  {app.name}
                </span>
                <Badge className="!text-[10px] !leading-none !py-0 !px-1.5 !border-[var(--color-hairline)] !bg-[var(--color-canvas-soft)] !text-[var(--color-mute)] shrink-0">
                  v{app.version}
                </Badge>
              </div>

              {/* Description */}
              {app.description && (
                <p className="text-[11px] text-[var(--color-mute)] line-clamp-2 mb-3 leading-[16px]">
                  {app.description}
                </p>
              )}
              {!app.description && <div className="mb-3" />}

              {/* Status + Actions (bottom) */}
              <div className="flex items-center justify-between mt-auto pt-3 border-t border-[var(--color-hairline)]/50">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-[1.5px] ${
                    app.enabled ? 'text-[var(--color-primary)]' : 'text-[var(--color-mute)]'
                  }`}
                >
                  {app.enabled ? 'Active' : 'Disabled'}
                </span>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-xs)] bg-transparent border border-transparent text-[var(--color-mute)] cursor-pointer transition-all duration-150 hover:bg-[var(--color-canvas-soft)] hover:border-[var(--color-hairline)] hover:text-[var(--color-ink)]"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/mini-apps/edit/${app.id}`)
                    }}
                    title="Edit"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-xs)] bg-transparent border border-transparent text-[var(--color-mute)] cursor-pointer transition-all duration-150 hover:bg-[var(--color-canvas-soft)] hover:border-[var(--color-hairline)] hover:text-[var(--color-ink)]"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleExport(app.id)
                    }}
                    title="Export"
                  >
                    <Download size={12} />
                  </button>
                  <button
                    type="button"
                    className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-xs)] bg-transparent border border-transparent text-[var(--color-mute)] cursor-pointer transition-all duration-150 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(app.id, app.name)
                    }}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          )

          return (
            <div className="flex flex-col gap-6">
              {/* Active Apps */}
              {activeApps.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)]" />
                    <span className="text-[11px] font-semibold uppercase tracking-[2.52px] text-[var(--color-mute)]">
                      Active ({activeApps.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {activeApps.map(renderAppCard)}
                  </div>
                </div>
              )}

              {/* Inactive Apps */}
              {inactiveApps.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-mute)]" />
                    <span className="text-[11px] font-semibold uppercase tracking-[2.52px] text-[var(--color-mute)]">
                      Inactive ({inactiveApps.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {inactiveApps.map(renderAppCard)}
                  </div>
                </div>
              )}
            </div>
          )
        })()
      )}
    </div>
  )
}
