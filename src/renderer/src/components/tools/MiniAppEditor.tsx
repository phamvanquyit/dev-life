import Editor, { type BeforeMount, DiffEditor, type DiffOnMount, type OnMount } from '@monaco-editor/react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Code,
  Eye,
  Save,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { InputNumber } from '../ui/InputNumber'
import { Select } from '../ui/Select'
import { Switch } from '../ui/Switch'
import { toast } from '../ui/Toast'
import AIAgentSidebar, { type AIAgentSidebarHandle } from './AIAgentSidebar'
import MiniAppRenderer from './MiniAppRenderer'

// ─── Types ───────────────────────────────────────────────────────────────────

interface MiniAppDetail {
  id: string
  name: string
  description: string
  icon: string
  category: string
  version: string
  backendCode: string
  frontendCode: string
  panelCode: string | null
  enabled: boolean
}

const ICON_OPTIONS = [
  'Box',
  'Activity',
  'Zap',
  'Code',
  'Database',
  'Globe',
  'Settings',
  'Terminal',
  'FileJson',
  'Palette',
  'Calculator',
  'Clock',
  'Search',
  'Shield',
  'Wifi',
  'BarChart',
  'Bookmark',
  'Briefcase',
  'Cloud',
  'Cpu',
  'Hash',
  'Key',
  'Layers',
  'Link',
  'Lock',
  'Mail',
  'Monitor',
  'Package',
  'Server',
  'Smartphone',
  'Tool',
]

type CodeTab = 'frontend' | 'backend' | 'panel' | 'preview'

interface LogEntry {
  id: string
  appName: string
  timestamp: number
  message: string
}

// ─── Monaco Editor Theme ─────────────────────────────────────────────────────

const MONACO_OPTIONS = {
  fontSize: 13,
  fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontLigatures: false,
  minimap: { enabled: false },
  lineNumbers: 'on' as const,
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line' as const,
  padding: { top: 12, bottom: 12 },
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  wordWrap: 'off' as const,
  tabSize: 2,
  automaticLayout: true,
  stickyScroll: { enabled: false },
}

// Enable JSX support in Monaco's JavaScript mode
const handleEditorBeforeMount: BeforeMount = (monaco) => {
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    jsx: monaco.languages.typescript.JsxEmit.React,
    jsxFactory: '__jsx',
    target: monaco.languages.typescript.ScriptTarget.Latest,
    allowNonTsExtensions: true,
    allowJs: true,
  })
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MiniAppEditor() {
  const { appId } = useParams<{ appId: string }>()
  const navigate = useNavigate()
  const isCreating = !appId

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formIcon, setFormIcon] = useState('Box')
  const [formVersion, setFormVersion] = useState('1.0.0')
  const [formBackendCode, setFormBackendCode] = useState('')
  const [formFrontendCode, setFormFrontendCode] = useState('')
  const [formPanelCode, setFormPanelCode] = useState('')
  const [activeTab, setActiveTab] = useState<CodeTab>('frontend')
  const [loading, setLoading] = useState(!isCreating)
  const [saving, setSaving] = useState(false)

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Preview key (increment to force re-render preview)
  const [previewKey, setPreviewKey] = useState(0)

  // Config
  const [configSchema, setConfigSchema] = useState<Record<string, any> | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, any>>({})

  // AI Agent sidebar
  const [showAIAgent, setShowAIAgent] = useState(true)
  const [miniAppWorkspacePath, setMiniAppWorkspacePath] = useState('')
  const [agentSidebarWidth, setAgentSidebarWidth] = useState(320)
  const agentSidebarRef = useRef<AIAgentSidebarHandle>(null)
  const activeTabRef = useRef<CodeTab>('frontend')
  const isResizingRef = useRef(false)
  const resizeStartXRef = useRef(0)
  const resizeStartWidthRef = useRef(320)

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isResizingRef.current = true
      resizeStartXRef.current = e.clientX
      resizeStartWidthRef.current = agentSidebarWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizingRef.current) return
        const delta = resizeStartXRef.current - ev.clientX
        const next = Math.min(600, Math.max(240, resizeStartWidthRef.current + delta))
        setAgentSidebarWidth(next)
      }

      const onMouseUp = () => {
        isResizingRef.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [agentSidebarWidth],
  )

  // AI Assistant Sidebar state & code proposal handlers (kept for legacy diff-accept UI)
  const [proposedChanges, setProposedChanges] = useState<{
    thought?: string
    name: string
    description: string
    icon: string
    frontendCode: string
    backendCode: string
    panelCode: string
  } | null>(null)
  const [pendingProposals, setPendingProposals] = useState<{
    frontend?: boolean
    backend?: boolean
    panel?: boolean
  } | null>(null)

  // Diff navigation state
  const diffEditorRef = useRef<any>(null)
  const [diffChanges, setDiffChanges] = useState<
    { startLineNumber: number; endLineNumber: number }[]
  >([])
  const [currentDiffIndex, setCurrentDiffIndex] = useState(-1)

  const handleDiffEditorMount: DiffOnMount = (editor) => {
    diffEditorRef.current = editor

    // Listen for diff computation updates via onDidUpdateDiff
    const diffModel = (editor as any).getModel?.()
    if (diffModel && typeof diffModel.onDidUpdateDiff === 'function') {
      diffModel.onDidUpdateDiff(() => {
        extractDiffChanges(editor)
      })
    }

    // Also try with a series of retries as fallback
    const tryExtract = (retries: number) => {
      extractDiffChanges(editor)
      if (retries > 0) {
        setTimeout(() => {
          // Only retry if we still haven't found changes
          const diffEd = diffEditorRef.current
          if (diffEd) {
            const changes = diffEd.getLineChanges?.()
            if (!changes || changes.length === 0) {
              tryExtract(retries - 1)
            }
          }
        }, 500)
      }
    }
    // Start retries after initial delay
    setTimeout(() => tryExtract(5), 300)
  }

  const extractDiffChanges = (editor?: any) => {
    const diffEd = editor || diffEditorRef.current
    if (!diffEd) return
    try {
      const changes = diffEd.getLineChanges?.() || []
      if (changes.length > 0) {
        const mapped = changes.map((c: any) => ({
          startLineNumber: c.modifiedStartLineNumber || c.originalStartLineNumber,
          endLineNumber:
            c.modifiedEndLineNumber ||
            c.originalEndLineNumber ||
            c.modifiedStartLineNumber ||
            c.originalStartLineNumber,
        }))
        setDiffChanges(mapped)
        if (currentDiffIndex < 0) {
          setCurrentDiffIndex(0)
          // Auto-reveal first change
          const modEditor = diffEd.getModifiedEditor?.()
          if (modEditor && mapped.length > 0) {
            modEditor.revealLineInCenter(mapped[0].startLineNumber)
          }
        }
      }
    } catch {
      // silently ignore
    }
  }

  const navigateDiff = (direction: 'prev' | 'next') => {
    const diffEd = diffEditorRef.current
    if (!diffEd) return

    // If no changes detected yet, try to extract them now
    let changes = diffChanges
    if (changes.length === 0) {
      try {
        const rawChanges = diffEd.getLineChanges?.() || []
        if (rawChanges.length > 0) {
          changes = rawChanges.map((c: any) => ({
            startLineNumber: c.modifiedStartLineNumber || c.originalStartLineNumber,
            endLineNumber:
              c.modifiedEndLineNumber ||
              c.originalEndLineNumber ||
              c.modifiedStartLineNumber ||
              c.originalStartLineNumber,
          }))
          setDiffChanges(changes)
        }
      } catch {
        // ignore
      }
    }

    if (changes.length === 0) return

    let newIndex: number
    if (direction === 'next') {
      newIndex = currentDiffIndex < 0 ? 0 : (currentDiffIndex + 1) % changes.length
    } else {
      newIndex =
        currentDiffIndex < 0
          ? changes.length - 1
          : (currentDiffIndex - 1 + changes.length) % changes.length
    }
    setCurrentDiffIndex(newIndex)
    const change = changes[newIndex]
    if (change) {
      const modEditor = diffEd.getModifiedEditor?.()
      if (modEditor) {
        modEditor.revealLineInCenter(change.startLineNumber)
        modEditor.setPosition({
          lineNumber: change.startLineNumber,
          column: 1,
        })
      }
    }
  }

  // Keep activeTabRef in sync so Monaco command callback always reads the latest tab
  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  // Reset diff navigation when tab changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset on activeTab change
  useEffect(() => {
    setDiffChanges([])
    setCurrentDiffIndex(-1)
    diffEditorRef.current = null
  }, [activeTab])

  // Register Cmd+L on Monaco editor: add selected lines as snippet to AI sidebar
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, () => {
      const selection = editor.getSelection()
      if (!selection) return
      const tab = activeTabRef.current
      const file =
        tab === 'frontend' ? 'frontend/index.jsx'
        : tab === 'backend' ? 'backend/index.js'
        : 'panel/index.jsx'
      agentSidebarRef.current?.addSnippet(file, selection.startLineNumber, selection.endLineNumber)
    })
  }, [])

  const handleAcceptTab = (tab: 'frontend' | 'backend' | 'panel') => {
    if (!proposedChanges || !pendingProposals) return

    if (tab === 'frontend') {
      setFormFrontendCode(proposedChanges.frontendCode)
    } else if (tab === 'backend') {
      setFormBackendCode(proposedChanges.backendCode || '')
    } else if (tab === 'panel') {
      setFormPanelCode(proposedChanges.panelCode || '')
    }

    // Tự động áp dụng Metadata mới (Tên, Mô tả, Icon)
    setFormName(proposedChanges.name)
    setFormDescription(proposedChanges.description)
    setFormIcon(proposedChanges.icon)

    const nextPending = { ...pendingProposals }
    delete nextPending[tab]
    setPendingProposals(nextPending)

    const remainingKeys = Object.keys(nextPending) as ('frontend' | 'backend' | 'panel')[]

    if (remainingKeys.length === 0) {
      setProposedChanges(null)
      setPendingProposals(null)
    } else {
      setActiveTab(remainingKeys[0])
    }

    setPreviewKey((k) => k + 1)
    toast.success(
      `Đã áp dụng thay đổi cho phần ${tab === 'frontend' ? 'Frontend' : tab === 'backend' ? 'Backend' : 'Panel'}!`,
    )
  }

  const handleDeclineTab = (tab: 'frontend' | 'backend' | 'panel') => {
    if (!proposedChanges || !pendingProposals) return

    const nextPending = { ...pendingProposals }
    delete nextPending[tab]
    setPendingProposals(nextPending)

    const remainingKeys = Object.keys(nextPending) as ('frontend' | 'backend' | 'panel')[]

    if (remainingKeys.length === 0) {
      setProposedChanges(null)
      setPendingProposals(null)
    } else {
      setActiveTab(remainingKeys[0])
    }

    toast.info(
      `Đã bỏ qua đề xuất thay đổi cho phần ${tab === 'frontend' ? 'Frontend' : tab === 'backend' ? 'Backend' : 'Panel'}.`,
    )
  }

  // Load existing app
  const loadApp = useCallback(async () => {
    if (!appId) return
    setLoading(true)
    try {
      const app: MiniAppDetail | null = await window.api?.getMiniApp(appId)
      if (!app) {
        toast.error('Mini app not found')
        navigate('/mini-apps')
        return
      }
      setFormName(app.name)
      setFormDescription(app.description)
      setFormIcon(app.icon)
      setFormVersion(app.version)
      setFormBackendCode(app.backendCode || '')
      setFormFrontendCode(app.frontendCode || '')
      setFormPanelCode(app.panelCode || '')

      // Load config
      try {
        const configResult = await window.api?.getMiniAppConfig(appId)
        if (configResult?.success && configResult.schema) {
          setConfigSchema(configResult.schema)
          setConfigValues(configResult.values || {})
        }
      } catch {
        // no config
      }
    } catch {
      toast.error('Failed to load mini app')
      navigate('/mini-apps')
    }
    setLoading(false)
  }, [appId, navigate])

  useEffect(() => {
    loadApp()
  }, [loadApp])

  // Load workspace path for AI agent (mini-app filesystem directory)
  useEffect(() => {
    if (!appId) return
    window.api
      ?.getMiniAppWorkspacePath(appId)
      .then(setMiniAppWorkspacePath)
      .catch(() => {})
  }, [appId])

  // Reload code from disk after AI agent writes files — show diff for accept/reject
  const handleAgentFilesChanged = useCallback(async () => {
    if (!appId) return
    try {
      const code = await window.api?.readMiniAppCode(appId)
      if (!code) return

      const pending: { frontend?: boolean; backend?: boolean; panel?: boolean } = {}
      if ((code.frontendCode || '').trim() !== formFrontendCode.trim()) pending.frontend = true
      if ((code.backendCode || '').trim() !== formBackendCode.trim()) pending.backend = true
      if ((code.panelCode || '').trim() !== formPanelCode.trim()) pending.panel = true

      if (Object.keys(pending).length === 0) return

      setProposedChanges({
        name: formName,
        description: formDescription,
        icon: formIcon,
        frontendCode: code.frontendCode || '',
        backendCode: code.backendCode || '',
        panelCode: code.panelCode || '',
      })
      setPendingProposals(pending)
      setActiveTab(Object.keys(pending)[0] as 'frontend' | 'backend' | 'panel')
      toast.success('AI đã cập nhật code — hãy xem xét và chấp nhận hoặc từ chối thay đổi.')
    } catch {
      // ignore
    }
  }, [appId, formName, formDescription, formIcon, formFrontendCode, formBackendCode, formPanelCode])

  // ─── Log Listener ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!appId) return
    const cleanup = window.api?.onMiniAppLog(
      (msg: { appId: string; appName: string; timestamp: number; args: string[] }) => {
        if (msg.appId === appId) {
          setLogs((prev) => [
            ...prev.slice(-200), // keep last 200 logs
            {
              id: `log-${msg.timestamp}-${Math.random()}`,
              appName: msg.appName,
              timestamp: msg.timestamp,
              message: msg.args.join(' '),
            },
          ])
        }
      },
    )
    return () => cleanup?.()
  }, [appId])

  // Auto-scroll logs
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.warning('App name is required')
      return
    }

    setSaving(true)
    try {
      if (isCreating) {
        const result = await window.api?.createMiniApp({
          name: formName.trim(),
          description: formDescription.trim(),
          icon: formIcon,
          version: formVersion,
          backendCode: formBackendCode,
          frontendCode: formFrontendCode,
          panelCode: formPanelCode || null,
        })
        if (result?.success) {
          toast.success(`Created "${formName.trim()}"`)
          navigate('/mini-apps')
        }
      } else if (appId) {
        await window.api?.updateMiniApp(appId, {
          name: formName.trim(),
          description: formDescription.trim(),
          icon: formIcon,
          version: formVersion,
          backendCode: formBackendCode,
          frontendCode: formFrontendCode,
          panelCode: formPanelCode || null,
        })
        // Save config values
        if (configSchema) {
          for (const [key, value] of Object.entries(configValues)) {
            await window.api?.setMiniAppConfig(appId, key, value)
          }
        }
        toast.success(`Updated "${formName.trim()}"`)
        navigate('/mini-apps')
      }
    } catch {
      toast.error('Failed to save mini app')
    }
    setSaving(false)
  }

  // Get current code value based on active tab
  const currentCode =
    activeTab === 'frontend'
      ? formFrontendCode
      : activeTab === 'backend'
        ? formBackendCode
        : formPanelCode

  const handleCodeChange = (value: string | undefined) => {
    const code = value || ''
    if (activeTab === 'frontend') setFormFrontendCode(code)
    else if (activeTab === 'backend') setFormBackendCode(code)
    else setFormPanelCode(code)
  }

  const tabs: { key: CodeTab; label: string; icon: React.ReactNode }[] = [
    { key: 'frontend', label: 'Frontend', icon: <Code size={13} /> },
    { key: 'backend', label: 'Backend', icon: <Terminal size={13} /> },
    { key: 'panel', label: 'Panel', icon: <Settings size={13} /> },
    { key: 'preview', label: 'Preview', icon: <Eye size={13} /> },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-hairline)] shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/mini-apps')}
            className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] bg-transparent border border-[var(--color-hairline)] text-[var(--color-body)] cursor-pointer transition-all duration-150 hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-ink)] leading-tight">
              {isCreating ? 'New Mini App' : formName || 'Edit App'}
            </h2>
            <p className="text-[11px] text-[var(--color-mute)]">
              {isCreating ? 'Create a new mini app' : `Editing · v${formVersion}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="default"
            size="small"
            icon={<Sparkles size={13} />}
            onClick={() => setShowAIAgent((prev) => !prev)}
            className={
              showAIAgent
                ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10'
                : ''
            }
          >
            AI Assistant
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<Save size={13} />}
            onClick={handleSave}
            loading={saving}
          >
            {isCreating ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Metadata bar */}
      <div className="flex items-end gap-3 px-5 py-3 border-b border-[var(--color-hairline)] shrink-0 bg-[var(--color-canvas)]">
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)] mb-1 block">
            Name
          </span>
          <Input
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="My Mini App"
            size="small"
          />
        </div>
        <div className="w-[100px] shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)] mb-1 block">
            Version
          </span>
          <Input
            value={formVersion}
            onChange={(e) => setFormVersion(e.target.value)}
            placeholder="1.0.0"
            size="small"
          />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)] mb-1 block">
            Description
          </span>
          <Input
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            placeholder="What does this app do?"
            size="small"
          />
        </div>
        <div className="w-[120px] shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)] mb-1 block">
            Icon
          </span>
          <Select
            value={formIcon}
            onChange={setFormIcon}
            options={ICON_OPTIONS.map((i) => ({ value: i, label: i }))}
            size="small"
            className="w-full"
            showSearch
          />
        </div>
      </div>

      {/* Config bar (only when editing and config exists) */}
      {configSchema && Object.keys(configSchema).length > 0 && (
        <div className="flex items-end gap-3 px-5 py-3 border-b border-[var(--color-hairline)] shrink-0 bg-[var(--color-canvas)]">
          <div className="flex items-center gap-1.5 mr-1 shrink-0 pb-1">
            <Settings size={12} className="text-[var(--color-primary)]" />
            <span className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)]">
              Config
            </span>
          </div>
          {Object.entries(configSchema).map(([key, field]: [string, any]) => (
            <div key={key} className="min-w-[140px]">
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[11px] font-medium text-[var(--color-ink)]">
                  {field.label || key}
                </span>
                {field.required && <span className="text-[10px] text-red-400">*</span>}
              </div>
              {field.type === 'boolean' ? (
                <Switch
                  size="small"
                  checked={!!configValues[key]}
                  onChange={(checked) => setConfigValues((prev) => ({ ...prev, [key]: checked }))}
                />
              ) : field.type === 'number' ? (
                <InputNumber
                  value={configValues[key] ?? field.default ?? ''}
                  onChange={(val) => setConfigValues((prev) => ({ ...prev, [key]: val }))}
                  placeholder={field.default !== undefined ? String(field.default) : ''}
                  size="small"
                  className="w-full"
                />
              ) : (
                <Input
                  value={configValues[key] ?? field.default ?? ''}
                  onChange={(e) =>
                    setConfigValues((prev) => ({
                      ...prev,
                      [key]: e.target.value,
                    }))
                  }
                  placeholder={field.default !== undefined ? String(field.default) : ''}
                  size="small"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Code Editor + Logs + AI Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor area + Logs */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Tab bar */}
          <div className="flex items-center justify-between border-b border-[var(--color-hairline)] shrink-0 bg-[var(--color-canvas)]">
            <div className="flex items-center gap-0">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key)
                    if (tab.key === 'preview') setPreviewKey((k) => k + 1)
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium cursor-pointer transition-colors duration-150 border-b-2 bg-transparent border-x-0 border-t-0 ${
                    activeTab === tab.key
                      ? 'text-[var(--color-primary)] border-[var(--color-primary)]'
                      : 'text-[var(--color-mute)] border-transparent hover:text-[var(--color-body)]'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.key === 'panel' && (
                    <span className="text-[9px] text-[var(--color-mute)] ml-0.5">opt</span>
                  )}
                </button>
              ))}
            </div>
            {/* Logs toggle */}
            {!isCreating && (
              <button
                type="button"
                onClick={() => setShowLogs(!showLogs)}
                className={`flex items-center gap-1.5 px-3 py-1 mr-2 text-[11px] font-medium rounded-[var(--radius-sm)] border cursor-pointer transition-colors ${
                  showLogs
                    ? 'bg-[var(--color-primary)]/10 border-[var(--color-primary)]/20 text-[var(--color-primary)]'
                    : 'bg-transparent border-[var(--color-hairline)] text-[var(--color-mute)] hover:text-[var(--color-body)]'
                }`}
              >
                <Terminal size={11} />
                Logs
                {logs.length > 0 && (
                  <span className="text-[9px] bg-[var(--color-primary)]/20 text-[var(--color-primary)] px-1 rounded-full">
                    {logs.length}
                  </span>
                )}
                <ChevronDown
                  size={10}
                  className={`transition-transform ${showLogs ? 'rotate-180' : ''}`}
                />
              </button>
            )}
          </div>

          {/* Main content area (editor/preview + logs) */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Editor / Preview */}
            <div
              className={`overflow-hidden ${showLogs ? 'flex-1 min-h-0' : 'flex-1'} flex flex-col`}
            >
              {activeTab === 'preview' ? (
                /* Live Preview */
                appId ? (
                  <div className="h-full bg-[var(--color-canvas-soft)] flex flex-col overflow-hidden flex-1">
                    {proposedChanges && (
                      <div className="px-5 py-2 bg-amber-950/20 border-b border-amber-950/30 text-amber-400 text-[11px] font-medium flex items-center gap-1.5 shrink-0 select-none">
                        <Sparkles size={11} className="animate-pulse shrink-0" />
                        <span>
                          Preview đang hiển thị mã nguồn hiện tại. Hãy Chấp nhận (Accept) các đề
                          xuất ở từng tab để cập nhật mã mới vào Preview.
                        </span>
                      </div>
                    )}
                    <div className="flex-1 overflow-auto">
                      <MiniAppRenderer key={previewKey} appId={appId} />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full flex-1">
                    <div className="text-center">
                      <Eye size={32} className="text-[var(--color-mute)] mx-auto mb-2" />
                      <p className="text-[12px] text-[var(--color-mute)]">
                        Save the app first to preview
                      </p>
                    </div>
                  </div>
                )
              ) : proposedChanges &&
                pendingProposals &&
                pendingProposals[activeTab as 'frontend' | 'backend' | 'panel'] ? (
                <div className="flex-1 flex flex-col overflow-hidden relative">
                  <DiffEditor
                    language="javascript"
                    theme="vs-dark"
                    original={
                      activeTab === 'frontend'
                        ? formFrontendCode
                        : activeTab === 'backend'
                          ? formBackendCode
                          : formPanelCode
                    }
                    modified={
                      activeTab === 'frontend'
                        ? proposedChanges.frontendCode
                        : activeTab === 'backend'
                          ? proposedChanges.backendCode
                          : proposedChanges.panelCode || ''
                    }
                    options={{ ...MONACO_OPTIONS, readOnly: true }}
                    beforeMount={handleEditorBeforeMount}
                    onMount={handleDiffEditorMount}
                  />
                  {/* Floating Action Bar for proposed code per tab */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-[#161616]/95 backdrop-blur-md border border-[var(--color-hairline)] rounded-[var(--radius-sm)] px-3.5 py-2 flex items-center gap-3 shadow-2xl select-none">
                    <span className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-[0.5px] flex items-center gap-1">
                      <Sparkles size={10} className="animate-pulse" />
                      AI Đề xuất
                    </span>

                    {/* Metadata changes hint tooltip */}
                    {(proposedChanges.name !== formName ||
                      proposedChanges.description !== formDescription ||
                      proposedChanges.icon !== formIcon) && (
                      <div className="group relative">
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 cursor-help font-semibold">
                          + Info
                        </span>
                        <div className="absolute right-0 bottom-full mb-2 w-64 p-3 bg-[#1e1e1e] border border-[var(--color-hairline)] rounded-[var(--radius-md)] shadow-xl hidden group-hover:block z-20 text-[10px] leading-relaxed text-[var(--color-mute)]">
                          <span className="font-semibold text-[var(--color-ink)] block mb-1">
                            AI đề xuất đổi thông tin app:
                          </span>
                          {proposedChanges.name !== formName && (
                            <div className="mb-0.5">
                              Tên: <span className="line-through">{formName}</span> →{' '}
                              <span className="text-[var(--color-primary)] font-medium">
                                {proposedChanges.name}
                              </span>
                            </div>
                          )}
                          {proposedChanges.description !== formDescription && (
                            <div className="mb-0.5">
                              Mô tả: <span className="line-through">{formDescription}</span> →{' '}
                              <span className="text-[var(--color-primary)] font-medium">
                                {proposedChanges.description}
                              </span>
                            </div>
                          )}
                          {proposedChanges.icon !== formIcon && (
                            <div>
                              Icon: <span className="line-through">{formIcon}</span> →{' '}
                              <span className="text-[var(--color-primary)] font-medium">
                                {proposedChanges.icon}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="h-3 w-[1px] bg-[var(--color-hairline)]" />

                    {/* Diff navigation arrows */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => navigateDiff('prev')}
                        title="Thay đổi trước (↑)"
                        className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-xs)] border border-[var(--color-hairline)] bg-transparent text-[var(--color-mute)] hover:text-[var(--color-ink)] hover:border-[var(--color-primary)]/40 cursor-pointer transition-colors"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigateDiff('next')}
                        title="Thay đổi tiếp theo (↓)"
                        className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-xs)] border border-[var(--color-hairline)] bg-transparent text-[var(--color-mute)] hover:text-[var(--color-ink)] hover:border-[var(--color-primary)]/40 cursor-pointer transition-colors"
                      >
                        <ChevronDown size={12} />
                      </button>
                      {diffChanges.length > 0 && (
                        <span className="text-[9px] text-[var(--color-mute)] tabular-nums min-w-[28px] text-center">
                          {currentDiffIndex + 1}/{diffChanges.length}
                        </span>
                      )}
                    </div>

                    <div className="h-3 w-[1px] bg-[var(--color-hairline)]" />

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleDeclineTab(activeTab as 'frontend' | 'backend' | 'panel')
                        }
                        className="h-6 px-2.5 text-[10px] font-semibold border border-[var(--color-hairline)] bg-transparent text-[var(--color-mute)] hover:text-red-400 hover:border-red-900/30 rounded-[var(--radius-xs)] cursor-pointer transition-colors"
                      >
                        Từ chối (Decline)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleAcceptTab(activeTab as 'frontend' | 'backend' | 'panel')
                        }
                        className="h-6 px-2.5 text-[10px] font-semibold bg-[var(--color-primary)] text-[var(--color-on-primary)] border-none rounded-[var(--radius-xs)] cursor-pointer transition-opacity hover:opacity-90 active:scale-[0.98]"
                      >
                        Chấp nhận (Accept)
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {proposedChanges &&
                    pendingProposals &&
                    !pendingProposals[activeTab as 'frontend' | 'backend' | 'panel'] &&
                    Object.keys(pendingProposals).length > 0 && (
                      <div className="px-5 py-2 bg-blue-950/20 border-b border-blue-950/30 text-blue-400 text-[11px] font-medium flex items-center gap-2 shrink-0 select-none">
                        <Sparkles
                          size={11}
                          className="text-[var(--color-primary)] animate-pulse shrink-0"
                        />
                        <span>
                          Đã duyệt xong phần{' '}
                          <span className="text-[var(--color-ink)] font-semibold uppercase">
                            {activeTab}
                          </span>
                          . Vẫn còn đề xuất chưa duyệt ở:{' '}
                          {Object.keys(pendingProposals).map((t, idx, arr) => (
                            <span key={t}>
                              <button
                                type="button"
                                onClick={() => setActiveTab(t as CodeTab)}
                                className="text-[var(--color-primary)] font-semibold hover:underline bg-transparent border-none p-0 cursor-pointer uppercase font-mono text-[10px]"
                              >
                                {t}
                              </button>
                              {idx < arr.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </span>
                      </div>
                    )}
                  <Editor
                    language="javascript"
                    theme="vs-dark"
                    value={currentCode}
                    onChange={handleCodeChange}
                    options={MONACO_OPTIONS}
                    beforeMount={handleEditorBeforeMount}
                    onMount={handleEditorMount}
                  />
                </div>
              )}
            </div>

            {/* Logs Panel */}
            {showLogs && (
              <div className="h-[200px] shrink-0 border-t border-[var(--color-hairline)] flex flex-col bg-[#1a1a1a]">
                {/* Logs header */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-hairline)] shrink-0">
                  <div className="flex items-center gap-2">
                    <Terminal size={11} className="text-[var(--color-mute)]" />
                    <span className="text-[11px] font-semibold text-[var(--color-body)]">
                      Backend Logs
                    </span>
                    <span className="text-[10px] text-[var(--color-mute)]">
                      {logs.length} entries
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLogs([])}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[var(--color-mute)] bg-transparent border-none cursor-pointer hover:text-[var(--color-body)] transition-colors"
                  >
                    <Trash2 size={10} />
                    Clear
                  </button>
                </div>
                {/* Logs content */}
                <div className="flex-1 overflow-y-auto px-3 py-1.5 font-[var(--font-mono)]">
                  {logs.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <span className="text-[11px] text-[var(--color-mute)] opacity-50">
                        No logs yet. Backend ctx.log() output will appear here.
                      </span>
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div key={log.id} className="flex items-start gap-2 py-0.5 text-[11px]">
                        <span className="text-[var(--color-mute)] shrink-0 select-none">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="text-[var(--color-body)] whitespace-pre-wrap break-all">
                          {log.message}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}
          </div>
        </div>

        {showAIAgent && (
          <>
            {/* Drag handle */}
            <div
              onMouseDown={handleResizeMouseDown}
              className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-primary)] active:bg-[var(--color-primary)] transition-colors bg-transparent group relative"
              title="Drag to resize"
            />
            <div
              style={{ width: agentSidebarWidth, minWidth: agentSidebarWidth }}
              className="shrink-0 flex flex-col h-full overflow-hidden"
            >
              <AIAgentSidebar
                ref={agentSidebarRef}
                storageKey={appId}
                initialWorkspacePath={miniAppWorkspacePath}
                projectContext={
                  formName
                    ? `Mini-app: ${formName}\nDescription: ${formDescription}\nFiles: frontend/index.jsx (React UI), backend/index.js (Node.js backend), panel/index.jsx (optional settings panel)`
                    : undefined
                }
                codeFiles={{
                  'frontend/index.jsx': formFrontendCode,
                  'backend/index.js': formBackendCode,
                  ...(formPanelCode ? { 'panel/index.jsx': formPanelCode } : {}),
                }}
                onFilesChanged={handleAgentFilesChanged}
                onClose={() => setShowAIAgent(false)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
