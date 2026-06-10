import { message, Popconfirm } from 'antd'
import { Check, Clock, Copy, Globe, Trash2, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSlideDown } from '../../hooks/useAnimations'
import { usePasswordStore } from '../../stores/password'

function getStrength(pw: string): { label: string; color: string; percent: number } {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (pw.length >= 16) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^a-zA-Z\d]/.test(pw)) score++

  if (score <= 2) return { label: 'Weak', color: '#ff6b6b', percent: 25 }
  if (score <= 3) return { label: 'Fair', color: '#fdcb6e', percent: 50 }
  if (score <= 4) return { label: 'Strong', color: '#00b894', percent: 75 }
  return { label: 'Very Strong', color: '#00cec9', percent: 100 }
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function TrayPasswordGenerator() {
  const {
    length,
    options,
    currentPassword,
    browserInfo,
    detecting,
    history,
    showHistory,
    setLength,
    toggleOption,
    generate,
    copyPassword,
    toggleHistory,
    deleteHistoryEntry,
    clearHistory,
  } = usePasswordStore()

  const [copied, setCopied] = useState(false)
  const historyRef = useSlideDown(showHistory)

  // Generate on first mount
  useEffect(() => {
    if (!currentPassword) {
      generate()
    }
  }, [generate, currentPassword])

  const handleGenerate = async () => {
    await generate()
  }

  const handleCopy = (pw: string) => {
    copyPassword(pw)
    setCopied(true)
    message.success({ content: 'Copied!', duration: 1 })
    setTimeout(() => setCopied(false), 1500)
  }

  const strength = currentPassword ? getStrength(currentPassword) : null

  return (
    <div className="tray-tool flex flex-col gap-2.5">
      {/* Website detection badge */}
      {browserInfo && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-linear-to-br from-[rgba(0,217,146,0.08)] to-[rgba(0,206,201,0.05)] border border-[rgba(0,217,146,0.2)]">
          <Globe size={11} className="text-[var(--color-primary)] shrink-0" />
          <span className="text-[11px] font-semibold text-[var(--color-ink)] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {browserInfo.domain}
          </span>
          <span className="text-[9px] text-[var(--color-mute)] shrink-0">
            {browserInfo.browser}
          </span>
        </div>
      )}

      {/* Input + Copy row */}
      <div className="flex gap-1.5 items-stretch">
        <div className="flex-1 relative flex items-center">
          <input
            className="w-full h-9 pr-8 pl-2.5 font-[var(--font-mono)] text-xs tracking-wide text-[var(--color-ink)] bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-lg outline-none transition-all duration-150 hover:border-[var(--color-primary)] focus:border-[var(--color-primary)] focus:shadow-[0_0_0_2px_rgba(0,217,146,0.1)]"
            type="text"
            value={currentPassword}
            readOnly
          />
          <button
            type="button"
            className={`absolute right-1.5 w-6 h-6 flex items-center justify-center bg-transparent border-none cursor-pointer rounded transition-all duration-150 text-xs hover:text-[var(--color-primary)] hover:bg-[rgba(0,217,146,0.1)] ${detecting ? 'opacity-70 cursor-wait' : 'text-[var(--color-mute)]'}`}
            onClick={(e) => {
              e.stopPropagation()
              handleGenerate()
            }}
            disabled={detecting}
            title="Generate"
          >
            <Zap size={14} className={detecting ? 'animate-spin' : ''} />
          </button>
        </div>
        <button
          type="button"
          className={`w-9 h-9 shrink-0 flex items-center justify-center border-none rounded-lg cursor-pointer text-sm transition-all duration-150 active:scale-95 ${copied ? 'bg-[var(--color-primary)] text-[#0a0a0a]' : 'bg-[var(--color-primary)] text-[#0a0a0a]'} hover:bg-[#00f0a8] hover:shadow-[0_0_12px_rgba(0,217,146,0.3)]`}
          onClick={() => currentPassword && handleCopy(currentPassword)}
          title="Copy"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>

      {/* Strength indicator */}
      {strength && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-[3px] bg-[var(--color-hairline)] rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm transition-all duration-300"
              style={{ width: `${strength.percent}%`, background: strength.color }}
            />
          </div>
          <span
            className="text-[9px] font-semibold shrink-0 tracking-wide"
            style={{ color: strength.color }}
          >
            {strength.label}
          </span>
        </div>
      )}

      {/* Length control */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--color-mute)] font-medium uppercase tracking-wider shrink-0 w-[38px]">
          Length
        </span>
        <input
          type="range"
          className="flex-1 h-[3px] appearance-none bg-[var(--color-hairline)] rounded-sm outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-primary)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-canvas)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-[0_0_4px_rgba(0,217,146,0.3)] hover:[&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,217,146,0.5)]"
          min={4}
          max={64}
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
        />
        <span className="text-xs font-bold text-[var(--color-primary)] font-[var(--font-mono)] w-[22px] text-right shrink-0">
          {length}
        </span>
      </div>

      {/* Charset checkboxes */}
      <div className="flex gap-1.5">
        {[
          { key: 'uppercase' as const, label: 'ABC' },
          { key: 'lowercase' as const, label: 'abc' },
          { key: 'numbers' as const, label: '123' },
          { key: 'symbols' as const, label: '#$&' },
        ].map(({ key, label }) => (
          <label
            key={key}
            className={`flex-1 flex items-center gap-[5px] py-1.5 px-2 rounded-md cursor-pointer transition-all duration-150 select-none border ${
              options[key]
                ? 'border-[rgba(0,217,146,0.3)] bg-[rgba(0,217,146,0.06)]'
                : 'border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] hover:border-[rgba(255,255,255,0.15)]'
            }`}
          >
            <input
              type="checkbox"
              checked={options[key]}
              onChange={() => toggleOption(key)}
              className="hidden"
            />
            <span
              className={`w-3.5 h-3.5 rounded-[3px] flex items-center justify-center text-[8px] text-[#0a0a0a] shrink-0 transition-all duration-150 ${
                options[key] ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-hairline)]'
              }`}
            >
              {options[key] && <Check size={8} />}
            </span>
            <span className="text-[10px] font-[var(--font-mono)] text-[var(--color-body)] font-medium">
              {label}
            </span>
          </label>
        ))}
      </div>

      {/* History toggle */}
      <button
        type="button"
        className="flex items-center gap-1.5 py-[7px] px-2.5 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-lg text-[var(--color-mute)] text-[11px] cursor-pointer transition-all duration-150 w-full text-left hover:border-[rgba(255,255,255,0.15)] hover:text-[var(--color-body)]"
        onClick={toggleHistory}
      >
        <Clock size={12} />
        <span>History</span>
        <span
          className={`ml-auto text-sm transition-transform duration-200 ${showHistory ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </button>

      {/* History list */}
      {showHistory && (
        <div ref={historyRef} className="flex flex-col gap-1.5">
          {history.length > 0 && (
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] text-[var(--color-mute)]">{history.length} entries</span>
              <Popconfirm
                title="Clear all history?"
                onConfirm={clearHistory}
                okText="Clear"
                cancelText="Cancel"
                placement="left"
              >
                <button
                  type="button"
                  className="text-[10px] text-[var(--color-error)] bg-transparent border-none cursor-pointer py-0.5 px-1.5 rounded transition-all duration-150 hover:bg-[rgba(255,107,107,0.1)]"
                >
                  Clear all
                </button>
              </Popconfirm>
            </div>
          )}
          <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--color-hairline)] [&::-webkit-scrollbar-thumb]:rounded-sm">
            {history.length === 0 ? (
              <div className="text-center py-4 text-[11px] text-[var(--color-mute)]">
                No history yet
              </div>
            ) : (
              history.map((entry) => (
                <div
                  key={entry.id}
                  className="group py-[7px] px-2.5 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-md transition-all duration-150 hover:border-[rgba(255,255,255,0.12)]"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="flex-1 font-[var(--font-mono)] text-[10px] text-[var(--color-ink)] overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer tracking-[0.2px] hover:text-[var(--color-primary)]"
                      onClick={() => handleCopy(entry.password)}
                      title="Click to copy"
                    >
                      {entry.password}
                    </span>
                    <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <Copy
                        size={10}
                        className="text-[var(--color-mute)] cursor-pointer p-[3px] rounded-[3px] transition-all duration-150 hover:text-[var(--color-primary)] hover:bg-[rgba(0,217,146,0.1)]"
                        onClick={() => handleCopy(entry.password)}
                      />
                      <Trash2
                        size={10}
                        className="text-[var(--color-mute)] cursor-pointer p-[3px] rounded-[3px] transition-all duration-150 hover:text-[var(--color-error)] hover:bg-[rgba(255,107,107,0.1)]"
                        onClick={() => deleteHistoryEntry(entry.id)}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {entry.domain && (
                      <span className="text-[9px] text-[rgba(0,217,146,0.7)] flex items-center gap-[3px] overflow-hidden text-ellipsis whitespace-nowrap">
                        <Globe size={9} /> {entry.domain}
                      </span>
                    )}
                    <span className="text-[9px] text-[var(--color-mute)] ml-auto shrink-0">
                      {timeAgo(entry.createdAt)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
