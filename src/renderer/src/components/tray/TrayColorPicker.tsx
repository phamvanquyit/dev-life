import { CopyOutlined } from '@ant-design/icons'
import { Input, message } from 'antd'
import { useCallback, useState } from 'react'

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return null
  return {
    r: Number.parseInt(m[1], 16),
    g: Number.parseInt(m[2], 16),
    b: Number.parseInt(m[3], 16),
  }
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

const presetColors = [
  '#6c5ce7',
  '#a29bfe',
  '#fd79a8',
  '#e17055',
  '#00cec9',
  '#00b894',
  '#fdcb6e',
  '#636e72',
  '#2d3436',
  '#d63031',
  '#e84393',
  '#0984e3',
  '#74b9ff',
  '#55efc4',
  '#ffeaa7',
  '#dfe6e9',
]

export default function TrayColorPicker() {
  const [color, setColor] = useState('#6c5ce7')

  const rgb = hexToRgb(color)
  const hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : null

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    message.success({ content: 'Copied!', duration: 1 })
  }, [])

  const hexStr = color.toUpperCase()
  const rgbStr = rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : ''
  const hslStr = hsl ? `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` : ''

  return (
    <div className="tray-tool">
      {/* Color preview */}
      <div
        style={{
          width: '100%',
          height: 80,
          borderRadius: 8,
          background: color,
          border: '1px solid rgba(255,255,255,0.1)',
          marginBottom: 12,
          transition: 'background 0.2s ease',
        }}
      />

      {/* Native color picker */}
      <div className="tray-row" style={{ marginBottom: 8 }}>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{
            width: 36,
            height: 28,
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            background: 'transparent',
          }}
        />
        <Input
          value={color}
          onChange={(e) => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setColor(v)
          }}
          size="small"
          style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
      </div>

      {/* Color values */}
      <div className="tray-color-values">
        {[
          { label: 'HEX', value: hexStr },
          { label: 'RGB', value: rgbStr },
          { label: 'HSL', value: hslStr },
        ].map(({ label, value }) => (
          <div key={label} className="tray-color-value-row" onClick={() => copy(value)}>
            <span className="tray-color-label">{label}</span>
            <span className="tray-color-value">{value}</span>
            <CopyOutlined style={{ fontSize: 10, color: '#606078' }} />
          </div>
        ))}
      </div>

      {/* Preset colors */}
      <div className="tray-color-presets">
        {presetColors.map((c) => (
          <div
            key={c}
            className="tray-color-swatch"
            style={{
              background: c,
              outline: c === color ? '2px solid #6c5ce7' : 'none',
              outlineOffset: 1,
            }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
    </div>
  )
}
