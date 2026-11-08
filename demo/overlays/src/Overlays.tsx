import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { BEATS, END, TITLE } from './copy'
import { fmt, n, stamp, val } from './numbers'
import people from '../data/people.json'
import qr from './qr.json'
import { COLORS, countUp, FONT, MONO, presence, SAFE } from './theme'

const panel: React.CSSProperties = {
  background: COLORS.panel,
  border: `1px solid ${COLORS.line2}`,
  borderRadius: 20,
  color: COLORS.text,
  fontFamily: FONT,
  boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
}

/** Slide 24 px from `from` and fade, in over 0.4 s and out over the last 0.4 s. */
function useMotion(from: 'left' | 'right' | 'up') {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const p = presence(frame, durationInFrames)
  const d = (1 - p) * 24
  const t = from === 'left' ? `translateX(${-d}px)` : from === 'right' ? `translateX(${d}px)` : `translateY(${d}px)`
  return { opacity: p, transform: t }
}

function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 2, textTransform: 'uppercase', color: COLORS.text2 }}>{children}</div>
  )
}

export function Title() {
  const m = useMotion('up')
  return (
    <AbsoluteFill style={{ background: COLORS.bg, fontFamily: FONT, color: COLORS.text, justifyContent: 'center', padding: SAFE }}>
      <div style={{ ...m, display: 'flex', flexDirection: 'column', gap: 28, paddingLeft: 64 }}>
        <PriceBar />
        <div style={{ fontSize: 132, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>{TITLE.name}</div>
        <div style={{ fontSize: 44, color: COLORS.text2, maxWidth: 1300, lineHeight: 1.25 }}>{TITLE.tagline}</div>
        <StepLabel>{TITLE.event}</StepLabel>
      </div>
    </AbsoluteFill>
  )
}

function PriceBar() {
  const stops = [0, 50, 100, 150, 200, 275]
  const scale: Record<number, string> = { 0: '#1f3b2c', 50: '#2f6a3a', 100: '#7fa33a', 150: '#d0b043', 200: '#e08a2e', 275: '#d4502e' }
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {stops.map((s) => <div key={s} style={{ width: 56, height: 10, borderRadius: 5, background: scale[s] }} />)}
    </div>
  )
}

export function LowerThird({ who }: { who: keyof typeof people }) {
  const m = useMotion('left')
  const p = people[who]
  return (
    <AbsoluteFill>
      {/* Sits above the Beat caption's place, so both can be on screen together. */}
      <div style={{ ...panel, ...m, position: 'absolute', left: SAFE, bottom: SAFE + 170, padding: '22px 34px', display: 'flex', alignItems: 'center', gap: 22 }}>
        <div style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, background: COLORS.text }} />
        <div>
          <div style={{ fontSize: 48, fontWeight: 600, letterSpacing: -1 }}>{p.name}</div>
          <div style={{ fontSize: 28, color: COLORS.text2, marginTop: 4 }}>{p.role}</div>
        </div>
      </div>
    </AbsoluteFill>
  )
}

export function Beat({ id }: { id: string }) {
  const m = useMotion('left')
  const b = BEATS[id]
  return (
    <AbsoluteFill>
      <div style={{ ...panel, ...m, position: 'absolute', left: SAFE, bottom: SAFE, maxWidth: 1100, padding: '22px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <StepLabel>{b.step}</StepLabel>
        <div style={{ fontSize: 40, fontWeight: 500, lineHeight: 1.25 }}>{b.line}</div>
      </div>
    </AbsoluteFill>
  )
}

type Card = { value: number | null; show: (v: number) => string; label: string; sub?: string; source: string }

function callout(id: string): Card {
  const v = val(id)
  const src = v ? `${v.source}, ${stamp(v.fetched_at)}` : ''
  switch (id) {
    case 'constraint-bill':
      return { value: n(id), show: fmt.gbp, label: 'GB constraint costs on 26 October, the stormy day', sub: 'Mostly paying Scottish wind farms to switch off', source: `NESO daily total via ${src}` }
    case 'hormuz': {
      const p10 = n(id, 'p10'), p90 = n(id, 'p90'), gas = n(id, 'gas_pct'), days = n(id, 'days')
      const shock = gas != null && days != null ? ` (gas up ${Math.round(gas)}% for ${Math.round(days)} days)` : ''
      return { value: n(id), show: fmt.gbp, label: `Extra cost to consumers if the Strait of Hormuz closes${shock}`,
        sub: p10 != null && p90 != null ? `Likely range ${fmt.gbp(p10)} to ${fmt.gbp(p90)} (P10 to P90)` : undefined, source: `Modelled estimate, ${src}` }
    }
    case 'less-wrong':
      return { value: n(id), show: fmt.pct, label: 'less wrong than persistence', sub: 'Persistence: assume the price repeats from the day before', source: `Mean absolute error, walk-forward backtest, ${src}` }
    case 'in-range':
      return { value: n(id), show: fmt.pct, label: 'of real prices landed inside our P10 to P90 band', sub: 'The band is meant to catch 80%', source: `Walk-forward backtest, ${src}` }
    case 'battery': {
      const z = n(id, 'zones')
      return { value: n(id), show: fmt.pct, label: `of the perfect-foresight profit, for our battery${z != null ? ` across ${z} zones` : ''}`, sub: 'Perfect foresight: knowing every price in advance', source: `Settled on real prices, ${src}` }
    }
    case 'scored':
      return { value: n(id), show: fmt.int, label: 'forecasts scored live so far', sub: 'Every one logged before its outcome was known', source: src }
    default:
      return { value: null, show: String, label: id, source: '' }
  }
}

export function Callout({ id }: { id: string }) {
  const frame = useCurrentFrame()
  const m = useMotion('right')
  const c = callout(id)
  const k = countUp(frame)
  return (
    <AbsoluteFill>
      <div style={{ ...panel, ...m, position: 'absolute', right: SAFE, top: SAFE, width: 640, padding: '28px 34px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {c.value != null && (
          <div style={{ fontSize: 104, fontWeight: 700, letterSpacing: -3, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{c.show(c.value * k)}</div>
        )}
        <div style={{ fontSize: 34, fontWeight: 500, lineHeight: 1.25 }}>{c.label}</div>
        {c.sub && <div style={{ fontSize: 26, color: COLORS.text2, lineHeight: 1.3 }}>{c.sub}</div>}
        {c.source && <div style={{ fontFamily: MONO, fontSize: 18, color: COLORS.text3, marginTop: 6 }}>Source: {c.source}</div>}
      </div>
    </AbsoluteFill>
  )
}

function Qr({ px }: { px: number }) {
  const s = qr.size
  return (
    <svg width={px} height={px} viewBox={`0 0 ${s + 8} ${s + 8}`} style={{ borderRadius: 16, display: 'block' }} shapeRendering="crispEdges">
      <rect width={s + 8} height={s + 8} fill="#fff" />
      {qr.data.map((on, i) => (on ? <rect key={i} x={(i % s) + 4} y={Math.floor(i / s) + 4} width={1} height={1} fill="#000" /> : null))}
    </svg>
  )
}

export function EndCard() {
  const m = useMotion('up')
  return (
    <AbsoluteFill style={{ background: COLORS.bg, fontFamily: FONT, color: COLORS.text, justifyContent: 'center', padding: SAFE }}>
      <div style={{ ...m, display: 'flex', alignItems: 'center', gap: 96, paddingLeft: 64 }}>
        <Qr px={420} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <StepLabel>{END.cta}</StepLabel>
          <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -3, lineHeight: 1 }}>{END.url}</div>
          <div style={{ fontSize: 36, color: COLORS.text2 }}>{Object.values(people).map((p) => p.name).join(', ')}</div>
          <div style={{ fontFamily: MONO, fontSize: 30, color: COLORS.text2 }}>{END.repo}</div>
          <StepLabel>{TITLE.name} · {TITLE.event}</StepLabel>
        </div>
      </div>
    </AbsoluteFill>
  )
}
