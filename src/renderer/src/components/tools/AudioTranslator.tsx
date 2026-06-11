import { Button, Tooltip } from 'antd'
import gsap from 'gsap'
import { Eraser, Loader2, Mic, PauseCircle, PlayCircle, Settings, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBtnGlow, useRecordingPulse, useSlideDown } from '../../hooks/useAnimations'

// ────────────────────────────────────────────────────────────────────────────
// Types & Constants
// ────────────────────────────────────────────────────────────────────────────
interface TranscriptEntry {
  id: string
  timestamp: string
  english: string
  vietnamese: string
  status: 'processing' | 'done' | 'error'
  error?: string
}

type AudioMode = 'mic' | 'system'
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// VAD thresholds
const SILENCE_THRESHOLD = 12 // 0-255 average frequency; below = silence
const SILENCE_CUTOFF_MS = 1500 // 1.5s silence → end chunk
const MAX_CHUNK_MS = 15000 // force-split at 15s
const MIN_CHUNK_MS = 600 // ignore chunks shorter than 600ms
const MAX_TRANSCRIPT_ENTRIES = 300 // auto-trim entries to prevent memory growth

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function getSupportedMimeType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return 'audio/webm'
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function float32ToInt16(float32Array: Float32Array): ArrayBuffer {
  const int16 = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16.buffer
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ── Sub-component for animated transcript entries ────────────────────────
function TranscriptEntryItem({ entry, variant }: { entry: TranscriptEntry; variant: 'en' | 'vi' }) {
  const ref = useRef<HTMLDivElement>(null)

  // Slide-in animation on mount
  useEffect(() => {
    if (!ref.current) return
    gsap.fromTo(
      ref.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(1.7)' },
    )
  }, [])

  // Loading pulse for processing entries
  useEffect(() => {
    if (!ref.current || entry.status !== 'processing') return
    const tween = gsap.to(ref.current, {
      opacity: 0.6,
      duration: 0.75,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })
    return () => {
      tween.kill()
      if (ref.current) gsap.set(ref.current, { opacity: 1 })
    }
  }, [entry.status])

  const isEn = variant === 'en'

  return (
    <div
      ref={ref}
      className={`py-2.5 px-3.5 bg-[var(--color-canvas-soft)] rounded-[var(--radius-sm)] border border-transparent transition-[border-color] duration-200 hover:border-[var(--color-hairline)] ${entry.status === 'processing' ? 'border-[rgba(0,217,146,0.15)]' : ''} ${entry.status === 'error' ? 'border-[rgba(255,107,107,0.15)]' : ''}`}
    >
      <div className="text-[10px] text-[var(--color-mute)] font-[var(--font-mono)] mb-1 tracking-[0.3px]">
        {entry.timestamp}
      </div>
      <div
        className={`text-sm leading-[1.6] break-words ${isEn ? 'text-[var(--color-ink)]' : 'text-[rgba(242,242,242,0.9)]'}`}
      >
        {entry.status === 'processing' && (
          <span className="flex items-center gap-1.5 text-[var(--color-primary)] text-xs font-medium">
            <Loader2 size={14} className="animate-spin" /> {isEn ? 'Đang nhận diện…' : 'Đang dịch…'}
          </span>
        )}
        {entry.status === 'done' && (isEn ? entry.english : entry.vietnamese || '…')}
        {entry.status === 'error' &&
          (isEn ? (
            <span className="text-[var(--color-error)] text-xs">❌ {entry.error}</span>
          ) : (
            <span className="text-[var(--color-error)] text-xs">—</span>
          ))}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
export default function AudioTranslator() {
  // ── State ────────────────────────────────────────────────────
  const [mode, setMode] = useState<AudioMode>('system')
  const [isRecording, setIsRecording] = useState(false) // overall session active
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [trackInfo, setTrackInfo] = useState('')
  const [volume, setVolume] = useState(0) // 0-100 for UI
  const [vadActive, setVadActive] = useState(false) // true khi phát hiện giọng nói
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('disconnected')
  const [showSettings, setShowSettings] = useState(false)

  // VAD Configuration State
  const [vadSpeechThreshold, setVadSpeechThreshold] = useState(0.85)
  const [vadRedemptionMs, setVadRedemptionMs] = useState(600)

  // ── Refs ──
  const streamRef = useRef<MediaStream | null>(null)
  const isRecordingRef = useRef(false)
  const enScrollRef = useRef<HTMLDivElement>(null)
  const viScrollRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const vadRef = useRef<any>(null)
  const lastUiUpdateRef = useRef(0)

  // GSAP animation refs
  const recordingDotRef = useRecordingPulse(vadActive)
  const stopBtnRef = useBtnGlow(isRecording)
  const settingsRef = useSlideDown(showSettings)

  // ── Scroll helper ────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      enScrollRef.current?.scrollTo({ top: enScrollRef.current.scrollHeight, behavior: 'smooth' })
      viScrollRef.current?.scrollTo({ top: viScrollRef.current.scrollHeight, behavior: 'smooth' })
    })
  }, [])

  // ── Stop session ─────────────────────────────────────────────
  const handleStop = useCallback(() => {
    isRecordingRef.current = false
    setIsRecording(false)
    setVadActive(false)
    setVolume(0)
    setWsStatus('disconnected')

    // Disconnect Silero VAD if active
    if (vadRef.current) {
      try {
        vadRef.current.pause()
      } catch (err) {
        console.warn('[AT] Error pausing VAD:', err)
      }
      vadRef.current = null
    }

    // Close and stop WebSocket if any
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    // Stop stream
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // ── Start session ────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    setError(null)
    setTrackInfo('')

    try {
      let audioStream: MediaStream

      if (mode === 'mic') {
        await window.api.requestMicPermission()
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } else {
        const rawStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        })
        const audioTracks = rawStream.getAudioTracks()
        if (audioTracks.length === 0) {
          rawStream.getTracks().forEach((t) => t.stop())
          setError('Không có audio track. Cấp quyền Screen Recording trong System Settings.')
          return
        }
        audioStream = new MediaStream(audioTracks)
        rawStream.getVideoTracks().forEach((t) => t.stop())
        setTrackInfo(`${audioTracks[0].label}`)
      }

      streamRef.current = audioStream
      isRecordingRef.current = true
      setIsRecording(true)

      // Track end detection
      audioStream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          handleStop()
        }
      })

      setWsStatus('connecting')

      const ws = new WebSocket('wss://s2t.internal.zobite.com/ws')
      wsRef.current = ws

      ws.onopen = () => {
        setWsStatus('connected')
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'transcription') {
            const entryId = `ws-${data.segment_id}`
            const ts = formatTime(new Date())

            setEntries((prev) => {
              const exists = prev.some((e) => e.id === entryId)
              if (exists) {
                return prev.map((e) =>
                  e.id === entryId
                    ? {
                        ...e,
                        english: data.text,
                        status: data.is_final ? ('done' as const) : ('processing' as const),
                      }
                    : e,
                )
              }
              const next = [
                ...prev,
                {
                  id: entryId,
                  timestamp: ts,
                  english: data.text,
                  vietnamese: '',
                  status: data.is_final ? ('done' as const) : ('processing' as const),
                },
              ]
              // Auto-trim oldest entries to prevent memory growth
              return next.length > MAX_TRANSCRIPT_ENTRIES
                ? next.slice(-MAX_TRANSCRIPT_ENTRIES)
                : next
            })
            scrollToBottom()
          } else if (data.type === 'translation') {
            const entryId = `ws-${data.segment_id}`
            setEntries((prev) =>
              prev.map((e) =>
                e.id === entryId
                  ? {
                      ...e,
                      vietnamese: data.translation,
                      status: 'done' as const,
                    }
                  : e,
              ),
            )
            scrollToBottom()
          }
        } catch (err) {
          console.error('[AT] WS parse error:', err)
        }
      }

      ws.onerror = (err) => {
        console.error('[AT] WS error:', err)
        setError('Lỗi kết nối WebSocket STT')
        setWsStatus('error')
      }

      ws.onclose = () => {
        setWsStatus('disconnected')
      }

      // Initialize Silero VAD
      const myvad = await (window as any).vad.MicVAD.new({
        baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/',
        onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
        getStream: async () => audioStream,
        positiveSpeechThreshold: vadSpeechThreshold,
        negativeSpeechThreshold: Math.max(0.1, vadSpeechThreshold - 0.15),
        redemptionMs: vadRedemptionMs,
        minSpeechMs: 500,
        onSpeechStart: () => {
          setVadActive(true)
        },
        onSpeechEnd: (audio: Float32Array) => {
          setVadActive(false)

          const duration = audio.length / 16000
          if (duration < 0.3) {
            return
          }

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try {
              const pcmBuffer = float32ToInt16(audio)
              wsRef.current.send(pcmBuffer)
            } catch (err) {
              console.error('[AT] WS send audio error:', err)
            }
          }
        },
        onFrameProcessed: (_probabilities: any, frame: Float32Array) => {
          // Calculate volume for visualizer
          let sum = 0
          for (let i = 0; i < frame.length; i++) {
            sum += Math.abs(frame[i])
          }
          const avg = (sum / frame.length) * 128
          setVolume(Math.min(100, Math.round((avg / 60) * 100)))
        },
      })

      myvad.start()
      vadRef.current = myvad
    } catch (err: any) {
      console.error('[AT] Start error:', err)
      setError(
        err.name === 'NotAllowedError'
          ? 'Quyền bị từ chối. Cấp quyền trong System Settings.'
          : err.message || 'Không thể bắt đầu',
      )
    }
  }, [mode, vadSpeechThreshold, vadRedemptionMs, handleStop, scrollToBottom])

  // ── Clear transcript ─────────────────────────────────────────
  const handleClear = useCallback(() => {
    setEntries([])
    setError(null)
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'reset' }))
      } catch (err) {
        console.error('[AT] WS send reset error:', err)
      }
    }
  }, [])

  const processingCount = entries.filter((e) => e.status === 'processing').length

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full gap-4 max-w-[1400px] mx-auto w-full">
      {/* Controls */}
      <div className="bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] py-4 px-5 flex flex-col gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] p-[3px] shrink-0">
            <button
              type="button"
              className={`py-[7px] px-4 rounded border-none text-xs font-medium cursor-pointer transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap font-[var(--font-sans)] ${mode === 'system' ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'bg-transparent text-[var(--color-body)] hover:text-[var(--color-ink)] hover:bg-[rgba(255,255,255,0.04)]'} disabled:opacity-50 disabled:cursor-not-allowed`}
              onClick={() => !isRecording && setMode('system')}
              disabled={isRecording}
            >
              <Volume2 size={14} /> System Audio
            </button>
            <button
              type="button"
              className={`py-[7px] px-4 rounded border-none text-xs font-medium cursor-pointer transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap font-[var(--font-sans)] ${mode === 'mic' ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'bg-transparent text-[var(--color-body)] hover:text-[var(--color-ink)] hover:bg-[rgba(255,255,255,0.04)]'} disabled:opacity-50 disabled:cursor-not-allowed`}
              onClick={() => !isRecording && setMode('mic')}
              disabled={isRecording}
            >
              <Mic size={14} /> Microphone
            </button>
          </div>

          <div className="flex gap-1 ml-auto">
            {isRecording ? (
              <span ref={stopBtnRef as any}>
                <Button type="primary" danger icon={<PauseCircle size={14} />} onClick={handleStop}>
                  Dừng
                </Button>
              </span>
            ) : (
              <Button type="primary" icon={<PlayCircle size={14} />} onClick={handleStart}>
                Bắt đầu
              </Button>
            )}
            <Tooltip title="Cấu hình thu âm">
              <Button
                type={showSettings ? 'primary' : 'default'}
                icon={<Settings size={14} />}
                onClick={() => setShowSettings(!showSettings)}
                style={
                  showSettings
                    ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                    : {}
                }
              />
            </Tooltip>
            <Tooltip title="Xóa transcript">
              <Button
                type="text"
                icon={<Eraser size={14} />}
                onClick={handleClear}
                disabled={entries.length === 0}
                style={{ color: 'var(--color-text-muted)' }}
              />
            </Tooltip>
          </div>
        </div>

        {/* Mode description */}
        <div className="flex items-center gap-2 text-xs text-[var(--color-mute)] py-2 px-3 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)]">
          {mode === 'system' ? (
            <>
              <Volume2 size={14} style={{ color: 'var(--color-accent)' }} />
              <span>
                Capture toàn bộ âm thanh hệ thống — Chrome, Zoom, Google Meet, và tất cả app khác.
              </span>
            </>
          ) : (
            <>
              <Mic size={14} style={{ color: 'var(--color-accent)' }} />
              <span>Capture giọng nói của bạn qua microphone.</span>
            </>
          )}
        </div>

        {/* Active STT Engine Status */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-body)]">
            {wsStatus === 'disconnected' && (
              <>
                <Volume2 size={14} style={{ color: 'var(--color-text-muted)' }} />
                <span className="font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  Zobite STT Server: Chưa kết nối
                </span>
              </>
            )}
            {wsStatus === 'connecting' && (
              <>
                <Loader2
                  size={14}
                  className="animate-spin"
                  style={{ color: 'var(--color-accent)' }}
                />
                <span className="font-medium" style={{ color: 'var(--color-accent)' }}>
                  Zobite STT Server: Đang kết nối...
                </span>
              </>
            )}
            {wsStatus === 'connected' && (
              <>
                <Volume2 size={14} style={{ color: 'var(--color-success)' }} />
                <span className="font-medium" style={{ color: 'var(--color-success)' }}>
                  Zobite STT Server: Đã kết nối ✓
                </span>
              </>
            )}
            {wsStatus === 'error' && (
              <>
                <Volume2 size={14} style={{ color: 'var(--color-danger)' }} />
                <span className="font-medium" style={{ color: 'var(--color-danger)' }}>
                  Zobite STT Server: Lỗi kết nối ❌
                </span>
              </>
            )}
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div
            ref={settingsRef}
            className="bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-[var(--radius-sm)] p-4 mt-2"
          >
            <div className="text-[11px] font-semibold text-[var(--color-mute)] mb-3 uppercase tracking-[2.52px] border-b border-[var(--color-hairline)] pb-1.5">
              Cấu hình ghi âm & dịch (Silero VAD)
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Ngưỡng nhạy giọng nói */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[var(--color-body)]">
                  Ngưỡng nhạy giọng nói (VAD Threshold): <strong>{vadSpeechThreshold}</strong>
                </span>
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.05"
                  className="appearance-none w-full h-1.5 rounded-[3px] bg-[var(--color-canvas)] outline-none my-2 border border-[var(--color-hairline)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-primary)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-100 hover:[&::-webkit-slider-thumb]:scale-[1.2]"
                  value={vadSpeechThreshold}
                  onChange={(e) => setVadSpeechThreshold(Number.parseFloat(e.target.value))}
                />
                <div className="flex justify-between text-[9px] text-[var(--color-mute)] px-0.5">
                  <span>0.1 (Rất nhạy)</span>
                  <span>0.5 (Mặc định)</span>
                  <span>0.9 (Ít nhạy, lọc nhiễu tốt)</span>
                </div>
                <div className="text-[10px] text-[var(--color-mute)] leading-[1.4]">
                  Xác suất tối thiểu để Silero VAD nhận diện là giọng nói. Hãy tăng lên nếu tiếng ồn
                  nền bị nhận diện nhầm là giọng nói.
                </div>
              </div>

              {/* Thời gian chờ im lặng (Gom câu) */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[var(--color-body)]">
                  Thời gian chờ im lặng (Redemption Time): <strong>{vadRedemptionMs} ms</strong>
                </span>
                <input
                  type="range"
                  min="300"
                  max="3000"
                  step="100"
                  className="appearance-none w-full h-1.5 rounded-[3px] bg-[var(--color-canvas)] outline-none my-2 border border-[var(--color-hairline)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-primary)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-100 hover:[&::-webkit-slider-thumb]:scale-[1.2]"
                  value={vadRedemptionMs}
                  onChange={(e) => setVadRedemptionMs(Number.parseInt(e.target.value))}
                />
                <div className="flex justify-between text-[9px] text-[var(--color-mute)] px-0.5">
                  <span>300ms (Ngắt nhanh)</span>
                  <span>600ms (Mặc định)</span>
                  <span>3000ms (Gom câu dài)</span>
                </div>
                <div className="text-[10px] text-[var(--color-mute)] leading-[1.4]">
                  Khoảng thời gian im lặng tối thiểu để chốt câu và bắt đầu phân đoạn dịch mới. Hãy
                  giảm xuống nếu bạn thấy câu bị gom quá dài.
                </div>
              </div>

              {/* Tín hiệu âm thanh đầu vào */}
              {isRecording && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[var(--color-body)]">
                    Tín hiệu âm thanh đầu vào:
                  </span>
                  <div className="relative h-2 bg-[var(--color-canvas)] rounded mt-2 overflow-visible border border-[var(--color-hairline)]">
                    <div
                      className="h-full bg-[var(--color-primary)] rounded transition-[width] duration-[80ms] linear"
                      style={{ width: `${volume}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--color-mute)] leading-[1.4]">
                    Xem mức âm lượng sóng âm hiện tại đang được thu lên trình duyệt thời gian thực.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status bar with VAD info */}
        {(isRecording || processingCount > 0 || error) && (
          <div className="flex gap-4 items-center flex-wrap pt-1.5">
            {isRecording && (
              <>
                <div
                  className={`flex items-center gap-1.5 text-xs ${vadActive ? 'text-[#ff4d4f] font-medium' : 'text-[var(--color-mute)] font-normal'}`}
                >
                  {vadActive ? (
                    <>
                      <span
                        ref={recordingDotRef}
                        className="w-2 h-2 rounded-full bg-[#ff4d4f] shrink-0"
                      />
                      <span>Đang thu âm…</span>
                    </>
                  ) : (
                    <>
                      <Mic size={14} />
                      <span>Lắng nghe…</span>
                    </>
                  )}
                </div>
                {/* Volume meter */}
                <div className="h-1 bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-sm overflow-hidden flex-1 min-w-[60px] max-w-[200px]">
                  <div
                    className={`h-full rounded-sm transition-[width] duration-100 linear ${vadActive ? 'bg-[var(--color-primary)] shadow-[0_0_6px_rgba(0,217,146,0.4)]' : 'bg-[var(--color-mute)]'}`}
                    style={{ width: `${volume}%` }}
                  />
                </div>
              </>
            )}
            {processingCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--color-warning)]">
                <span className="w-3 h-3 border-2 border-[var(--color-hairline)] border-t-[var(--color-warning)] rounded-full animate-spin shrink-0" />
                <span>Đang xử lý {processingCount} đoạn…</span>
              </div>
            )}
            {trackInfo && isRecording && (
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-mute)]">
                {trackInfo}
              </div>
            )}
            {error && (
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-error)]">
                <span>⚠ {error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transcript Area */}
      <div className="flex-1 grid grid-cols-2 min-h-0 bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-[var(--radius-md)] overflow-hidden">
        {/* English column */}
        <div className="flex flex-col overflow-hidden min-h-0 border-r border-[var(--color-hairline)]">
          <div className="py-2.5 px-4 border-b border-[var(--color-hairline)] text-[13px] font-semibold flex items-center gap-2 shrink-0 bg-[var(--color-canvas-soft)]">
            <span className="text-base">🇺🇸</span>
            <span>English</span>
            <span className="ml-auto text-[10px] font-normal text-[var(--color-mute)] bg-[var(--color-canvas)] px-1.5 py-px rounded-[var(--radius-md)] font-[var(--font-mono)]">
              {entries.filter((e) => e.status === 'done').length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0" ref={enScrollRef}>
            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[var(--color-mute)] text-[13px] gap-2 text-center py-10 px-5 select-none">
                <Volume2 size={32} style={{ opacity: 0.2 }} />
                <span>Transcript sẽ hiện ở đây</span>
                <span className="text-[11px] opacity-60">Nhấn &quot;Bắt đầu&quot; để ghi âm</span>
              </div>
            ) : (
              entries.map((entry) => (
                <TranscriptEntryItem key={entry.id} entry={entry} variant="en" />
              ))
            )}
          </div>
        </div>

        {/* Vietnamese column */}
        <div className="flex flex-col overflow-hidden min-h-0">
          <div className="py-2.5 px-4 border-b border-[var(--color-hairline)] text-[13px] font-semibold flex items-center gap-2 shrink-0 bg-[var(--color-canvas-soft)]">
            <span className="text-base">🇻🇳</span>
            <span>Tiếng Việt</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0" ref={viScrollRef}>
            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[var(--color-mute)] text-[13px] gap-2 text-center py-10 px-5 select-none">
                <span style={{ fontSize: 32, opacity: 0.2 }}>🇻🇳</span>
                <span>Bản dịch sẽ hiện ở đây</span>
              </div>
            ) : (
              entries.map((entry) => (
                <TranscriptEntryItem key={entry.id} entry={entry} variant="vi" />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
