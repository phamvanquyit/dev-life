import {
  ApiOutlined,
  CaretRightOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  LoadingOutlined,
  RocketOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { Button, message, Tooltip } from 'antd'
import { useCallback, useRef, useState } from 'react'

const BASE_URL = 'http://127.0.0.1:18981'

interface ApiEndpoint {
  id: string
  method: 'GET' | 'POST'
  label: string
  path: string
  description: string
  bodyTemplate?: string
  pathParams?: { key: string; placeholder: string }[]
  queryParams?: { key: string; placeholder: string; defaultValue?: string }[]
}

const ENDPOINTS: ApiEndpoint[] = [
  {
    id: 'list-projects',
    method: 'GET',
    label: 'List Projects',
    path: '/antigravity/projects',
    description: 'List all projects with their conversations',
  },
  {
    id: 'get-transcript',
    method: 'GET',
    label: 'Get Transcript',
    path: '/antigravity/conversations/:id/transcript',
    description: 'Get chat history of a conversation',
    pathParams: [{ key: 'id', placeholder: 'conversation-uuid' }],
    queryParams: [
      { key: 'maxSteps', placeholder: '100', defaultValue: '100' },
      { key: 'onlyChat', placeholder: 'true', defaultValue: 'true' },
    ],
  },
  {
    id: 'send-message',
    method: 'POST',
    label: 'Send Message',
    path: '/antigravity/conversations/:id/message',
    description: 'Send a message to an existing conversation',
    pathParams: [{ key: 'id', placeholder: 'conversation-uuid' }],
    bodyTemplate: JSON.stringify({ content: 'Your message here' }, null, 2),
  },
  {
    id: 'new-conversation',
    method: 'POST',
    label: 'New Conversation',
    path: '/antigravity/projects/:projectId/message',
    description: 'Create a new conversation in a project',
    pathParams: [{ key: 'projectId', placeholder: 'project-section-id' }],
    bodyTemplate: JSON.stringify(
      { content: 'Your message here', model: 'gemini-2.5-pro' },
      null,
      2,
    ),
  },
]

interface ResponseData {
  status: number
  statusText: string
  duration: number
  body: string
  size: number
}

export default function AntigravityManager() {
  const [selectedId, setSelectedId] = useState<string>(ENDPOINTS[0].id)
  const [pathParams, setPathParams] = useState<Record<string, Record<string, string>>>({})
  const [queryParams, setQueryParams] = useState<Record<string, Record<string, string>>>({})
  const [bodies, setBodies] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const ep of ENDPOINTS) {
      if (ep.bodyTemplate) init[ep.id] = ep.bodyTemplate
    }
    return init
  })
  const [response, setResponse] = useState<ResponseData | null>(null)
  const [loading, setLoading] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()
  const responseRef = useRef<HTMLPreElement>(null)

  const selected = ENDPOINTS.find((e) => e.id === selectedId)!

  const getResolvedUrl = useCallback(() => {
    let url = selected.path
    if (selected.pathParams) {
      for (const p of selected.pathParams) {
        const val = pathParams[selected.id]?.[p.key] || `:${p.key}`
        url = url.replace(`:${p.key}`, encodeURIComponent(val))
      }
    }
    if (selected.queryParams) {
      const params = new URLSearchParams()
      for (const q of selected.queryParams) {
        const val = queryParams[selected.id]?.[q.key] ?? q.defaultValue
        if (val) params.set(q.key, val)
      }
      const qs = params.toString()
      if (qs) url += `?${qs}`
    }
    return `${BASE_URL}${url}`
  }, [selected, pathParams, queryParams])

  const handleSend = async () => {
    setLoading(true)
    setResponse(null)
    const url = getResolvedUrl()
    const startTime = performance.now()

    try {
      const fetchOptions: RequestInit = {
        method: selected.method,
        headers: { 'Content-Type': 'application/json' },
      }
      if (selected.method === 'POST' && bodies[selected.id]) {
        fetchOptions.body = bodies[selected.id]
      }

      const res = await fetch(url, fetchOptions)
      const text = await res.text()
      const duration = Math.round(performance.now() - startTime)

      let formattedBody = text
      try {
        formattedBody = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        // keep raw
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        duration,
        body: formattedBody,
        size: new Blob([text]).size,
      })
    } catch (err: any) {
      const duration = Math.round(performance.now() - startTime)
      setResponse({
        status: 0,
        statusText: 'Network Error',
        duration,
        body: `Error: ${err.message}\n\nMake sure Dev Life proxy is running on ${BASE_URL}`,
        size: 0,
      })
    }
    setLoading(false)
  }

  const handleCopyResponse = () => {
    if (response?.body) {
      navigator.clipboard.writeText(response.body)
      messageApi.success('Copied to clipboard')
    }
  }

  const handleCopyCurl = () => {
    const url = getResolvedUrl()
    let cmd = 'curl'
    if (selected.method === 'POST') cmd += ' -X POST'
    cmd += ` '${url}'`
    if (selected.method === 'POST' && bodies[selected.id]) {
      const body = bodies[selected.id].replace(/'/g, "'\\''")
      cmd += ` \\\n  -H 'Content-Type: application/json' \\\n  -d '${body}'`
    }
    navigator.clipboard.writeText(cmd)
    messageApi.success('cURL copied')
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  const isSuccess = response && response.status >= 200 && response.status < 300

  return (
    <div className="flex h-full overflow-hidden -m-6">
      {contextHolder}

      {/* Sidebar */}
      <div className="w-[280px] min-w-[280px] flex flex-col border-r border-[var(--color-hairline)] bg-[var(--color-canvas)]">
        <div className="flex items-center gap-2 px-4 py-3.5 text-sm font-semibold text-[var(--color-ink)] border-b border-[var(--color-hairline)]">
          <RocketOutlined className="text-[var(--color-primary)]" />
          <span>Antigravity API</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {ENDPOINTS.map((ep) => (
            <div
              key={ep.id}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-all duration-150 border ${
                selectedId === ep.id
                  ? 'bg-[rgba(0,217,146,0.12)] border-[rgba(0,217,146,0.2)]'
                  : 'border-transparent hover:bg-white/[0.04]'
              }`}
              onClick={() => {
                setSelectedId(ep.id)
                setResponse(null)
              }}
            >
              <span
                className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded shrink-0 tracking-wide uppercase ${
                  ep.method === 'GET'
                    ? 'bg-[rgba(97,175,254,0.15)] text-[#61affe]'
                    : 'bg-[rgba(73,204,144,0.15)] text-[#49cc90]'
                }`}
              >
                {ep.method}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[var(--color-ink)] truncate">
                  {ep.label}
                </div>
                <div className="text-[11px] font-mono text-[var(--color-mute)] mt-0.5 truncate">
                  {ep.path}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-canvas)]">
        {/* URL Bar */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--color-hairline)] bg-[var(--color-canvas-soft)]">
          <span
            className={`text-xs font-bold font-mono px-3.5 py-1.5 rounded-md tracking-wider ${
              selected.method === 'GET'
                ? 'bg-[rgba(97,175,254,0.15)] text-[#61affe] border border-[rgba(97,175,254,0.3)]'
                : 'bg-[rgba(73,204,144,0.15)] text-[#49cc90] border border-[rgba(73,204,144,0.3)]'
            }`}
          >
            {selected.method}
          </span>
          <div className="flex-1 font-mono text-[13px] text-[var(--color-ink)] truncate px-3 py-1.5 bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-md">
            {getResolvedUrl()}
          </div>
          <Tooltip title="Copy cURL">
            <Button
              type="text"
              icon={<CopyOutlined />}
              onClick={handleCopyCurl}
              size="small"
              className="!text-[var(--color-mute)]"
            />
          </Tooltip>
          <Button
            type="primary"
            icon={loading ? <LoadingOutlined /> : <SendOutlined />}
            onClick={handleSend}
            disabled={loading}
            className="h-9 min-w-[90px] font-semibold"
            style={{ boxShadow: '0 0 12px rgba(0,217,146,0.2)' }}
          >
            Send
          </Button>
        </div>

        {/* Description */}
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-[var(--color-body)] border-b border-[var(--color-hairline)]">
          <ApiOutlined className="text-[var(--color-primary)]" />
          <span>{selected.description}</span>
        </div>

        {/* Params + Body */}
        <div className="px-4 overflow-y-auto max-h-[260px]">
          {/* Path Params */}
          {selected.pathParams && selected.pathParams.length > 0 && (
            <div className="py-3 border-b border-[var(--color-hairline)]/50">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mute)] mb-2.5">
                Path Parameters
              </div>
              {selected.pathParams.map((p) => (
                <div key={p.key} className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-mono font-semibold text-[var(--color-primary-soft)] min-w-[100px] shrink-0">
                    {p.key}
                  </span>
                  <input
                    value={pathParams[selected.id]?.[p.key] || ''}
                    onChange={(e) =>
                      setPathParams((prev) => ({
                        ...prev,
                        [selected.id]: { ...prev[selected.id], [p.key]: e.target.value },
                      }))
                    }
                    placeholder={p.placeholder}
                    className="flex-1 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-md px-3 py-1.5 text-xs font-mono text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)] transition-colors placeholder:text-[var(--color-mute)]/50"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Query Params */}
          {selected.queryParams && selected.queryParams.length > 0 && (
            <div className="py-3 border-b border-[var(--color-hairline)]/50">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mute)] mb-2.5">
                Query Parameters
              </div>
              {selected.queryParams.map((q) => (
                <div key={q.key} className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-mono font-semibold text-[var(--color-primary-soft)] min-w-[100px] shrink-0">
                    {q.key}
                  </span>
                  <input
                    value={queryParams[selected.id]?.[q.key] ?? q.defaultValue ?? ''}
                    onChange={(e) =>
                      setQueryParams((prev) => ({
                        ...prev,
                        [selected.id]: { ...prev[selected.id], [q.key]: e.target.value },
                      }))
                    }
                    placeholder={q.placeholder}
                    className="flex-1 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-md px-3 py-1.5 text-xs font-mono text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)] transition-colors placeholder:text-[var(--color-mute)]/50"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Request Body */}
          {selected.method === 'POST' && (
            <div className="py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-mute)] mb-2.5">
                Request Body
              </div>
              <textarea
                value={bodies[selected.id] || ''}
                onChange={(e) => setBodies((prev) => ({ ...prev, [selected.id]: e.target.value }))}
                rows={6}
                spellCheck={false}
                className="w-full bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-md px-3 py-2.5 text-xs font-mono text-[var(--color-ink)] leading-relaxed outline-none focus:border-[var(--color-primary)] transition-colors resize-y placeholder:text-[var(--color-mute)]/50"
              />
            </div>
          )}
        </div>

        {/* Response */}
        <div className="flex-1 flex flex-col min-h-0 border-t border-[var(--color-hairline)]">
          {/* Response Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-hairline)] bg-[var(--color-canvas-soft)]">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-mute)]">
              Response
            </span>
            {response && (
              <div className="flex items-center gap-3">
                <span
                  className={`flex items-center gap-1.5 text-xs font-semibold font-mono px-2.5 py-0.5 rounded ${
                    isSuccess
                      ? 'bg-[rgba(0,217,146,0.12)] text-[var(--color-primary)]'
                      : 'bg-[rgba(255,107,107,0.12)] text-[var(--color-error)]'
                  }`}
                >
                  {isSuccess ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                  {response.status > 0
                    ? `${response.status} ${response.statusText}`
                    : response.statusText}
                </span>
                <span className="text-[11px] font-mono text-[var(--color-mute)]">
                  {response.duration}ms
                </span>
                {response.size > 0 && (
                  <span className="text-[11px] font-mono text-[var(--color-mute)]">
                    {formatBytes(response.size)}
                  </span>
                )}
                <Tooltip title="Copy response">
                  <Button
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={handleCopyResponse}
                    size="small"
                    className="!text-[var(--color-mute)]"
                  />
                </Tooltip>
              </div>
            )}
          </div>

          {/* Response Body */}
          <div className="flex-1 overflow-y-auto bg-[var(--color-canvas)]">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 text-sm text-[var(--color-primary)]">
                <LoadingOutlined className="text-2xl" />
                <span>Sending request...</span>
              </div>
            ) : response ? (
              <pre
                ref={responseRef}
                className="m-0 p-4 font-mono text-xs leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap break-all"
              >
                {response.body}
              </pre>
            ) : (
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 text-sm text-[var(--color-mute)]">
                <CaretRightOutlined className="text-3xl text-[var(--color-primary)] opacity-40" />
                <span>
                  Click <strong>Send</strong> to make a request
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
