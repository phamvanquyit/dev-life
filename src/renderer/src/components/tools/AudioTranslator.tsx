import {
  AudioOutlined,
  ClearOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  SoundOutlined,
} from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { useCallback, useRef, useState } from 'react'

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
              return [
                ...prev,
                {
                  id: entryId,
                  timestamp: ts,
                  english: data.text,
                  vietnamese: '',
                  status: data.is_final ? ('done' as const) : ('processing' as const),
                },
              ]
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
    <div className="at-page">
      {/* Controls */}
      <div className="at-controls">
        <div className="at-controls-top">
          <div className="at-mode-tabs">
            <button
              type="button"
              className={`at-mode-tab ${mode === 'system' ? 'active' : ''}`}
              onClick={() => !isRecording && setMode('system')}
              disabled={isRecording}
            >
              <SoundOutlined /> System Audio
            </button>
            <button
              type="button"
              className={`at-mode-tab ${mode === 'mic' ? 'active' : ''}`}
              onClick={() => !isRecording && setMode('mic')}
              disabled={isRecording}
            >
              <AudioOutlined /> Microphone
            </button>
          </div>

          <div className="at-actions">
            {isRecording ? (
              <Button
                type="primary"
                danger
                icon={<PauseCircleOutlined />}
                onClick={handleStop}
                className="at-stop-btn"
              >
                Dừng
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStart}
                className="at-start-btn"
              >
                Bắt đầu
              </Button>
            )}
            <Tooltip title="Cấu hình thu âm">
              <Button
                type={showSettings ? 'primary' : 'default'}
                icon={<SettingOutlined />}
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
                icon={<ClearOutlined />}
                onClick={handleClear}
                disabled={entries.length === 0}
                style={{ color: 'var(--color-text-muted)' }}
              />
            </Tooltip>
          </div>
        </div>

        {/* Mode description */}
        <div className="at-mode-desc">
          {mode === 'system' ? (
            <>
              <SoundOutlined style={{ color: 'var(--color-accent)' }} />
              <span>
                Capture toàn bộ âm thanh hệ thống — Chrome, Zoom, Google Meet, và tất cả app khác.
              </span>
            </>
          ) : (
            <>
              <AudioOutlined style={{ color: 'var(--color-accent)' }} />
              <span>Capture giọng nói của bạn qua microphone.</span>
            </>
          )}
        </div>

        {/* Active STT Engine Status */}
        <div className="at-api-key-section">
          <div className="at-api-key-header">
            {wsStatus === 'disconnected' && (
              <>
                <SoundOutlined style={{ color: 'var(--color-text-muted)' }} />
                <span className="at-api-key-label" style={{ color: 'var(--color-text-muted)' }}>
                  Zobite STT Server: Chưa kết nối
                </span>
              </>
            )}
            {wsStatus === 'connecting' && (
              <>
                <LoadingOutlined style={{ color: 'var(--color-accent)' }} />
                <span className="at-api-key-label" style={{ color: 'var(--color-accent)' }}>
                  Zobite STT Server: Đang kết nối...
                </span>
              </>
            )}
            {wsStatus === 'connected' && (
              <>
                <SoundOutlined style={{ color: 'var(--color-success)' }} />
                <span className="at-api-key-label" style={{ color: 'var(--color-success)' }}>
                  Zobite STT Server: Đã kết nối ✓
                </span>
              </>
            )}
            {wsStatus === 'error' && (
              <>
                <SoundOutlined style={{ color: 'var(--color-danger)' }} />
                <span className="at-api-key-label" style={{ color: 'var(--color-danger)' }}>
                  Zobite STT Server: Lỗi kết nối ❌
                </span>
              </>
            )}
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="at-settings-panel">
            <div className="at-settings-title">Cấu hình ghi âm & dịch (Silero VAD)</div>

            <div className="at-settings-grid">
              {/* Ngưỡng nhạy giọng nói */}
              <div className="at-settings-item">
                <span className="at-setting-label">
                  Ngưỡng nhạy giọng nói (VAD Threshold): <strong>{vadSpeechThreshold}</strong>
                </span>
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.05"
                  className="at-slider"
                  value={vadSpeechThreshold}
                  onChange={(e) => setVadSpeechThreshold(Number.parseFloat(e.target.value))}
                />
                <div className="at-slider-ticks">
                  <span>0.1 (Rất nhạy)</span>
                  <span>0.5 (Mặc định)</span>
                  <span>0.9 (Ít nhạy, lọc nhiễu tốt)</span>
                </div>
                <div className="at-setting-help">
                  Xác suất tối thiểu để Silero VAD nhận diện là giọng nói. Hãy tăng lên nếu tiếng ồn
                  nền bị nhận diện nhầm là giọng nói.
                </div>
              </div>

              {/* Thời gian chờ im lặng (Gom câu) */}
              <div className="at-settings-item">
                <span className="at-setting-label">
                  Thời gian chờ im lặng (Redemption Time): <strong>{vadRedemptionMs} ms</strong>
                </span>
                <input
                  type="range"
                  min="300"
                  max="3000"
                  step="100"
                  className="at-slider"
                  value={vadRedemptionMs}
                  onChange={(e) => setVadRedemptionMs(Number.parseInt(e.target.value))}
                />
                <div className="at-slider-ticks">
                  <span>300ms (Ngắt nhanh)</span>
                  <span>600ms (Mặc định)</span>
                  <span>3000ms (Gom câu dài)</span>
                </div>
                <div className="at-setting-help">
                  Khoảng thời gian im lặng tối thiểu để chốt câu và bắt đầu phân đoạn dịch mới. Hãy
                  giảm xuống nếu bạn thấy câu bị gom quá dài.
                </div>
              </div>

              {/* Tín hiệu âm thanh đầu vào */}
              {isRecording && (
                <div className="at-settings-item">
                  <span className="at-setting-label">Tín hiệu âm thanh đầu vào:</span>
                  <div className="at-threshold-visualizer" style={{ marginTop: 8 }}>
                    <div className="at-threshold-visualizer-bar" style={{ width: `${volume}%` }} />
                  </div>
                  <div className="at-setting-help">
                    Xem mức âm lượng sóng âm hiện tại đang được thu lên trình duyệt thời gian thực.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status bar with VAD info */}
        {(isRecording || processingCount > 0 || error) && (
          <div className="at-status-bar">
            {isRecording && (
              <>
                <div
                  className={`at-status-item ${vadActive ? 'at-status-recording' : 'at-status-listening'}`}
                >
                  {vadActive ? (
                    <>
                      <span className="at-recording-dot" />
                      <span>Đang thu âm…</span>
                    </>
                  ) : (
                    <>
                      <AudioOutlined />
                      <span>Lắng nghe…</span>
                    </>
                  )}
                </div>
                {/* Volume meter */}
                <div className="at-volume-meter">
                  <div
                    className={`at-volume-bar ${vadActive ? 'speaking' : ''}`}
                    style={{ width: `${volume}%` }}
                  />
                </div>
              </>
            )}
            {processingCount > 0 && (
              <div className="at-status-item at-status-processing">
                <span className="at-spinner" />
                <span>Đang xử lý {processingCount} đoạn…</span>
              </div>
            )}
            {trackInfo && isRecording && (
              <div
                className="at-status-item"
                style={{ color: 'var(--color-text-muted)', fontSize: 10 }}
              >
                {trackInfo}
              </div>
            )}
            {error && (
              <div className="at-status-item at-status-error">
                <span>⚠ {error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transcript Area */}
      <div className="at-transcript-area">
        {/* English column */}
        <div className="at-column">
          <div className="at-column-header at-column-en">
            <span className="at-flag">🇺🇸</span>
            <span>English</span>
            <span className="at-entry-count">
              {entries.filter((e) => e.status === 'done').length}
            </span>
          </div>
          <div className="at-column-body" ref={enScrollRef}>
            {entries.length === 0 ? (
              <div className="at-empty-state">
                <SoundOutlined style={{ fontSize: 32, opacity: 0.2 }} />
                <span>Transcript sẽ hiện ở đây</span>
                <span className="at-empty-hint">Nhấn &quot;Bắt đầu&quot; để ghi âm</span>
              </div>
            ) : (
              entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`at-entry ${entry.status === 'processing' ? 'at-entry-loading' : ''} ${entry.status === 'error' ? 'at-entry-error' : ''}`}
                >
                  <div className="at-entry-time">{entry.timestamp}</div>
                  <div className="at-entry-text">
                    {entry.status === 'processing' && (
                      <span className="at-live-indicator">
                        <LoadingOutlined spin /> Đang nhận diện…
                      </span>
                    )}
                    {entry.status === 'done' && entry.english}
                    {entry.status === 'error' && (
                      <span className="at-error-text">❌ {entry.error}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Vietnamese column */}
        <div className="at-column">
          <div className="at-column-header at-column-vi">
            <span className="at-flag">🇻🇳</span>
            <span>Tiếng Việt</span>
          </div>
          <div className="at-column-body" ref={viScrollRef}>
            {entries.length === 0 ? (
              <div className="at-empty-state">
                <span style={{ fontSize: 32, opacity: 0.2 }}>🇻🇳</span>
                <span>Bản dịch sẽ hiện ở đây</span>
              </div>
            ) : (
              entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`at-entry at-entry-vi ${entry.status === 'processing' ? 'at-entry-loading' : ''} ${entry.status === 'error' ? 'at-entry-error' : ''}`}
                >
                  <div className="at-entry-time">{entry.timestamp}</div>
                  <div className="at-entry-text">
                    {entry.status === 'processing' && (
                      <span className="at-live-indicator">
                        <LoadingOutlined spin /> Đang dịch…
                      </span>
                    )}
                    {entry.status === 'done' && (entry.vietnamese || '…')}
                    {entry.status === 'error' && <span className="at-error-text">—</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
