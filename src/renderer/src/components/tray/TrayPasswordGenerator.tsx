import { CopyOutlined, GlobalOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Checkbox, message, Slider } from 'antd'
import { useEffect } from 'react'
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

export default function TrayPasswordGenerator() {
  const {
    length,
    options,
    passwords,
    browserInfo,
    detecting,
    setLength,
    toggleOption,
    generate,
    copyPassword,
  } = usePasswordStore()

  // Generate on first mount if no passwords yet
  useEffect(() => {
    if (passwords.length === 0) {
      generate()
    }
  }, [generate, passwords.length])

  const handleGenerate = async () => {
    await generate()
    message.success({ content: 'Generated!', duration: 1 })
  }

  const handleCopy = (pw: string) => {
    copyPassword(pw)
    message.success({ content: 'Copied!', duration: 1 })
  }

  return (
    <div className="tray-tool">
      {/* Detected website banner */}
      {browserInfo && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'linear-gradient(135deg, rgba(108, 92, 231, 0.15), rgba(0, 206, 201, 0.1))',
            border: '1px solid rgba(108, 92, 231, 0.3)',
            marginBottom: 8,
          }}
        >
          <GlobalOutlined style={{ fontSize: 14, color: '#6c5ce7', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#e8e8f0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {browserInfo.domain}
            </div>
            <div style={{ fontSize: 9, color: '#9090a8' }}>via {browserInfo.browser}</div>
          </div>
        </div>
      )}

      {/* Length slider */}
      <div className="tray-row">
        <span className="tray-label">
          Length: <strong style={{ color: '#6c5ce7' }}>{length}</strong>
        </span>
        <Slider
          min={4}
          max={64}
          value={length}
          onChange={setLength}
          style={{ flex: 1, marginLeft: 12 }}
        />
      </div>

      {/* Charset options */}
      <div className="tray-row" style={{ gap: 12 }}>
        <Checkbox checked={options.uppercase} onChange={() => toggleOption('uppercase')}>
          <span className="tray-checkbox-label">ABC</span>
        </Checkbox>
        <Checkbox checked={options.lowercase} onChange={() => toggleOption('lowercase')}>
          <span className="tray-checkbox-label">abc</span>
        </Checkbox>
        <Checkbox checked={options.numbers} onChange={() => toggleOption('numbers')}>
          <span className="tray-checkbox-label">123</span>
        </Checkbox>
        <Checkbox checked={options.symbols} onChange={() => toggleOption('symbols')}>
          <span className="tray-checkbox-label">#$&</span>
        </Checkbox>
      </div>

      {/* Generate button */}
      <Button
        type="primary"
        icon={<ReloadOutlined />}
        onClick={handleGenerate}
        loading={detecting}
        block
        size="small"
        style={{ marginBottom: 8 }}
      >
        Generate
      </Button>

      {/* Password list */}
      <div className="tray-password-list">
        {passwords.map((pw, i) => {
          const strength = getStrength(pw)
          return (
            <div key={`${pw}-${i}`} className="tray-password-item" onClick={() => handleCopy(pw)}>
              {browserInfo && (
                <div style={{ fontSize: 9, color: '#6c5ce7', marginBottom: 2, opacity: 0.7 }}>
                  {browserInfo.domain}
                </div>
              )}
              <div className="tray-pw-text">{pw}</div>
              <div className="tray-pw-footer">
                <div className="tray-pw-strength-bar">
                  <div
                    style={{
                      width: `${strength.percent}%`,
                      height: '100%',
                      background: strength.color,
                      borderRadius: 2,
                    }}
                  />
                </div>
                <span style={{ fontSize: 9, color: strength.color }}>{strength.label}</span>
                <CopyOutlined style={{ fontSize: 11, color: '#606078', marginLeft: 'auto' }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
