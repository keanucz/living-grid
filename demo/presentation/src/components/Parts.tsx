import React from 'react'
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT, MONO } from '../theme'
import type { Fig } from '../data'

export const Title: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 96 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: frame - 4, fps, config: { damping: 200 } })
  return <div style={{ fontSize: size, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1.05, opacity: s, transform: `translateY(${(1 - s) * 24}px)` }}>{children}</div>
}

export const Line: React.FC<{ children: React.ReactNode; delay?: number; size?: number; color?: string }> = ({ children, delay = 0, size = 38, color = COLORS.text2 }) => {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [delay, delay + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return <div style={{ fontSize: size, lineHeight: 1.4, color, opacity: o, maxWidth: 1320, marginTop: 20 }}>{children}</div>
}

/** A number counting up to its snapshot value. Shows a dash and says so if the snapshot lacks it. */
export const Big: React.FC<{ fig: Fig; format: (v: number | null) => string; label: string; delay?: number; size?: number }> = ({ fig, format, label, delay = 6, size = 140 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 42 })
  const v = fig.v == null ? null : fig.v * t
  return (
    <div style={{ opacity: Math.min(1, t * 3) }}>
      <div style={{ fontSize: size, fontWeight: 500, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{format(v)}</div>
      <div style={{ fontFamily: FONT, fontSize: 28, color: COLORS.text2, marginTop: 14, lineHeight: 1.25, maxWidth: 620 }}>{label}</div>
      {fig.v == null && <div style={{ fontFamily: MONO, fontSize: 28, color: COLORS.text3, marginTop: 6 }}>not in the snapshot ({fig.src})</div>}
    </div>
  )
}

export const Row: React.FC<{ children: React.ReactNode; gap?: number }> = ({ children, gap = 96 }) => <div style={{ display: 'flex', gap, alignItems: 'flex-end', marginTop: 56 }}>{children}</div>

/** Two bars side by side (for example our error against persistence), drawn from two figures. */
export const Bars: React.FC<{ items: { label: string; fig: Fig; strong?: boolean }[]; format: (v: number | null) => string; delay?: number; width?: number; compact?: boolean }> = ({ items, format, delay = 8, width = 1100, compact = false }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const max = Math.max(...items.map((i) => i.fig.v ?? 0), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 22, marginTop: compact ? 24 : 40, width }}>
      {items.map((it, i) => {
        const t = spring({ frame: frame - delay - i * 6, fps, config: { damping: 200 }, durationInFrames: 40 })
        return (
          <div key={it.label} style={{ display: 'grid', gridTemplateColumns: compact ? '230px 1fr 90px' : '460px 1fr 170px', alignItems: 'center', gap: 20 }}>
            <div style={{ fontSize: compact ? 28 : 32, color: COLORS.text2 }}>{it.label}</div>
            <div style={{ height: compact ? 26 : 44, background: COLORS.card, borderRadius: 4 }}>
              <div style={{ height: '100%', width: `${((it.fig.v ?? 0) / max) * 100 * t}%`, background: it.strong ? COLORS.accent : COLORS.text3, borderRadius: 4 }} />
            </div>
            <div style={{ fontFamily: FONT, fontSize: compact ? 28 : 44, fontVariantNumeric: 'tabular-nums' }}>{format(it.fig.v)}</div>
          </div>
        )
      })}
    </div>
  )
}

/** A line chart with an optional P10 to P90 band, from numbers the caller got out of the snapshot. */
export const LineChart: React.FC<{
  series: { x: number; y: number | null; lo?: number; hi?: number; mid?: number }[]
  width?: number
  height?: number
  unit?: string
  draw?: number // frames to draw over
  marks?: boolean // ring the hours where the actual price left the band
}> = ({ series, width = 1200, height = 460, unit = '', draw = 60, marks = false }) => {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [6, 6 + draw], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const vals = series.flatMap((s) => [s.y, s.lo, s.hi, s.mid].filter((v): v is number => v != null))
  if (!vals.length) return <div style={{ color: COLORS.text3, fontFamily: MONO }}>no series in the snapshot</div>
  const lo = Math.min(0, ...vals), hi = Math.max(...vals)
  const xs = (x: number) => (x / Math.max(1, series.length - 1)) * width
  const ys = (v: number) => height - ((v - lo) / (hi - lo || 1)) * height
  const path = (key: 'y' | 'mid') => series.map((s, i) => (s[key] == null ? '' : `${i && series[i - 1][key] != null ? 'L' : 'M'}${xs(s.x).toFixed(1)},${ys(s[key] as number).toFixed(1)}`)).join('')
  const band = series.every((s) => s.lo != null && s.hi != null)
    ? `${series.map((s, i) => `${i ? 'L' : 'M'}${xs(s.x).toFixed(1)},${ys(s.hi!).toFixed(1)}`).join('')}${[...series].reverse().map((s) => `L${xs(s.x).toFixed(1)},${ys(s.lo!).toFixed(1)}`).join('')}Z`
    : null
  const ticks = [lo, (lo + hi) / 2, hi]
  return (
    <svg width={width + 120} height={height + 60} style={{ marginTop: 30, overflow: 'visible' }}>
      <g transform="translate(100,10)">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={0} x2={width} y1={ys(v)} y2={ys(v)} stroke={COLORS.line} />
            <text x={-14} y={ys(v) + 7} textAnchor="end" fill={COLORS.text3} fontFamily={MONO} fontSize={28}>{Math.round(v)}</text>
          </g>
        ))}
        {band && <path d={band} fill="rgba(255,255,255,0.10)" opacity={t} />}
        <clipPath id="reveal"><rect x={0} y={-10} width={width * t} height={height + 20} /></clipPath>
        <g clipPath="url(#reveal)">
          {series.some((s) => s.mid != null) && <path d={path('mid')} fill="none" stroke={COLORS.text2} strokeWidth={3} strokeDasharray="8 8" />}
          <path d={path('y')} fill="none" stroke={COLORS.accent} strokeWidth={5} />
        </g>
        {marks && series.map((s, i) => (s.y != null && s.hi != null && s.lo != null && (s.y > s.hi || s.y < s.lo)) ? <circle key={i} cx={xs(s.x)} cy={ys(s.y)} r={14} fill="none" stroke="#ff6b6b" strokeWidth={4} opacity={t} /> : null)}
        {unit && <text x={0} y={height + 50} fill={COLORS.text3} fontFamily={MONO} fontSize={28}>{unit}</text>}
      </g>
    </svg>
  )
}
