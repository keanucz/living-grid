import React from 'react'
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, getStaticFiles, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT, MONO, priceColor } from '../theme'
import { Stage } from './Stage'
import type { Fig } from '../data'
import geo from '../geo.json'
import qr from '../qr.json'
import type { ZonePrice } from '../figs'

/** A plain-English caption at the foot of a beat. */
export const Caption: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 10 }) => {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [delay, delay + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div style={{ position: 'absolute', left: 120, right: 120, bottom: 88, display: 'flex', justifyContent: 'center', opacity: o }}>
      <div style={{ background: 'rgba(23,23,23,0.92)', border: `1px solid ${COLORS.line2}`, borderRadius: 14, padding: '16px 30px', fontSize: 32, lineHeight: 1.35, color: COLORS.text, maxWidth: 1500, textAlign: 'center' }}>{children}</div>
    </div>
  )
}

/** A scene made of beats, each shown for its own number of seconds inside its own Stage. */
export const Beats: React.FC<{ beats: { seconds: number; kicker?: string; sources?: Fig[]; render: () => React.ReactNode }[] }> = ({ beats }) => {
  const { fps } = useVideoConfig()
  let from = 0
  return (
    <>
      {beats.map((b, i) => {
        const d = Math.round(b.seconds * fps)
        const at = from
        from += d
        return (
          <Sequence key={i} from={at} durationInFrames={d}>
            <Stage kicker={b.kicker} sources={b.sources}>{b.render()}</Stage>
          </Sequence>
        )
      })}
    </>
  )
}

// ---- Map -------------------------------------------------------------------------------------------------------------

const BOX = { lon: [-11, 15], lat: [43, 62] }
const KX = Math.cos((52.5 * Math.PI) / 180)
export const project = (W: number, H: number) => {
  const wDeg = (BOX.lon[1] - BOX.lon[0]) * KX
  const hDeg = BOX.lat[1] - BOX.lat[0]
  const s = Math.min(W / wDeg, H / hDeg)
  const ox = (W - wDeg * s) / 2
  const oy = (H - hDeg * s) / 2
  return ([lon, lat]: number[]) => [ox + (lon - BOX.lon[0]) * KX * s, oy + (BOX.lat[1] - lat) * s]
}
const ringPath = (r: number[][], p: ReturnType<typeof project>) => r.map((c, i) => `${i ? 'L' : 'M'}${p(c).map((n) => n.toFixed(1)).join(',')}`).join('') + 'Z'
const features = geo as unknown as { zone: string | null; name: string; polys: number[][][][] }[]

const CENTRES: Record<string, [number, number]> = { GB: [-2.2, 53.6], FR: [2.4, 46.9], 'DE-LU': [10.2, 51.3], NL: [5.5, 52.3], BE: [4.6, 50.6], NO2: [8.2, 59.3] }
const UK_SCOTLAND: [number, number] = [-4.2, 57.2]

/** Europe drawn from the site's own boundaries. Zones are filled on the site's fixed price scale; labels show the price. */
export const EuropeMap: React.FC<{ prices?: ZonePrice[]; width?: number; height?: number; reveal?: number; glowScotland?: boolean; labels?: boolean; dim?: boolean }> = ({ prices = [], width = 760, height = 800, reveal = 1, glowScotland = false, labels = true, dim = false }) => {
  const frame = useCurrentFrame()
  const p = project(width, height)
  const byZone = Object.fromEntries(prices.map((z) => [z.zone, z]))
  const order = prices.map((z) => z.zone)
  const lit = (zone: string | null) => (zone ? Math.min(1, Math.max(0, reveal * (order.length + 1) - order.indexOf(zone))) : 0)
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      {features.map((f, i) => {
        const z = f.zone ? byZone[f.zone] : null
        const l = z && z.price != null ? lit(z.zone) : 0
        return (
          <path key={i} d={f.polys.map((poly) => poly.map((r) => ringPath(r, p)).join('')).join('')} fill={z && z.price != null ? priceColor(z.gbp ? z.price * 1.17 : z.price) : '#1a1a1a'} fillOpacity={z ? 0.25 + 0.7 * l * (dim ? 0.6 : 1) : 1} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
        )
      })}
      {glowScotland && (
        <g>
          {[0, 1, 2].map((k) => {
            const t = ((frame / 40 + k / 3) % 1)
            const [cx, cy] = p(UK_SCOTLAND)
            return <circle key={k} cx={cx} cy={cy} r={20 + t * 70} fill="none" stroke="#9fe3f5" strokeOpacity={0.7 * (1 - t)} strokeWidth={3} />
          })}
          <circle cx={p(UK_SCOTLAND)[0]} cy={p(UK_SCOTLAND)[1]} r={9} fill="#9fe3f5" />
        </g>
      )}
      {labels && prices.map((z) => {
        const c = CENTRES[z.zone]
        if (!c || z.price == null) return null
        const [x, y] = p(c)
        const l = lit(z.zone)
        return (
          <g key={z.zone} opacity={l} transform={`translate(${x},${y})`}>
            <rect x={-62} y={-24} width={124} height={48} rx={10} fill="rgba(10,10,10,0.88)" stroke={COLORS.line2} />
            <text x={0} y={9} textAnchor="middle" fontFamily={FONT} fontSize={26} fontWeight={600} fill={COLORS.text}>{z.zone} {z.gbp ? '£' : '€'}{Math.round(z.price)}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ---- Clips -----------------------------------------------------------------------------------------------------------

/** Is public/<path> there? getStaticFiles lists public/ in the render and in Studio; anywhere it cannot, the answer is no. */
const hasStatic = (path: string): boolean => {
  try {
    return getStaticFiles().some((f) => f.name === path)
  } catch {
    return false
  }
}

/** A short screen recording of the live site, public/clips/main/<step>.mp4 (demo/record/record.mjs --tour main --per-step
 * --out demo/presentation/public/clips). With no file, the frame shows a title card with the figure, so the deck renders either way. */
export const ClipFrame: React.FC<{ step: string | null; title: string; width?: number; children?: React.ReactNode }> = ({ step, title, width = 1060, children }) => {
  const height = (width * 9) / 16
  const path = step ? `clips/main/${step}.mp4` : null
  return (
    <div style={{ width, height, borderRadius: 18, overflow: 'hidden', border: `1px solid ${COLORS.line2}`, background: COLORS.panel, position: 'relative', flex: 'none' }}>
      {path && hasStatic(path) ? (
        <OffthreadVideo src={staticFile(path)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
      ) : (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 18, color: COLORS.text3, fontFamily: MONO, fontSize: 24, textAlign: 'center' }}>
          {children}
          <div>{title}</div>
        </AbsoluteFill>
      )}
    </div>
  )
}

// ---- QR --------------------------------------------------------------------------------------------------------------

export const QR: React.FC<{ size?: number }> = ({ size = 360 }) => {
  const n = qr.size
  const cell = size / (n + 8)
  return (
    <svg width={size} height={size} style={{ borderRadius: 16 }}>
      <rect width={size} height={size} fill="#fafafa" />
      {qr.data.map((on, i) => (on ? <rect key={i} x={(4 + (i % n)) * cell} y={(4 + Math.floor(i / n)) * cell} width={cell + 0.5} height={cell + 0.5} fill="#0a0a0a" /> : null))}
    </svg>
  )
}
export const QR_URL = qr.url

/** Fade and rise for any block. */
export const Rise: React.FC<{ children: React.ReactNode; delay?: number; style?: React.CSSProperties }> = ({ children, delay = 0, style }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } })
  return <div style={{ opacity: s, transform: `translateY(${(1 - s) * 22}px)`, ...style }}>{children}</div>
}

export const ease = Easing.out(Easing.cubic)
