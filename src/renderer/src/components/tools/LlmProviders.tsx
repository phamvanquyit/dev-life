import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../ui/Badge'
import { confirm } from '../ui/ConfirmDialog'
import { Select } from '../ui/Select'
import { toast } from '../ui/Toast'
import { Tooltip } from '../ui/Tooltip'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ModelInfo {
  id: string
  name: string
}

interface LlmProvider {
  id: string
  name: string
  provider: string
  apiKey: string
  endpoint: string | null
  models: ModelInfo[]
  createdAt: string
}

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom', label: 'Custom' },
]

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
  custom: 'Custom',
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10b981',
  anthropic: '#f59e0b',
  google: '#3b82f6',
  openrouter: '#8b5cf6',
  custom: '#8b949e',
}

// ─── Provider Card ───────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  onDelete,
}: {
  provider: LlmProvider
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const color = PROVIDER_COLORS[provider.provider] || PROVIDER_COLORS.custom

  const filteredModels = modelSearch
    ? provider.models.filter(
        (m) =>
          m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
          m.name.toLowerCase().includes(modelSearch.toLowerCase()),
      )
    : provider.models

  return (
    <div className="border border-[var(--color-hairline)] rounded-lg bg-[var(--color-canvas)] transition-all duration-200 hover:border-[var(--color-border-hover)]">
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}15`, border: `1px solid ${color}30` }}
        >
          <Brain size={16} style={{ color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-ink)] truncate">
              {provider.name}
            </span>
            <Badge
              className="!text-[10px] !m-0 !border-0 !leading-tight !px-1.5 !py-0"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {PROVIDER_LABELS[provider.provider] || provider.provider}
            </Badge>
          </div>
          <p className="text-[11px] text-[var(--color-mute)] mt-0.5">
            {provider.models.length} models • Key: {provider.apiKey}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Tooltip title="Delete provider">
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-md bg-transparent border-none cursor-pointer text-[var(--color-mute)] transition-colors hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
              onClick={(e) => {
                e.stopPropagation()
                confirm({
                  title: 'Delete Provider',
                  content: `Are you sure you want to delete "${provider.name}"?`,
                  okText: 'Delete',
                  okButtonProps: { danger: true },
                  onOk: () => onDelete(provider.id),
                })
              }}
            >
              <Trash2 size={14} />
            </button>
          </Tooltip>
          <span className="text-[var(--color-mute)]">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </div>
      </div>

      {/* Expanded: Model List */}
      {expanded && (
        <div className="border-t border-[var(--color-hairline)] px-4 py-3">
          {provider.endpoint && (
            <div className="flex items-center gap-1.5 mb-2.5">
              <span className="text-[10px] text-[var(--color-mute)]">Endpoint:</span>
              <code className="text-[11px] font-[var(--font-mono)] text-[var(--color-primary)] bg-[var(--color-canvas-soft)] px-1.5 py-0.5 rounded border border-[var(--color-hairline)]">
                {provider.endpoint}
              </code>
            </div>
          )}
          {/* Search */}
          <div className="relative mb-2">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-mute)]"
            />
            <input
              type="text"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full h-7 pl-8 pr-3 text-[11px] bg-[var(--color-canvas)] text-[var(--color-ink)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] outline-none transition-colors placeholder:text-[var(--color-mute)] focus:border-[var(--color-primary)]"
            />
          </div>
          {/* Count */}
          <div className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-mute)] mb-1.5">
            {modelSearch
              ? `${filteredModels.length} / ${provider.models.length} models`
              : `${provider.models.length} models`}
          </div>
          {/* List */}
          <div className="max-h-52 overflow-y-auto">
            {filteredModels.length === 0 ? (
              <div className="py-3 text-center text-[11px] text-[var(--color-mute)]">
                No models match "{modelSearch}"
              </div>
            ) : (
              <div className="flex flex-col">
                {filteredModels.map((model) => (
                  <div
                    key={model.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors hover:bg-[var(--color-bg-hover)] group"
                  >
                    <span className="w-1 h-1 rounded-full bg-[var(--color-mute)] shrink-0 group-hover:bg-[var(--color-primary)]" />
                    <span className="text-[12px] font-[var(--font-mono)] text-[var(--color-body)] truncate group-hover:text-[var(--color-ink)]">
                      {model.id}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Add Provider Form ───────────────────────────────────────────────────────

function AddProviderForm({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<string>('openai')
  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setError(null)
    setSaving(true)

    try {
      const res = await window.api?.addLlmProvider({
        name,
        provider,
        apiKey,
        endpoint: endpoint || undefined,
      })

      if (res?.success) {
        toast.success(`Added "${name}" with ${res.modelsCount} models`)
        onSuccess()
      } else {
        setError(res?.error || 'Failed to add provider')
      }
    } catch (err: any) {
      setError(err.message || 'Unexpected error')
    } finally {
      setSaving(false)
    }
  }

  const isValid =
    name.trim() && provider && apiKey.trim() && (provider !== 'custom' || endpoint.trim())

  return (
    <div className="border border-[var(--color-primary)]/30 rounded-lg bg-[var(--color-canvas-soft)] overflow-hidden">
      {/* Form Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-hairline)]">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-[var(--color-primary)]" />
          <span className="text-sm font-semibold text-[var(--color-ink)]">Add LLM Provider</span>
        </div>
        <button
          type="button"
          className="w-6 h-6 flex items-center justify-center rounded bg-transparent border-none cursor-pointer text-[var(--color-mute)] transition-colors hover:text-[var(--color-ink)]"
          onClick={onCancel}
        >
          <X size={14} />
        </button>
      </div>

      {/* Form Body */}
      <div className="p-4 flex flex-col gap-4">
        {/* Name */}
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-[1.5px] text-[var(--color-mute)] mb-1.5">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My OpenAI Account"
            className="w-full h-9 px-3 text-sm bg-[var(--color-canvas)] text-[var(--color-ink)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] outline-none transition-colors placeholder:text-[var(--color-mute)] focus:border-[var(--color-primary)]"
          />
        </label>

        {/* Provider */}
        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-[1.5px] text-[var(--color-mute)] mb-1.5">
            Provider
          </span>
          <Select
            value={provider}
            onChange={setProvider}
            options={PROVIDER_OPTIONS}
            className="w-full"
            size="middle"
          />
        </div>

        {/* API Key */}
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-[1.5px] text-[var(--color-mute)] mb-1.5">
            API Key
          </span>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full h-9 px-3 pr-9 text-sm font-[var(--font-mono)] bg-[var(--color-canvas)] text-[var(--color-ink)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] outline-none transition-colors placeholder:text-[var(--color-mute)] focus:border-[var(--color-primary)]"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-[var(--color-mute)] transition-colors hover:text-[var(--color-ink)]"
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>

        {/* Custom Endpoint */}
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-[1.5px] text-[var(--color-mute)] mb-1.5">
            Custom Endpoint
            {provider !== 'custom' && (
              <span className="text-[var(--color-mute)] font-normal normal-case tracking-normal ml-1">
                (optional — override default)
              </span>
            )}
          </span>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={
              provider === 'custom' ? 'https://your-api.com/v1' : 'Leave empty for default'
            }
            className="w-full h-9 px-3 text-sm font-[var(--font-mono)] bg-[var(--color-canvas)] text-[var(--color-ink)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] outline-none transition-colors placeholder:text-[var(--color-mute)] focus:border-[var(--color-primary)]"
          />
        </label>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-[var(--color-error)]/10 border border-[var(--color-error)]/20">
            <AlertCircle size={14} className="text-[var(--color-error)] shrink-0 mt-0.5" />
            <span className="text-xs text-[var(--color-error)] leading-relaxed">{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            className="h-8 px-4 text-[13px] font-medium rounded-[var(--radius-sm)] bg-transparent border border-[var(--color-hairline)] text-[var(--color-body)] cursor-pointer transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-ink)]"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="h-8 px-4 text-[13px] font-semibold rounded-[var(--radius-sm)] border-none cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90"
            onClick={handleSave}
            disabled={!isValid || saving}
          >
            {saving ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={14} className="animate-spin" />
                Validating...
              </span>
            ) : (
              'Save & Validate'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function LlmProviders() {
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadProviders = useCallback(async () => {
    try {
      const res = await window.api?.listLlmProviders()
      if (res?.success) {
        setProviders(res.providers || [])
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  const handleDelete = async (id: string) => {
    const res = await window.api?.deleteLlmProvider(id)
    if (res?.success) {
      toast.success('Provider deleted')
      loadProviders()
    } else {
      toast.error(res?.error || 'Failed to delete')
    }
  }

  return (
    <div>
      {/* Section header with add button */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 flex items-center justify-center">
            <Brain size={18} className="text-[var(--color-primary)]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-ink)] leading-tight">
              LLM Providers
            </h3>
            <p className="text-xs text-[var(--color-mute)]">
              Manage API keys and endpoints for AI models
            </p>
          </div>
        </div>

        {!showForm && (
          <button
            type="button"
            className="h-8 px-3 flex items-center gap-1.5 text-[13px] font-semibold rounded-[var(--radius-sm)] border-none cursor-pointer transition-all bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90"
            onClick={() => setShowForm(true)}
          >
            <Plus size={14} />
            Add Provider
          </button>
        )}
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="mb-5">
          <AddProviderForm
            onCancel={() => setShowForm(false)}
            onSuccess={() => {
              setShowForm(false)
              loadProviders()
            }}
          />
        </div>
      )}

      {/* Providers List */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-[var(--color-mute)]">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : providers.length === 0 && !showForm ? (
        <div className="border border-dashed border-[var(--color-hairline)] rounded-lg p-8 text-center">
          <Brain size={32} className="text-[var(--color-mute)] mx-auto mb-3 opacity-40" />
          <p className="text-sm text-[var(--color-body)] mb-1">No providers configured</p>
          <p className="text-xs text-[var(--color-mute)]">
            Add an LLM provider to start using AI models in your apps
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
