import * as LucideIcons from 'lucide-react'
import { ChevronLeft } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildFrontendContext, evaluateComponent } from '../../lib/miniapp-helpers'
import AppLogo from '../ui/AppLogo'

// ─── Mini App Panel Renderer ─────────────────────────────────────────────────

function MiniAppPanelView({ appId, panelCode }: { appId: string; panelCode: string }) {
  const ctxRef = useRef<ReturnType<typeof buildFrontendContext> | null>(null)
  const [PanelComp, setPanelComp] = useState<React.ComponentType<any> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const ctx = buildFrontendContext(appId)
      ctxRef.current = ctx
      const Comp = evaluateComponent(panelCode, ctx)
      if (Comp) {
        setPanelComp(() => Comp)
      } else {
        setError('Panel returned no component')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load panel')
    }
  }, [appId, panelCode])

  if (error) {
    return <div className="p-3 text-xs text-red-400">Panel error: {error}</div>
  }

  if (!PanelComp || !ctxRef.current) {
    return <div className="p-3 text-xs text-[var(--color-mute)]">Loading...</div>
  }

  return <PanelComp ctx={ctxRef.current} />
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface TrayTool {
  id: string
  label: string
  desc: string
  icon: React.ReactNode
}

interface MiniAppPanelInfo {
  id: string
  name: string
  icon: string
  description: string
  panelCode: string
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function TrayPanel() {
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [miniAppPanels, setMiniAppPanels] = useState<MiniAppPanelInfo[]>([])

  // Load mini apps with panel code
  const loadPanels = useCallback(async () => {
    try {
      const list = await window.api?.listMiniApps()
      if (!list) return
      const withPanels = list.filter((a: any) => a.enabled && a.hasPanel)
      if (withPanels.length === 0) {
        setMiniAppPanels([])
        return
      }
      // Fetch full data for each to get panelCode
      const details = await Promise.all(withPanels.map((a: any) => window.api?.getMiniApp(a.id)))
      setMiniAppPanels(
        details
          .filter((d: any) => d?.panelCode)
          .map((d: any) => ({
            id: d.id,
            name: d.name,
            icon: d.icon,
            description: d.description,
            panelCode: d.panelCode,
          })),
      )
    } catch {
      // silently fail
    }
  }, [])

  // Load on mount
  useEffect(() => {
    loadPanels()
  }, [loadPanels])

  // Reload when tray becomes visible (so toggle changes in main window are reflected instantly)
  useEffect(() => {
    const cleanup = window.api?.onTrayVisibilityChange((visible: boolean) => {
      if (visible) {
        loadPanels()
      }
    })
    return () => cleanup?.()
  }, [loadPanels])

  // Build tool list from mini apps with panels
  const allTools: TrayTool[] = useMemo(() => {
    return miniAppPanels.map((app) => {
      const IconComp = (LucideIcons as any)[app.icon] || LucideIcons.Box
      return {
        id: app.id,
        label: app.name,
        desc: app.description || 'Mini App',
        icon: <IconComp size={18} />,
      }
    })
  }, [miniAppPanels])

  const activeLabel = activeTool ? allTools.find((t) => t.id === activeTool)?.label : null

  // Render content for active tool
  const renderContent = useCallback(() => {
    if (!activeTool) return null
    const app = miniAppPanels.find((a) => a.id === activeTool)
    if (app) {
      return <MiniAppPanelView appId={app.id} panelCode={app.panelCode} />
    }
    return <div className="p-3 text-xs text-[var(--color-mute)]">Tool not found</div>
  }, [activeTool, miniAppPanels])

  return (
    <div className="w-full h-full flex flex-col items-center p-0 font-[var(--font-sans)] bg-transparent">
      <div className="flex-1 w-full bg-[var(--color-canvas)] rounded-xl border border-[var(--color-hairline)] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="py-2.5 px-3 border-b border-[var(--color-hairline)] flex items-center">
          {activeTool ? (
            <div
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary-soft)] cursor-pointer transition-colors duration-150 select-none hover:text-[var(--color-primary)]"
              onClick={() => setActiveTool(null)}
            >
              <ChevronLeft size={12} />
              <span>{activeLabel}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AppLogo size={20} />
              <span className="text-[13px] font-bold text-[var(--color-primary)]">Dev Life</span>
              <span className="text-[11px] text-[var(--color-mute)]">Quick Tools</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {activeTool ? (
            renderContent()
          ) : allTools.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
              <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] flex items-center justify-center mb-4">
                <LucideIcons.LayoutGrid size={22} className="text-[var(--color-mute)]" />
              </div>
              <span className="text-sm font-medium text-[var(--color-ink)] mb-1">
                No active panels
              </span>
              <span className="text-[11px] text-[var(--color-mute)] leading-relaxed max-w-[240px]">
                Enable a mini app with a panel component to see its quick tools here.
              </span>
              <div className="mt-4 px-3 py-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-hairline)] bg-[var(--color-canvas-soft)]">
                <span className="text-[10px] text-[var(--color-mute)] leading-relaxed">
                  Go to{' '}
                  <span className="text-[var(--color-primary)] font-medium">
                    Mini Apps → Manage
                  </span>{' '}
                  to enable apps
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {allTools.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center gap-3 p-3 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] cursor-pointer transition-all duration-150 select-none hover:border-[var(--color-primary)]"
                  onClick={() => setActiveTool(tool.id)}
                >
                  <div className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-glow)] text-[var(--color-primary-soft)] text-base shrink-0">
                    {tool.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[var(--color-ink)]">
                      {tool.label}
                    </div>
                    <div className="text-[11px] text-[var(--color-mute)] mt-px">{tool.desc}</div>
                  </div>
                  <div className="text-lg text-[var(--color-mute)] shrink-0">›</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
