import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  FileCode,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  Terminal,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  analyzeValidationError,
  buildDeveloperPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  type CodeContext,
  detectTaskType,
  type ErrorAnalysis,
  parseAgentResponse,
} from '../../lib/agent-prompt-builder'
import { runFullValidation, validateIcon } from '../../lib/agent-validators'

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface AIAgentSidebarProps {
  appId?: string
  appName: string
  appDescription: string
  appIcon: string
  appVersion: string
  frontendCode: string
  backendCode: string
  panelCode: string
  onCodeProposed: (proposedCode: ProposedCode | null) => void
  onClose: () => void
}

interface LlmProvider {
  id: string
  name: string
  provider: string
  models: { id: string; name: string }[]
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  logs?: ThoughtLog[]
  durationMs?: number
}

interface ThoughtLog {
  id: string
  timestamp: number
  type: 'planner' | 'retriever' | 'llm' | 'editor' | 'validator' | 'healing' | 'success' | 'error'
  message: string
  durationMs?: number
}

interface ProposedCode {
  thought?: string
  name: string
  description: string
  icon: string
  frontendCode: string
  backendCode: string
  panelCode: string
}

// ─── Validators & Prompt Builder are now in separate modules ─────────────────
// See: ../../lib/agent-prompt-builder.ts (3-layer prompt + XML parser)
// See: ../../lib/agent-validators.ts (syntax, API surface, icon validation)

interface AgentStepsSummaryProps {
  logs?: ThoughtLog[]
  durationMs?: number
  isRunning?: boolean
}

function AgentStepsSummary({ logs, durationMs, isRunning }: AgentStepsSummaryProps) {
  const [isOpen, setIsOpen] = useState(isRunning)

  useEffect(() => {
    if (isRunning) {
      setIsOpen(true)
    }
  }, [isRunning])

  if (!logs || logs.length === 0) return null

  const totalTime = durationMs
    ? `${(durationMs / 1000).toFixed(1)} giây`
    : isRunning
      ? 'Đang thực hiện...'
      : ''

  return (
    <div className="mb-2.5 border border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] rounded-[var(--radius-md)] overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center justify-between bg-[var(--color-canvas-soft)] border-none text-[var(--color-ink)] hover:bg-[#181818] cursor-pointer select-none font-medium transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Bot size={13} className="text-[var(--color-primary)] animate-pulse" />
          <span>
            {isRunning
              ? 'Tác nhân đang thực hiện...'
              : `Tác nhân đã thực hiện (${logs.length} bước)`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--color-mute)]">
          {totalTime && (
            <span className="font-mono bg-[#141414] px-1.5 py-0.5 rounded border border-[var(--color-hairline)] text-[var(--color-primary)]">
              {totalTime}
            </span>
          )}
          <span
            className="text-[9px] transition-transform duration-200"
            style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ▶
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="p-3 border-t border-[var(--color-hairline)] bg-[#0c0c0c] font-mono text-[10px] flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
          {logs.map((log) => {
            let icon = <Terminal size={10} className="text-[var(--color-mute)]" />
            let colorClass = 'text-[var(--color-body)]'

            if (log.type === 'planner') {
              icon = <Sparkles size={10} className="text-blue-400" />
              colorClass = 'text-blue-400'
            } else if (log.type === 'retriever') {
              icon = <FileCode size={10} className="text-yellow-500" />
              colorClass = 'text-yellow-500/90'
            } else if (log.type === 'validator') {
              icon = <Terminal size={10} className="text-[var(--color-primary)]" />
              colorClass = 'text-[var(--color-primary)]'
            } else if (log.type === 'healing') {
              icon = <RefreshCw size={10} className="text-amber-500 animate-spin" />
              colorClass = 'text-amber-400'
            } else if (log.type === 'success') {
              icon = <Check size={10} className="text-[var(--color-primary)]" />
              colorClass = 'text-[var(--color-primary)] font-semibold'
            } else if (log.type === 'error') {
              icon = <AlertTriangle size={10} className="text-red-400" />
              colorClass = 'text-red-400 font-semibold'
            }

            const stepDuration = log.durationMs ? `(${(log.durationMs / 1000).toFixed(1)}s)` : ''

            return (
              <div key={log.id} className={`flex items-start justify-between gap-2 ${colorClass}`}>
                <div className="flex items-start gap-1.5 min-w-0">
                  <span className="shrink-0 mt-0.5">{icon}</span>
                  <span className="break-all">{log.message}</span>
                </div>
                {stepDuration && (
                  <span className="shrink-0 text-[9px] text-[var(--color-mute)] tabular-nums font-normal ml-2">
                    {stepDuration}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AIAgentSidebar({
  appId,
  appName,
  appDescription,
  appIcon,
  appVersion,
  frontendCode,
  backendCode,
  panelCode,
  onCodeProposed,
  onClose,
}: AIAgentSidebarProps) {
  // LLM state
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Agent State
  const [promptInput, setPromptInput] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [thoughtLogs, setThoughtLogs] = useState<ThoughtLog[]>([])
  const [agentRunning, setAgentRunning] = useState(false)

  const logsEndRef = useRef<HTMLDivElement>(null)

  // Load LLM Providers & AI Assistant Context on mount
  useEffect(() => {
    let active = true
    setLoadingProviders(true)

    const init = async () => {
      try {
        const providersRes = await window.api.listLlmProviders()
        if (!active) return

        let savedContext = { providerId: '', modelId: '', chatHistory: [] }
        if (appId) {
          savedContext = await window.api.getMiniAppAiAssistant(appId)
        }

        if (providersRes.success && providersRes.providers && providersRes.providers.length > 0) {
          if (!active) return
          setProviders(providersRes.providers)

          // Check if saved provider is valid
          const hasSavedProvider = providersRes.providers.some(
            (p: any) => p.id === savedContext.providerId,
          )
          if (hasSavedProvider) {
            setSelectedProviderId(savedContext.providerId)
            // Check if saved model is valid for this provider
            const provider = providersRes.providers.find(
              (p: any) => p.id === savedContext.providerId,
            )
            const hasSavedModel = provider?.models?.some((m: any) => m.id === savedContext.modelId)
            if (hasSavedModel) {
              setSelectedModelId(savedContext.modelId)
            } else if (provider?.models && provider.models.length > 0) {
              setSelectedModelId(provider.models[0].id)
            }
          } else {
            // Fallback to first provider
            setSelectedProviderId(providersRes.providers[0].id)
            if (providersRes.providers[0].models && providersRes.providers[0].models.length > 0) {
              setSelectedModelId(providersRes.providers[0].models[0].id)
            }
          }
        }
      } catch (err) {
        console.error('Failed to initialize AI assistant config:', err)
      } finally {
        if (active) setLoadingProviders(false)
      }
    }

    init()
    return () => {
      active = false
    }
  }, [appId])

  // Update selected model when provider changes
  const handleProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId)
    const provider = providers.find((p) => p.id === providerId)
    if (provider?.models && provider.models.length > 0) {
      setSelectedModelId(provider.models[0].id)
    } else {
      setSelectedModelId('')
    }
    setModelSearchQuery('')
    setIsModelDropdownOpen(false)
  }

  const currentProvider = providers.find((p) => p.id === selectedProviderId)
  const models = currentProvider?.models || []
  const filteredModels = models.filter((m) =>
    m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()),
  )

  // Close model dropdown when clicking outside (đóng dropdown khi click ra ngoài)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Autofocus the search input when dropdown opens (tự động focus vào ô tìm kiếm khi mở dropdown)
  useEffect(() => {
    if (isModelDropdownOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isModelDropdownOpen])

  // Auto-save AI Assistant context when model config changes
  useEffect(() => {
    if (appId && selectedProviderId && selectedModelId) {
      window.api
        .saveMiniAppAiAssistant(appId, {
          providerId: selectedProviderId,
          modelId: selectedModelId,
        })
        .catch((err: any) => {
          console.error('Failed to auto-save AI assistant context:', err)
        })
    }
  }, [appId, selectedProviderId, selectedModelId])

  const addThoughtLog = (type: ThoughtLog['type'], message: string) => {
    const now = Date.now()
    setThoughtLogs((prev) => {
      const next = [...prev]
      if (next.length > 0) {
        const lastLog = next[next.length - 1]
        lastLog.durationMs = now - lastLog.timestamp
      }
      next.push({
        id: `thought-${now}-${Math.random()}`,
        timestamp: now,
        type,
        message,
      })
      return next
    })
  }

  const streamRequestIdRef = useRef<string | null>(null)
  const [streamingText, setStreamingText] = useState('')

  // Tự động cuộn xuống cuối khi có tin nhắn mới hoặc log mới (Auto-scroll to bottom on new messages or logs)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on content change
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, thoughtLogs, streamingText, agentRunning])

  const runAgent = async () => {
    if (!promptInput.trim() || !selectedProviderId || !selectedModelId || agentRunning) return

    const userPrompt = promptInput.trim()
    setPromptInput('')
    setAgentRunning(true)
    onCodeProposed(null)
    setThoughtLogs([])
    setStreamingText('')

    // Update Chat history
    const newMessages: ChatMessage[] = [...chatHistory, { role: 'user', content: userPrompt }]
    setChatHistory(newMessages)

    const localLogs: ThoughtLog[] = []
    const startTime = Date.now()

    const logStep = (type: ThoughtLog['type'], message: string) => {
      const now = Date.now()
      if (localLogs.length > 0) {
        const last = localLogs[localLogs.length - 1]
        last.durationMs = now - last.timestamp
      }
      const newLog: ThoughtLog = {
        id: `thought-${now}-${Math.random()}`,
        timestamp: now,
        type,
        message,
      }
      localLogs.push(newLog)
      setThoughtLogs([...localLogs])
    }

    const finalizeLogs = (): { logs: ThoughtLog[]; durationMs: number } => {
      const now = Date.now()
      if (localLogs.length > 0) {
        const last = localLogs[localLogs.length - 1]
        last.durationMs = now - last.timestamp
      }
      const durationMs = now - startTime
      setThoughtLogs([...localLogs])
      return { logs: localLogs, durationMs }
    }

    try {
      // 1. Planner & Retriever (RAG)
      logStep('planner', 'Khởi chạy Tác nhân lập kế hoạch (Planner Agent)...')
      logStep('retriever', 'Đọc tài liệu + Thu thập mã nguồn hiện tại...')
      const guide = await window.api.getMiniAppGuide()
      logStep('retriever', '✅ Sẵn sàng! Đã thu thập đủ ngữ cảnh.')

      // Build 3-layer prompt architecture
      const codeContext: CodeContext = {
        appName,
        appDescription,
        appIcon,
        appVersion,
        frontendCode: frontendCode || '',
        backendCode: backendCode || '',
        panelCode: panelCode || '',
      }
      const taskType = detectTaskType(userPrompt, codeContext)
      logStep(
        'planner',
        `Phát hiện loại tác vụ: ${taskType === 'create' ? 'Tạo mới' : taskType === 'edit-small' ? 'Chỉnh sửa nhỏ' : taskType === 'edit-major' ? 'Chỉnh sửa lớn' : 'Sửa lỗi'}`,
      )

      // Layer 1: System Prompt (bất biến)
      const systemPrompt = buildSystemPrompt()

      // Layer 2: Developer Prompt (with state extraction from chat history)
      const developerPrompt = buildDeveloperPrompt(
        guide,
        codeContext,
        taskType,
        userPrompt,
        chatHistory.map((m) => ({ role: m.role, content: m.content })),
      )

      let attempts = 0
      const maxAttempts = 3
      let lastErrorAnalysis: ErrorAnalysis | null = null
      let currentResponseText = ''
      let parsedResult: ProposedCode | null = null

      while (attempts < maxAttempts) {
        attempts++
        logStep('llm', `⚡ Streaming mã nguồn từ LLM (Lần thử ${attempts}/${maxAttempts})...`)

        // Layer 3: User Prompt (dynamic — includes structured error analysis for retry)
        const userPromptContent = buildUserPrompt(
          userPrompt,
          codeContext,
          taskType,
          lastErrorAnalysis || undefined,
          attempts,
        )

        const agentMessages: ChatMessage[] = [
          {
            role: 'user',
            content: `${developerPrompt}\n\n${userPromptContent}`,
          },
        ]

        // If retry: send previous response + structured error analysis
        if (lastErrorAnalysis && currentResponseText) {
          agentMessages[0] = {
            role: 'user',
            content: developerPrompt,
          }
          agentMessages.push({
            role: 'assistant',
            content: currentResponseText,
          })
          agentMessages.push({
            role: 'user',
            content: userPromptContent,
          })
        }

        // ── Streaming LLM call ──
        currentResponseText = ''
        setStreamingText('')

        const streamResult = await window.api.callLlmCompletionStream({
          providerId: selectedProviderId,
          modelId: selectedModelId,
          systemPrompt,
          messages: agentMessages,
          temperature: 0.2,
        })

        if (!streamResult.success || !streamResult.requestId) {
          throw new Error(streamResult.error || 'Không thể khởi tạo streaming')
        }

        const requestId = streamResult.requestId
        streamRequestIdRef.current = requestId

        // Chờ stream hoàn tất bằng Promise + event listener
        const streamedText = await new Promise<string>((resolve, reject) => {
          let accumulated = ''

          const cleanup = window.api.onLlmStreamChunk(
            (chunk: {
              requestId: string
              type: 'token' | 'tool_call' | 'done' | 'error'
              token?: string
              toolCall?: { id: string; name: string; arguments: string }
              fullText?: string
              error?: string
            }) => {
              if (chunk.requestId !== requestId) return

              if (chunk.type === 'token' && chunk.token) {
                accumulated += chunk.token
                setStreamingText(accumulated)
              } else if (chunk.type === 'done') {
                cleanup()
                streamRequestIdRef.current = null
                resolve(chunk.fullText || accumulated)
              } else if (chunk.type === 'error') {
                cleanup()
                streamRequestIdRef.current = null
                reject(new Error(chunk.error || 'Stream error'))
              }
            },
          )
        })

        currentResponseText = streamedText
        setStreamingText('')
        logStep('editor', 'Bóc tách và xử lý kết quả sinh mã nguồn (XML Parser)...')

        // Parse response — XML format (primary) với JSON fallback
        const parsed = parseAgentResponse(currentResponseText)

        if (!parsed || (!parsed.frontendCode && !parsed.metadata.name)) {
          logStep('healing', '⚠️ Không thể bóc tách kết quả. Yêu cầu LLM sinh lại...')
          lastErrorAnalysis = {
            type: 'parse_failure',
            message: 'Output did not follow the required XML-tagged format.',
            rootCause:
              'LLM may have used markdown formatting or a non-XML structure instead of raw XML tags.',
            fixHint:
              'Return code inside XML tags directly: <frontend>...</frontend>, <backend>...</backend>, <panel>...</panel>, <metadata>...</metadata>. Do NOT use ``` code blocks inside the tags.',
          }
          continue
        }

        // Build ProposedCode từ parsed result
        const validatedIcon = validateIcon(parsed.metadata.icon)
        parsedResult = {
          thought: parsed.analysis,
          name: parsed.metadata.name || appName,
          description: parsed.metadata.description || appDescription,
          icon: validatedIcon,
          frontendCode: parsed.frontendCode || '',
          backendCode: parsed.backendCode || '',
          panelCode: parsed.panelCode || '',
        }

        // Validate Syntax, Banned Patterns, & API Surface
        logStep('validator', 'Tác nhân kiểm thử đang kiểm tra cú pháp, quy tắc, và API surface...')
        const validationError = runFullValidation(
          parsedResult.frontendCode || '',
          parsedResult.backendCode || '',
          parsedResult.panelCode || '',
        )

        if (validationError) {
          lastErrorAnalysis = analyzeValidationError(
            validationError,
            `${parsedResult.frontendCode}\n${parsedResult.backendCode}\n${parsedResult.panelCode}`,
          )
          logStep(
            'healing',
            `❌ ${validationError} [Root cause: ${lastErrorAnalysis.rootCause}] Khởi chạy vòng tự sửa lỗi...`,
          )
          continue
        }

        // Validate icon (đã validate ở trên, log nếu bị thay đổi)
        if (validatedIcon !== parsed.metadata.icon) {
          logStep(
            'healing',
            `⚠️ Icon "${parsed.metadata.icon}" không hợp lệ → tự động chuyển thành "${validatedIcon}".`,
          )
        }

        // Format code using Biome
        logStep('editor', 'Định dạng (format) mã nguồn bằng Biome...')
        const formatResults = await Promise.all([
          parsedResult.frontendCode
            ? window.api.formatCode(parsedResult.frontendCode)
            : { success: true, formatted: '' },
          parsedResult.backendCode
            ? window.api.formatCode(parsedResult.backendCode)
            : { success: true, formatted: '' },
          parsedResult.panelCode
            ? window.api.formatCode(parsedResult.panelCode)
            : { success: true, formatted: '' },
        ])
        if (formatResults[0].formatted) parsedResult.frontendCode = formatResults[0].formatted
        if (formatResults[1].formatted) parsedResult.backendCode = formatResults[1].formatted
        if (formatResults[2].formatted) parsedResult.panelCode = formatResults[2].formatted

        // All passed!
        break
      }

      if (!parsedResult || (lastErrorAnalysis && attempts >= maxAttempts)) {
        logStep(
          'error',
          '❌ Đã đạt giới hạn số lần sửa lỗi (3 lần). Không thể tự động khắc phục tất cả lỗi.',
        )
        const { logs, durationMs } = finalizeLogs()
        if (parsedResult) {
          onCodeProposed(parsedResult)

          const finalLogs = [...logs]
          const now = Date.now()
          if (finalLogs.length > 0) {
            finalLogs[finalLogs.length - 1].durationMs =
              now - finalLogs[finalLogs.length - 1].timestamp
          }
          finalLogs.push({
            id: `thought-${now}-${Math.random()}`,
            timestamp: now,
            type: 'planner',
            message: 'Đã gửi mã nguồn phiên bản lỗi cuối cùng ra Editor để đại ca kiểm tra.',
            durationMs: 0,
          })

          setChatHistory((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `Xin lỗi đại ca, tác nhân AI đã cố gắng tự sửa lỗi 3 lần nhưng vẫn còn lỗi:\n\n\`${lastErrorAnalysis?.message || 'Unknown error'}\`\n\n**Root cause:** ${lastErrorAnalysis?.rootCause || 'N/A'}\n\nTuy nhiên, tôi vẫn gửi mã nguồn đã sinh ra Editor để đại ca kiểm tra và chỉnh sửa nếu muốn.`,
              logs: finalLogs,
              durationMs: Date.now() - startTime,
            },
          ])
        } else {
          setChatHistory((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `Gặp lỗi khi tạo mã nguồn:\n\n\`${lastErrorAnalysis?.message || 'Unknown error'}\`\n\n**Root cause:** ${lastErrorAnalysis?.rootCause || 'N/A'}`,
              logs,
              durationMs,
            },
          ])
        }
      } else if (parsedResult) {
        logStep(
          'success',
          '✅ Tác nhân kiểm thử thành công! Không phát hiện lỗi cú pháp, quy tắc, hay API surface.',
        )
        const { logs, durationMs } = finalizeLogs()
        onCodeProposed(parsedResult)

        // Trích xuất suy nghĩ/kế hoạch để hiển thị trong chat
        const thoughtExplanation =
          parsedResult.thought ||
          'Tôi đã hoàn thành việc sinh mã nguồn theo yêu cầu của đại ca. Vui lòng xem so sánh và duyệt thay đổi trực tiếp trên khung soạn thảo chính.'
        setChatHistory((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: thoughtExplanation,
            logs,
            durationMs,
          },
        ])
      }
    } catch (err: any) {
      logStep('error', `❌ Gặp lỗi hệ thống: ${err.message || String(err)}`)
      const { logs, durationMs } = finalizeLogs()
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Đã xảy ra lỗi trong tiến trình của Agent: ${err.message || String(err)}`,
          logs,
          durationMs,
        },
      ])
    } finally {
      setAgentRunning(false)
      setStreamingText('')
      streamRequestIdRef.current = null
    }
  }

  // Cancel active stream
  const cancelAgent = () => {
    if (streamRequestIdRef.current) {
      window.api.cancelLlmStream(streamRequestIdRef.current)
      streamRequestIdRef.current = null
    }
    setAgentRunning(false)
    setStreamingText('')

    const now = Date.now()
    setThoughtLogs((prev) => {
      const next = [...prev]
      if (next.length > 0) {
        const last = next[next.length - 1]
        last.durationMs = now - last.timestamp
      }
      next.push({
        id: `thought-${now}-${Math.random()}`,
        timestamp: now,
        type: 'error',
        message: '⛔ Đã hủy tác vụ Agent theo yêu cầu.',
        durationMs: 0,
      })

      setChatHistory((chatPrev) => [
        ...chatPrev,
        {
          role: 'assistant',
          content: 'Tác vụ đã bị dừng theo yêu cầu của đại ca.',
          logs: next,
          durationMs: next.length > 0 ? now - next[0].timestamp : 0,
        },
      ])

      return next
    })
  }

  return (
    <div className="w-[400px] h-full border-l border-[var(--color-hairline)] bg-[#101010] flex flex-col overflow-hidden shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-hairline)] flex items-center justify-between shrink-0 bg-[#161616]">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-[var(--color-primary)] animate-pulse" />
          <span className="text-xs font-semibold text-[var(--color-ink)] uppercase tracking-[1.5px]">
            AI Assistant
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Reset cuộc trò chuyện"
            disabled={agentRunning}
            onClick={() => {
              setChatHistory([])
              setThoughtLogs([])
              setStreamingText('')
              onCodeProposed(null)
            }}
            className="p-1 rounded bg-transparent border-none text-[var(--color-mute)] hover:text-[var(--color-ink)] cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RotateCcw size={13} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded bg-transparent border-none text-[var(--color-mute)] hover:text-[var(--color-ink)] cursor-pointer transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* LLM Provider Selectors */}
      <div className="px-4 py-2 border-b border-[var(--color-hairline)] bg-[#121212] flex gap-2 shrink-0">
        <div className="flex-1">
          <select
            value={selectedProviderId}
            onChange={(e) => handleProviderChange(e.target.value)}
            disabled={loadingProviders || agentRunning}
            className="w-full h-8 px-2 text-[11px] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] text-[var(--color-ink)] outline-none cursor-pointer focus:border-[var(--color-primary)]"
          >
            {loadingProviders ? (
              <option>Đang tải cấu hình LLM...</option>
            ) : providers.length === 0 ? (
              <option>Chưa cấu hình LLM Provider</option>
            ) : (
              providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="flex-1 relative" ref={modelDropdownRef}>
          <button
            type="button"
            disabled={loadingProviders || agentRunning || !selectedProviderId}
            onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
            className="w-full h-8 px-2 flex items-center justify-between text-[11px] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] text-[var(--color-ink)] outline-none cursor-pointer focus:border-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed select-none"
          >
            <span className="truncate">
              {selectedProviderId
                ? providers
                    .find((p) => p.id === selectedProviderId)
                    ?.models.find((m) => m.id === selectedModelId)?.name || 'Chọn model...'
                : 'Chọn model...'}
            </span>
            <ChevronDown
              size={12}
              className={`text-[var(--color-mute)] shrink-0 transition-transform duration-200 ${
                isModelDropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isModelDropdownOpen && selectedProviderId && (
            <div className="absolute z-50 left-0 right-0 mt-1 bg-[#1a1a1a] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] shadow-xl flex flex-col max-h-60 overflow-hidden">
              {/* Ô tìm kiếm model */}
              <div className="p-1.5 border-b border-[var(--color-hairline)] flex items-center gap-1.5 bg-[#141414]">
                <Search size={10} className="text-[var(--color-mute)] shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={modelSearchQuery}
                  onChange={(e) => setModelSearchQuery(e.target.value)}
                  placeholder="Tìm kiếm model..."
                  className="w-full bg-transparent border-none text-[10px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-mute)]"
                />
              </div>

              {/* Danh sách model hiển thị */}
              <div className="flex-1 overflow-y-auto max-h-48 py-1 select-none">
                {filteredModels.length === 0 ? (
                  <div className="px-2 py-1.5 text-[10px] text-[var(--color-mute)] text-center">
                    Không tìm thấy model
                  </div>
                ) : (
                  filteredModels.map((m) => {
                    const isSelected = m.id === selectedModelId
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setSelectedModelId(m.id)
                          setIsModelDropdownOpen(false)
                          setModelSearchQuery('')
                        }}
                        className={`w-full px-2 py-1.5 text-left text-[10px] flex items-center justify-between transition-colors hover:bg-[#252525] cursor-pointer border-none text-[var(--color-ink)] ${
                          isSelected ? 'text-[var(--color-primary)] font-medium bg-[#1e1e1e]' : ''
                        }`}
                      >
                        <span className="truncate mr-2">{m.name}</span>
                        {isSelected && (
                          <Check size={10} className="text-[var(--color-primary)] shrink-0" />
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto bg-[#101010] min-h-0">
        <div className="p-4 flex flex-col gap-4">
          {chatHistory.length === 0 && !agentRunning ? (
            <div className="h-48 flex flex-col items-center justify-center text-center p-4">
              <Sparkles size={24} className="text-[var(--color-primary)]/55 mb-2" />
              <p className="text-xs text-[var(--color-mute)]">
                Nhập yêu cầu để bắt đầu thiết kế hoặc chỉnh sửa Mini App bằng AI Coding Agent.
              </p>
            </div>
          ) : (
            <>
              {chatHistory.map((msg, i) => (
                <div
                  key={`msg-${i}`}
                  className={`flex flex-col max-w-[85%] rounded-[var(--radius-md)] p-3 text-xs leading-relaxed border ${
                    msg.role === 'user'
                      ? 'bg-[var(--color-canvas-soft)] border-[var(--color-hairline)] self-end text-[var(--color-ink)]'
                      : 'bg-[#00d992]/5 border-[#00d992]/10 self-start text-[var(--color-ink)]'
                  }`}
                >
                  <span className="text-[9px] uppercase tracking-[1px] font-semibold mb-1 text-[var(--color-mute)]">
                    {msg.role === 'user' ? 'Đại ca' : 'AI Agent'}
                  </span>
                  {msg.role === 'assistant' && msg.logs && msg.logs.length > 0 && (
                    <AgentStepsSummary
                      logs={msg.logs}
                      durationMs={msg.durationMs}
                      isRunning={false}
                    />
                  )}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))}

              {/* Bong bóng Agent đang thực thi */}
              {agentRunning && (
                <div className="flex flex-col max-w-[85%] rounded-[var(--radius-md)] p-3 text-xs leading-relaxed border bg-[#00d992]/5 border-[#00d992]/10 self-start text-[var(--color-ink)]">
                  <span className="text-[9px] uppercase tracking-[1px] font-semibold mb-1 text-[var(--color-mute)]">
                    AI Agent
                  </span>

                  {/* Nhật ký hoạt động thời gian thực */}
                  <AgentStepsSummary logs={thoughtLogs} isRunning={true} />

                  {/* Streaming code preview */}
                  {streamingText && (
                    <div className="mt-2 p-3 rounded-[var(--radius-md)] bg-[#111] border border-[var(--color-hairline)]/50">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Loader2 size={10} className="text-[var(--color-primary)] animate-spin" />
                        <span className="text-[9px] uppercase tracking-[1px] font-semibold text-[var(--color-primary)]">
                          Đang sinh mã nguồn...
                        </span>
                        <span className="text-[9px] text-[var(--color-mute)] tabular-nums">
                          {streamingText.length.toLocaleString()} ký tự
                        </span>
                      </div>
                      <pre className="text-[10px] text-[var(--color-body)] whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto leading-relaxed font-mono">
                        {streamingText.slice(-300)}
                        <span className="inline-block w-[2px] h-[12px] bg-[var(--color-primary)] animate-pulse ml-px align-middle" />
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* Input panel at bottom */}
      <div className="p-3 border-t border-[var(--color-hairline)] bg-[#121212] shrink-0">
        <div className="flex gap-2">
          <textarea
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!agentRunning) runAgent()
              }
            }}
            placeholder={
              agentRunning ? 'AI Agent đang lập trình...' : 'Nhập yêu cầu tạo/sửa đổi app...'
            }
            disabled={agentRunning || loadingProviders}
            className="flex-1 h-20 px-3 py-2 text-xs bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-mute)] focus:border-[var(--color-primary)] disabled:opacity-50 resize-none"
          />
          {agentRunning ? (
            <button
              type="button"
              onClick={cancelAgent}
              className="w-9 h-9 flex items-center justify-center bg-red-500/80 border-none text-white rounded-[var(--radius-sm)] cursor-pointer hover:bg-red-500 active:scale-[0.97] transition-all"
              title="Hủy tác vụ"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={runAgent}
              disabled={loadingProviders || !promptInput.trim()}
              className="w-9 h-9 flex items-center justify-center bg-[var(--color-primary)] border-none text-[var(--color-on-primary)] rounded-[var(--radius-sm)] cursor-pointer hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
