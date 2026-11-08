import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { WebMercatorViewport } from 'deck.gl'
import farms from '../../../layers/ghostWind/farms.json'

// Scene overlays: SVG drawn over the map and projected each frame from the live camera (window.lgViewState),
// so they follow a camera fly. Each is { id, ...props }; see runner.jsx for how scenes switch them on and off.
// The map canvas is not always the whole window (phones put it above the sheet): project into its own box.
function mapBox() {
  let best = null
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect()
    if (!best || r.width * r.height > best.width * best.height) best = r
  }
  return best ?? { left: 0, top: 0, width: innerWidth, height: innerHeight }
}

function useProject() {
  const [vp, setVp] = useState(null)
  useEffect(() => {
    let raf
    const tick = () => {
      const v = window.lgViewState
      if (v) {
        const b = mapBox()
        setVp((old) => (old && old.v === v && old.w === b.width && old.h === b.height && old.x === b.left && old.y === b.top ? old
          : { v, w: b.width, h: b.height, x: b.left, y: b.top, p: new WebMercatorViewport({ ...v, width: b.width, height: b.height }) }))
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
  return vp ? { project: (ll) => { const [x, y] = vp.p.project(ll); return [x + vp.x, y + vp.y] } } : null
}

const pt = (p, ll) => p.project([ll[0], ll[1]])

// Props: where [lon,lat], color. A beat that repeats: the boundary is at its limit.
function Pulse({ p, where, color = '#ee7d2c', r = 26 }) {
  const [x, y] = pt(p, where)
  return <g transform={`translate(${x} ${y})`}><circle className="sc-pulse" r={r} fill="none" stroke={color} strokeWidth="2.5" /><circle r="5" fill={color} /></g>
}

// Props: where, r (px). A soft glow.
function Glow({ p, where, r = 60, color = '#5ed6c4' }) {
  const [x, y] = pt(p, where)
  return <circle className="sc-glow" cx={x} cy={y} r={r} fill={color} opacity=".25" />
}

function Ring({ p, where, r = 40, color = '#fff' }) {
  const [x, y] = pt(p, where)
  return <circle className="sc-ring" cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth="1.5" />
}

// Props: path [[lon,lat]...], speed (1 = normal), jam 0..1 (how bunched), color, width (px).
function Arrows({ p, path, speed = 1, jam = 0, color = '#e0c340', width = 3 }) {
  const pts = path.map((l) => pt(p, l))
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${q[1]}`).join(' ')
  const gap = 26 - 16 * jam
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeOpacity=".25" strokeWidth={width + 6 * jam} strokeLinecap="round" />
      <path className="sc-flow" d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round"
        strokeDasharray={`6 ${gap}`} style={{ animationDuration: `${1.2 / Math.max(0.2, speed)}s` }} />
    </g>
  )
}

// Props: path, fill 0..1. The boundary as a pipe: the bar fills up to `fill` and turns red as it reaches the top.
function Pipe({ p, path, fill = 0, width = 14 }) {
  const pts = path.map((l) => pt(p, l))
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${q[1]}`).join(' ')
  const hot = fill > 0.9
  return (
    <g>
      <path d={d} fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth={width + 4} strokeLinecap="round" />
      <path d={d} fill="none" stroke="#111" strokeOpacity=".6" strokeWidth={width} strokeLinecap="round" />
      <path d={d} pathLength="1" fill="none" stroke={hot ? '#c8322e' : '#ee7d2c'} strokeWidth={width - 4} strokeLinecap="round"
        strokeDasharray={`${fill} 1`} />
    </g>
  )
}

// Props: dim 0..1 (share of farms switched off), blow (wind streaks over Scotland). Farms go grey as `dim` rises.
function Farms({ p, dim = 0 }) {
  const order = [...farms].sort((a, b) => b.mw - a.mw)
  return (
    <g>
      {order.map((f, i) => {
        const [x, y] = pt(p, f.coord)
        const off = dim * order.length > i
        return <circle key={f.unit} cx={x} cy={y} r={4 + Math.sqrt(f.mw) / 6} fill={off ? '#7a7f87' : '#5ed6c4'}
          stroke={off ? '#aaa' : '#e6fffa'} strokeWidth="1.2" style={{ transition: 'fill .6s, stroke .6s' }} />
      })}
    </g>
  )
}

// Wind blowing over a box [lon0,lat0,lon1,lat1]: streaks sliding to the east-north-east.
function Streaks({ p, box = [-7.9, 55.2, -1.5, 58.9], speed = 1 }) {
  const lines = []
  for (let i = 0; i < 26; i++) {
    const lon = box[0] + ((i * 37) % 100) / 100 * (box[2] - box[0])
    const lat = box[1] + ((i * 61) % 100) / 100 * (box[3] - box[1])
    const [x, y] = pt(p, [lon, lat])
    lines.push(<line key={i} className="sc-streak" x1={x} y1={y} x2={x + 46} y2={y - 14} stroke="#dff" strokeWidth="1.6" strokeLinecap="round"
      style={{ animationDelay: `${(i % 7) * -0.3}s`, animationDuration: `${1.8 / speed}s` }} />)
  }
  return <g>{lines}</g>
}

const KINDS = { pulse: Pulse, glow: Glow, ring: Ring, arrows: Arrows, pipe: Pipe, farms: Farms, streaks: Streaks }
export const OVERLAY_IDS = Object.keys(KINDS)

// items: { [key]: { kind, ...props } }. A scene step {overlay:'b6', kind:'pulse', on:true, ...props} sets one.
export default function Overlays({ items }) {
  const p = useProject()
  if (!p) return null
  // In the body: a panel's transforms and scrolling would otherwise clip or offset a fixed overlay.
  return createPortal(
    <svg className="sc-overlay" width="100%" height="100%" aria-hidden="true">
      {Object.entries(items).map(([k, { kind, ...props }]) => {
        const C = KINDS[kind ?? k]
        return C ? <C key={k} p={p} {...props} /> : null
      })}
    </svg>,
    document.body
  )
}

export const overlayCss = `
  .sc-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 4; }
  .sc-pulse { transform-box: fill-box; transform-origin: center; animation: sc-pulse 1.1s ease-out infinite; }
  .sc-glow { animation: sc-glow 2.4s ease-in-out infinite; }
  .sc-ring { animation: sc-glow 2s ease-in-out infinite; }
  .sc-flow { animation: sc-flow 1.2s linear infinite; }
  .sc-streak { animation: sc-streak 1.8s linear infinite; opacity: 0; }
  @keyframes sc-pulse { from { transform: scale(.4); opacity: .95; } to { transform: scale(1.7); opacity: 0; } }
  @keyframes sc-glow { 0%, 100% { opacity: .15; } 50% { opacity: .4; } }
  @keyframes sc-flow { to { stroke-dashoffset: -32; } }
  @keyframes sc-streak { 0% { transform: translate(-30px, 9px); opacity: 0; } 25% { opacity: .8; } 100% { transform: translate(60px, -18px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .sc-pulse, .sc-glow, .sc-ring, .sc-flow, .sc-streak { animation: none; } }
`
