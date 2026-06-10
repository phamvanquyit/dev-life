import { Input, message } from 'antd'
import { Copy } from 'lucide-react'
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
    <div className="flex flex-col">
      {/* Color preview */}
      <div
        className="w-full h-20 rounded-lg border border-[rgba(255,255,255,0.1)] mb-3 transition-[background] duration-200"
        style={{ background: color }}
      />

      {/* Native color picker */}
      <div className="flex items-center mb-2">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-9 h-7 border-none rounded cursor-pointer bg-transparent"
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
      <div className="flex flex-col gap-1 mb-3">
        {[
          { label: 'HEX', value: hexStr },
          { label: 'RGB', value: rgbStr },
          { label: 'HSL', value: hslStr },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="flex items-center gap-2 py-1.5 px-2 bg-[var(--color-canvas-soft)] rounded-[var(--radius-sm)] cursor-pointer transition-[background] duration-150 hover:bg-[#222]"
            onClick={() => copy(value)}
          >
            <span className="text-[9px] font-semibold text-[var(--color-mute)] w-7 uppercase tracking-[0.5px]">
              {label}
            </span>
            <span className="flex-1 text-[11px] font-[var(--font-mono)] text-[var(--color-ink)]">
              {value}
            </span>
            <Copy size={10} style={{ color: '#606078' }} />
          </div>
        ))}
      </div>

      {/* Preset colors */}
      <div className="grid grid-cols-8 gap-1.5 mt-1">
        {presetColors.map((c) => (
          <div
            key={c}
            className="w-full aspect-square rounded-[var(--radius-sm)] cursor-pointer transition-transform duration-150 border border-[rgba(255,255,255,0.06)] hover:scale-[1.15]"
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
