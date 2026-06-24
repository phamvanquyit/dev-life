import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  Loader2,
  Search,
  Send,
  Square,
  Terminal,
  Wrench,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LlmProvider {
  id: string
  name: string
  provider: string
  models: { id: string; name: string }[]
}

export interface AIAgentSidebarProps {
  /** Pre-set workspace path (e.g. mini-app directory). User can change it. */
  initialWorkspacePath?: string
  /** Extra context injected into agent system prompt */
  projectContext?: string
  /** Called whenever the agent writes / edits files */
  onFilesChanged?: () => void
  onClose: () => void
  /** localStorage key prefix for persisting selected provider/model (e.g. app id) */
  storageKey?: string
}

// ── Chat message model ────────────────────────────────────────────────────────

interface ToolStep {
  id: string
  toolName: string
  toolArgs: Record<string, any>
  result?: string
  success?: boolean
  expanded: boolean
}

interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  steps?: ToolStep[]
  durationMs?: number
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ReactNode> = {
  read_file: <Folder size={11} />,
  write_file: <Check size={11} />,
  edit_file: <Check size={11} />,
  list_files: <Folder size={11} />,
  search_code: <Search size={11} />,
  run_command: <Terminal size={11} />,
}

const TOOL_STATUS: Record<string, string> = {
  read_file: 'Reading file',
  write_file: 'Writing file',
  edit_file: 'Editing file',
  list_files: 'Listing files',
  search_code: 'Searching code',
  run_command: 'Running command',
}

function toolLabel(name: string): string {
  return name.replace(/_/g, ' ')
}

// ── Markdown renderer (bold, inline code, code blocks) ────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const pattern = /(\*\*(.+?)\*\*|`([^`]+)`)/gs
  const nodes: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    if (match[0].startsWith('**')) {
      nodes.push(<strong key={match.index} className="font-semibold text-(--color-ink-strong)">{match[2]}</strong>)
    } else {
      nodes.push(<code key={match.index} className="px-1 py-0.5 rounded bg-(--color-canvas) text-(--color-primary) font-mono text-[11px]">{match[3]}</code>)
    }
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function renderMarkdown(text: string): React.ReactNode {
  const segments = text.split(/(```(?:[^\n]*)\n[\s\S]*?```)/g)
  return segments.map((seg, i) => {
    if (seg.startsWith('```')) {
      const body = seg.replace(/^```[^\n]*\n/, '').replace(/```$/, '')
      return (
        <pre key={i} className="mt-2 mb-1 p-3 rounded-sm bg-(--color-canvas) border border-(--color-hairline) text-[11px] font-mono text-(--color-ink) overflow-x-auto whitespace-pre">
          {body}
        </pre>
      )
    }
    const lines = seg.split('\n')
    return (
      <span key={i}>
        {lines.map((line, li) => (
          <span key={li}>
            {renderInline(line)}
            {li < lines.length - 1 && <br />}
          </span>
        ))}
      </span>
    )
  })
}

function shortArg(_name: string, args: Record<string, any>): string {
  if (args.path) return args.path as string
  if (args.command) return (args.command as string).slice(0, 60)
  if (args.pattern) return `"${args.pattern}"`
  return ''
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActivityBadge({ steps, hasText }: { steps: ToolStep[]; hasText: boolean }) {
  const activeTool = [...steps].reverse().find((s) => s.result === undefined)
  let label: string
  if (activeTool) {
    const base = TOOL_STATUS[activeTool.toolName] ?? toolLabel(activeTool.toolName)
    const hint = shortArg(activeTool.toolName, activeTool.toolArgs)
    label = hint ? `${base}: ${hint.split('/').pop() ?? hint}` : base
  } else if (!hasText) {
    label = 'Thinking'
  } else {
    label = 'Responding'
  }

  return (
    <span className="flex items-center gap-1 text-[11px] text-[var(--color-primary)] font-mono">
      <span
        className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] shrink-0"
        style={{ animation: 'thinking-bounce 1s ease-in-out infinite' }}
      />
      {label}…
    </span>
  )
}

function ThinkingDots() {
  return (
    <div className="flex items-end gap-[3px] px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] w-fit">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="block w-1.5 h-1.5 rounded-full bg-[var(--color-mute)]"
          style={{
            animation: 'thinking-bounce 1s ease-in-out infinite',
            animationDelay: `${delay}ms`,
          }}
        />
      ))}
    </div>
  )
}

function ToolStepCard({ step, onToggle }: { step: ToolStep; onToggle: () => void }) {
  const pending = step.result === undefined
  const icon = TOOL_ICONS[step.toolName] ?? <Wrench size={11} />
  const label = toolLabel(step.toolName)
  const hint = shortArg(step.toolName, step.toolArgs)

  return (
    <div className="border border-[var(--color-hairline)] rounded-[var(--radius-sm)] overflow-hidden text-[11px] font-mono my-1">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-[var(--color-canvas-soft)] hover:bg-[#1a1a1a] cursor-pointer select-none"
      >
        <span
          className={
            pending
              ? 'text-[var(--color-mute)]'
              : step.success
                ? 'text-[var(--color-primary)]'
                : 'text-red-400'
          }
        >
          {pending ? <Loader2 size={11} className="animate-spin" /> : icon}
        </span>
        <span className="text-[var(--color-ink)] font-semibold">{label}</span>
        {hint && <span className="text-[var(--color-mute)] truncate flex-1 text-left">{hint}</span>}
        <span className="text-[var(--color-mute)] shrink-0">
          {step.expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
      </button>

      {step.expanded && (
        <div className="border-t border-[var(--color-hairline)] bg-[#080808] p-2 max-h-48 overflow-y-auto">
          {/* Args */}
          <div className="text-[var(--color-mute)] mb-1.5">
            {Object.entries(step.toolArgs).map(([k, v]) => (
              <div key={k} className="flex gap-1.5">
                <span className="text-blue-400 shrink-0">{k}:</span>
                <span className="text-[var(--color-body)] break-all whitespace-pre-wrap">
                  {typeof v === 'string' ? v : JSON.stringify(v)}
                </span>
              </div>
            ))}
          </div>
          {/* Result */}
          {step.result !== undefined && (
            <div
              className={`mt-1 pt-1.5 border-t border-[var(--color-hairline)] whitespace-pre-wrap break-all ${step.success ? 'text-[var(--color-body)]' : 'text-red-400'}`}
            >
              {step.result}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Model selector ────────────────────────────────────────────────────────────

function ModelSelector({
  providers,
  selectedProviderId,
  selectedModelId,
  onProviderChange,
  onModelChange,
}: {
  providers: LlmProvider[]
  selectedProviderId: string
  selectedModelId: string
  onProviderChange: (id: string) => void
  onModelChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40)
  }, [open])

  const currentProvider = providers.find((p) => p.id === selectedProviderId)
  const currentModel = currentProvider?.models.find((m) => m.id === selectedModelId)
  const filtered = (currentProvider?.models || []).filter((m) =>
    m.name.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      {/* Provider */}
      <select
        value={selectedProviderId}
        onChange={(e) => onProviderChange(e.target.value)}
        className="text-[11px] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] text-[var(--color-ink)] rounded-[var(--radius-sm)] px-1.5 py-1 cursor-pointer outline-none"
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {/* Model dropdown */}
      <div ref={ref} className="relative flex-1 min-w-0">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between gap-1 text-[11px] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] text-[var(--color-ink)] rounded-[var(--radius-sm)] px-2 py-1 cursor-pointer hover:border-[var(--color-primary)] transition-colors"
        >
          <span className="truncate">{currentModel?.name || 'Select model'}</span>
          <ChevronDown size={10} className="shrink-0 text-[var(--color-mute)]" />
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] shadow-xl overflow-hidden">
            <div className="p-1.5 border-b border-[var(--color-hairline)]">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="w-full text-[11px] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] px-2 py-1 outline-none text-[var(--color-ink)] placeholder:text-[var(--color-mute)]"
              />
            </div>
            <div className="max-h-44 overflow-y-auto">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onModelChange(m.id)
                    setOpen(false)
                    setQuery('')
                  }}
                  className={`w-full text-left text-[11px] px-3 py-1.5 hover:bg-[var(--color-canvas-soft)] cursor-pointer ${m.id === selectedModelId ? 'text-[var(--color-primary)]' : 'text-[var(--color-ink)]'}`}
                >
                  {m.name}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="text-[11px] text-[var(--color-mute)] px-3 py-2">No models</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AIAgentSidebar({
  initialWorkspacePath = '',
  projectContext,
  onFilesChanged,
  onClose,
  storageKey,
}: AIAgentSidebarProps) {
  const lsKey = storageKey ? `ai-agent-model:${storageKey}` : null

  // ── Provider / model state ─────────────────────────────────────────────────
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [loadingProviders, setLoadingProviders] = useState(true)

  // ── Workspace ──────────────────────────────────────────────────────────────
  const [workspacePath, setWorkspacePath] = useState(initialWorkspacePath)

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [pendingSteps, setPendingSteps] = useState<ToolStep[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [input, setInput] = useState('')

  const requestIdRef = useRef<string | null>(null)
  const startTimeRef = useRef<number>(0)
  const cleanupRef = useRef<(() => void) | null>(null)
  const pendingStepsRef = useRef<ToolStep[]>([])
  const isRunningRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Load providers ─────────────────────────────────────────────────────────

  useEffect(() => {
    setLoadingProviders(true)
    window.api
      .listLlmProviders()
      .then((res: { success: boolean; providers?: any[]; error?: string }) => {
        if (res.success && res.providers?.length) {
          setProviders(res.providers)

          const saved = lsKey ? (() => {
            try { return JSON.parse(localStorage.getItem(lsKey) || 'null') } catch { return null }
          })() : null

          const savedProvider = saved?.providerId
            ? res.providers.find((p) => p.id === saved.providerId)
            : null
          const provider = savedProvider ?? res.providers[0]
          const model = savedProvider?.models.find((m: any) => m.id === saved?.modelId)
            ?? provider.models?.[0]

          setSelectedProviderId(provider.id)
          setSelectedModelId(model?.id || '')
        }
      })
      .finally(() => setLoadingProviders(false))
  }, [lsKey])

  // ── Workspace path sync ────────────────────────────────────────────────────

  useEffect(() => {
    setWorkspacePath(initialWorkspacePath)
  }, [initialWorkspacePath])

  // ── Auto-scroll ────────────────────────────────────────────────────────────

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on content change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingSteps, streamingText])

  // ── Provider helpers ───────────────────────────────────────────────────────

  // Persist selected provider/model whenever they change
  useEffect(() => {
    if (!lsKey || !selectedProviderId || !selectedModelId) return
    localStorage.setItem(lsKey, JSON.stringify({ providerId: selectedProviderId, modelId: selectedModelId }))
  }, [lsKey, selectedProviderId, selectedModelId])

  const handleProviderChange = useCallback(
    (id: string) => {
      setSelectedProviderId(id)
      const p = providers.find((x) => x.id === id)
      setSelectedModelId(p?.models?.[0]?.id || '')
    },
    [providers],
  )

  // ── Browse workspace ───────────────────────────────────────────────────────

  const handleBrowse = async () => {
    const res = await window.api.openDirectoryDialog()
    if (res.success && res.path) setWorkspacePath(res.path)
  }

  // ── Send message ───────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isRunningRef.current || !selectedProviderId || !selectedModelId || !workspacePath) return

    // Guard synchronously via ref to prevent double-call before React re-render
    isRunningRef.current = true
    setInput('')
    setIsRunning(true)
    startTimeRef.current = Date.now()

    // Add user message
    const userMsgId = `msg-${Date.now()}-u`
    const assistantMsgId = `msg-${Date.now()}-a`

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text },
      { id: assistantMsgId, role: 'assistant', content: '', steps: [] },
    ])
    setStreamingMsgId(assistantMsgId)
    setStreamingText('')
    pendingStepsRef.current = []
    setPendingSteps([])

    // Build conversation history (exclude last assistant message which is in-progress)
    const history = messages
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
      .map((m) => ({ role: m.role, content: m.content }))

    // Remove any stale listener from a previous run
    cleanupRef.current?.()
    cleanupRef.current = null

    // Subscribe to events
    const cleanup = window.api.onAgentEvent(
      (ev: {
        requestId: string
        type: 'token' | 'tool-start' | 'tool-result' | 'done' | 'error'
        token?: string
        toolName?: string
        toolArgs?: Record<string, any>
        toolResult?: string
        toolSuccess?: boolean
        fullText?: string
        filesChanged?: boolean
        error?: string
      }) => {
        if (ev.requestId !== requestIdRef.current) return

        if (ev.type === 'token') {
          setStreamingText((prev) => prev + (ev.token || ''))
        } else if (ev.type === 'tool-start') {
          const step: ToolStep = {
            id: `step-${Date.now()}-${Math.random()}`,
            toolName: ev.toolName || '',
            toolArgs: ev.toolArgs || {},
            expanded: false,
          }
          pendingStepsRef.current = [...pendingStepsRef.current, step]
          setPendingSteps(pendingStepsRef.current)
        } else if (ev.type === 'tool-result') {
          pendingStepsRef.current = pendingStepsRef.current.map((s) =>
            s.toolName === ev.toolName && s.result === undefined
              ? { ...s, result: ev.toolResult || '', success: ev.toolSuccess }
              : s,
          )
          setPendingSteps(pendingStepsRef.current)
        } else if (ev.type === 'done') {
          const finalSteps = pendingStepsRef.current
          if (ev.filesChanged && onFilesChanged) onFilesChanged()
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: ev.fullText || '',
                    steps: finalSteps,
                    durationMs: Date.now() - startTimeRef.current,
                  }
                : m,
            ),
          )
          pendingStepsRef.current = []
          setStreamingMsgId(null)
          setStreamingText('')
          setPendingSteps([])
          isRunningRef.current = false
          setIsRunning(false)
          cleanup()
          cleanupRef.current = null
        } else if (ev.type === 'error') {
          const finalSteps = pendingStepsRef.current
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: '',
                    error: ev.error || 'Unknown error',
                    steps: finalSteps,
                    durationMs: Date.now() - startTimeRef.current,
                  }
                : m,
            ),
          )
          pendingStepsRef.current = []
          setStreamingMsgId(null)
          setStreamingText('')
          setPendingSteps([])
          isRunningRef.current = false
          setIsRunning(false)
          cleanup()
          cleanupRef.current = null
        }
      },
    )
    cleanupRef.current = cleanup

    // Start agent
    const res = await window.api.sendAgentMessage({
      providerId: selectedProviderId,
      modelId: selectedModelId,
      workspacePath,
      projectContext,
      conversationHistory: history,
      userMessage: text,
    })

    if (!res.success) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, error: res.error || 'Failed to start agent', durationMs: 0 }
            : m,
        ),
      )
      setStreamingMsgId(null)
      setIsRunning(false)
      cleanup()
      cleanupRef.current = null
      return
    }

    requestIdRef.current = res.requestId || null
  }, [
    input,
    isRunning,
    selectedProviderId,
    selectedModelId,
    workspacePath,
    projectContext,
    messages,
    onFilesChanged,
  ])

  // ── Stop ───────────────────────────────────────────────────────────────────

  const handleStop = async () => {
    if (requestIdRef.current) {
      await window.api.cancelAgent(requestIdRef.current)
    }
    cleanupRef.current?.()
    cleanupRef.current = null
    pendingStepsRef.current = []
    setStreamingMsgId(null)
    setStreamingText('')
    setPendingSteps([])
    isRunningRef.current = false
    setIsRunning(false)
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Toggle tool step ───────────────────────────────────────────────────────

  const toggleStep = useCallback((msgId: string, stepId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              steps: m.steps?.map((s) => (s.id === stepId ? { ...s, expanded: !s.expanded } : s)),
            }
          : m,
      ),
    )
  }, [])

  const togglePendingStep = useCallback((stepId: string) => {
    setPendingSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, expanded: !s.expanded } : s)),
    )
  }, [])

  // ── Clear chat ─────────────────────────────────────────────────────────────

  const clearChat = () => {
    if (isRunning) return
    setMessages([])
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const canSend = Boolean(
    input.trim() && selectedProviderId && selectedModelId && workspacePath && !isRunning,
  )

  return (
    <div className="flex flex-col h-full w-full bg-[var(--color-canvas)] border-l border-[var(--color-hairline)] text-[var(--color-ink)]">
      <style>{`@keyframes thinking-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}`}</style>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-hairline)] shrink-0">
        <Bot size={15} className="text-[var(--color-primary)] shrink-0" />
        <span className="font-semibold text-[13px] flex-1">AI Coding Agent</span>
        {messages.length > 0 && !isRunning && (
          <button
            type="button"
            onClick={clearChat}
            className="text-[11px] text-[var(--color-mute)] hover:text-[var(--color-ink)] cursor-pointer px-1.5 py-0.5 rounded hover:bg-[var(--color-canvas-soft)]"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--color-mute)] hover:text-[var(--color-ink)] cursor-pointer p-0.5 rounded hover:bg-[var(--color-canvas-soft)]"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Workspace bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] shrink-0">
        <Folder size={11} className="text-[var(--color-mute)] shrink-0" />
        <span
          className="flex-1 text-[11px] font-mono text-[var(--color-body)] truncate"
          title={workspacePath || 'No workspace selected'}
        >
          {workspacePath || <span className="text-[var(--color-mute)] italic">No workspace</span>}
        </span>
        <button
          type="button"
          onClick={handleBrowse}
          className="shrink-0 text-[11px] text-[var(--color-primary)] hover:underline cursor-pointer"
        >
          Browse
        </button>
      </div>

      {/* ── Model selector ─────────────────────────────────────────────────── */}
      <div className="px-3 py-1.5 border-b border-[var(--color-hairline)] shrink-0">
        {loadingProviders ? (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-mute)]">
            <Loader2 size={11} className="animate-spin" />
            Loading providers…
          </div>
        ) : providers.length === 0 ? (
          <p className="text-[11px] text-[var(--color-mute)]">
            No LLM providers configured. Add one in Settings → LLM Providers.
          </p>
        ) : (
          <ModelSelector
            providers={providers}
            selectedProviderId={selectedProviderId}
            selectedModelId={selectedModelId}
            onProviderChange={handleProviderChange}
            onModelChange={setSelectedModelId}
          />
        )}
      </div>

      {/* ── Chat area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        {messages.length === 0 && !isRunning && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            <Bot size={32} className="text-[var(--color-mute)]" />
            <p className="text-[13px] text-[var(--color-mute)] leading-relaxed">
              {workspacePath
                ? 'Ask me to read, write, or modify files in your project.'
                : 'Select a workspace directory, then ask me to help with your code.'}
            </p>
            {workspacePath && (
              <div className="flex flex-wrap gap-1.5 justify-center mt-1">
                {[
                  'List all files',
                  'Read README',
                  'Find all TODO comments',
                  'Explain the project structure',
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setInput(s)}
                    className="text-[11px] px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] text-[var(--color-body)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] cursor-pointer transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => {
          const isCurrentStreaming = msg.id === streamingMsgId
          // Show pending steps inline for the in-progress assistant message
          const stepsToShow = isCurrentStreaming ? pendingSteps : msg.steps

          return (
            <div
              key={msg.id}
              className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              {/* Tool steps */}
              {msg.role === 'assistant' && stepsToShow && stepsToShow.length > 0 && (
                <div className="w-full">
                  {stepsToShow.map((s) => (
                    <ToolStepCard
                      key={s.id}
                      step={s}
                      onToggle={() =>
                        isCurrentStreaming ? togglePendingStep(s.id) : toggleStep(msg.id, s.id)
                      }
                    />
                  ))}
                </div>
              )}

              {/* Thinking indicator — visible before any token or tool arrives */}
              {isCurrentStreaming && !streamingText && pendingSteps.length === 0 && (
                <ThinkingDots />
              )}

              {/* Activity badge — below tool steps while a tool is still pending and no text yet */}
              {isCurrentStreaming && pendingSteps.some((s) => s.result === undefined) && !streamingText && (
                <ActivityBadge steps={pendingSteps} hasText={false} />
              )}

              {/* Text bubble */}
              {(isCurrentStreaming ? streamingText : msg.content) || msg.error ? (
                <div
                  className={`max-w-[92%] px-3 py-2 rounded-[var(--radius-md)] text-[13px] leading-relaxed wrap-break-word ${
                    msg.role === 'user'
                      ? 'bg-[var(--color-primary)] text-black'
                      : msg.error
                        ? 'bg-red-950/30 border border-red-900/50 text-red-300'
                        : 'bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] text-[var(--color-ink)]'
                  }`}
                >
                  {msg.error ? (
                    <span className="flex items-center gap-1.5">
                      <AlertCircle size={13} />
                      {msg.error}
                    </span>
                  ) : isCurrentStreaming ? (
                    <>
                      <span className="whitespace-pre-wrap">{streamingText}</span>
                      <span className="inline-block w-1 h-3.5 bg-current ml-0.5 animate-pulse align-middle" />
                    </>
                  ) : msg.role === 'assistant' ? (
                    renderMarkdown(msg.content)
                  ) : (
                    msg.content
                  )}
                </div>
              ) : null}

              {/* Activity status — visible below the text bubble while agent is still running */}
              {isCurrentStreaming && streamingText && (
                <ActivityBadge steps={pendingSteps} hasText={true} />
              )}

              {/* Duration */}
              {msg.durationMs !== undefined && msg.role === 'assistant' && (
                <span className="text-[10px] text-[var(--color-mute)] font-mono">
                  {(msg.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ──────────────────────────────────────────────────────── */}
      <div className="border-t border-[var(--color-hairline)] px-3 py-2 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !workspacePath
                ? 'Select a workspace first…'
                : isRunning
                  ? 'Agent is running…'
                  : 'Ask anything about the codebase… (Enter to send)'
            }
            disabled={isRunning || !workspacePath}
            rows={1}
            style={{ resize: 'none', minHeight: '60px', maxHeight: '120px' }}
            className="flex-1 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] px-3 py-2 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-mute)] outline-none focus:border-[var(--color-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onInput={(e) => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = `${Math.min(t.scrollHeight, 120)}px`
            }}
          />
          {isRunning ? (
            <button
              type="button"
              onClick={handleStop}
              title="Stop agent"
              className="shrink-0 flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)] bg-red-600 hover:bg-red-700 text-white cursor-pointer transition-colors"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              title="Send (Enter)"
              className="shrink-0 flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:opacity-90 text-black cursor-pointer transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={13} />
            </button>
          )}
        </div>
        <p className="text-[10px] text-[var(--color-mute)] mt-1">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}
