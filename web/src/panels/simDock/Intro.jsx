import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WebMercatorViewport } from 'deck.gl'
import assets from '../../fixtures/assets.json'
import farms from '../../layers/ghostWind/farms.json'

// A 1.8 s picture of what has just happened, drawn over the map when a What if button is pressed. It is a separate
// SVG overlay: it never waits for, or blocks, the result, and any click ends it. The shapes are stylised (labelled
// by their caption, not by data). Reduced motion shows the caption only. The map camera is not touched.
const MS = 1800
const CAPTIONS = {
  hormuz: 'Strait of Hormuz closed: gas prices jump',
  interconnector_trip: 'Norway-Britain cable down',
  nuclear_outage: 'French nuclear plants offline',
  scottish_storm: 'Storm over Scotland',
}
const NSL = [[6.6, 59.5], [2, 57.5], [-1.5, 55.1]] // Kvilldal to Blyth, as the cable runs
const FR_NUCLEAR = assets.filter((a) => ['Gravelines', 'Paluel', 'Flamanville'].includes(a.name))
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)

function mapBox() {
  let best = null
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect()
    if (!best || r.width * r.height > best.width * best.height) best = r
  }
  return best ?? { left: 0, top: 0, width: innerWidth, height: innerHeight }
}

function useProject() {
  const [p, setP] = useState(null)
  useEffect(() => {
    let raf
    const tick = () => {
      const v = window.lgViewState
      if (v) {
        const b = mapBox()
        const vp = new WebMercatorViewport({ ...v, width: b.width, height: b.height })
        setP({ project: (ll) => { const [x, y] = vp.project(ll); return [x + b.left, y + b.top] }, box: b })
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
  return p
}

// Corner inset for the Gulf, which is off the Europe map: two coasts, a barrier that closes, a tanker that stops.
function Hormuz({ t, box }) {
  const w = Math.min(230, box.width - 24), x0 = box.left + box.width - w - 12, y0 = box.top + (box.width < 700 ? 116 : 84)
  const close = ease((t - 0.2) / 0.35)
  const tank = (1 - ease((t - 0.05) / 0.4)) * 0.55 // moves in, then stops at the barrier
  return (
    <g transform={`translate(${x0} ${y0})`}>
      <rect width={w} height="96" rx="12" fill="#121211" opacity=".88" />
      <path d={`M0 22 Q${w * 0.35} 30 ${w * 0.5} 40`} stroke="#c9a46a" strokeWidth="14" fill="none" strokeLinecap="round" />
      <path d={`M${w} 76 Q${w * 0.6} 70 ${w * 0.5} 60`} stroke="#c9a46a" strokeWidth="14" fill="none" strokeLinecap="round" />
      <line x1={w * 0.5} y1={40 + 0} x2={w * 0.5} y2={40 + 20 * close} stroke="#c8322e" strokeWidth="5" strokeLinecap="round" />
      <g transform={`translate(${w * (0.18 + 0.3 * (1 - tank / 0.55)) - 14} 42)`}>
        <path d="M0 8h26l5 -5h-5v-4h-10v4h-16z" fill="#e6e6e0" /><rect x="3" y="-3" width="6" height="5" fill="#ee7d2c" />
      </g>
      <text x="10" y="90" fill="#aaa" fontSize="10" fontFamily="Inter, sans-serif">Persian Gulf (illustration)</text>
    </g>
  )
}

function Cable({ t, p }) {
  const pts = NSL.map(p.project)
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${q[1]}`).join(' ')
  const broken = t > 0.45
  const mid = pts[1]
  return (
    <g>
      <path d={d} fill="none" stroke={broken ? '#555' : '#e0c340'} strokeWidth={broken ? 3 : 5} strokeLinecap="round" opacity={broken ? 0.7 : 1} />
      {t > 0.35 && t < 0.8 && [0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1={mid[0]} y1={mid[1]} x2={mid[0] + Math.cos(i * 1.3) * 26 * (t - 0.35) * 4} y2={mid[1] + Math.sin(i * 1.3) * 26 * (t - 0.35) * 4}
          stroke="#fff6b0" strokeWidth="2" strokeLinecap="round" opacity={1 - (t - 0.35) * 2} />
      ))}
      {t > 0.4 && <circle cx={mid[0]} cy={mid[1]} r="8" fill="#c8322e" opacity={t < 0.7 ? 1 : 0.5} />}
    </g>
  )
}

function Reactors({ t, p }) {
  return (
    <g>
      {FR_NUCLEAR.map((a, i) => {
        const [x, y] = p.project(a.coord)
        const off = t > 0.25 + i * 0.22
        return <circle key={a.name} cx={x} cy={y} r={9 + Math.sqrt(a.mw) / 40} fill={off ? '#3a3a3a' : '#b78cf0'} stroke={off ? '#777' : '#eadbff'} strokeWidth="1.5" style={{ transition: 'fill .3s' }} />
      })}
    </g>
  )
}

function Storm({ t, p }) {
  const [x, y] = p.project([-4.2, 57.4])
  const lit = Math.min(farms.length, Math.floor(t * 2.2 * farms.length))
  return (
    <g>
      <g transform={`translate(${x} ${y}) rotate(${t * 540})`} opacity={0.9 - 0.3 * t}>
        {[0, 1, 2].map((k) => <path key={k} d="M0 0 C14 -8 34 -4 44 14 M0 0" fill="none" stroke="#dff" strokeWidth="3" strokeLinecap="round" transform={`rotate(${k * 120}) scale(${1 + t * 1.2})`} />)}
      </g>
      {farms.map((f, i) => {
        const [fx, fy] = p.project(f.coord)
        return <circle key={f.unit} cx={fx} cy={fy} r={4 + Math.sqrt(f.mw) / 6} fill={i < lit ? '#5ed6c4' : '#4a5258'} stroke="#e6fffa" strokeWidth="1.2" />
      })}
    </g>
  )
}

const SHAPES = { hormuz: Hormuz, interconnector_trip: Cable, nuclear_outage: Reactors, scottish_storm: Storm }

// Mount with key={press id}; `id` is the scenario pressed. Ends by itself after 1.8 s or on any click.
export default function Intro({ id, onDone }) {
  const [t, setT] = useState(0)
  const done = useRef(onDone)
  const p = useProject()
  const still = reduced()
  useEffect(() => {
    const t0 = performance.now()
    let raf
    const tick = () => {
      const x = window.lgIntroAt != null ? window.lgIntroAt / MS : (performance.now() - t0) / MS // a test pins the clock for stills
      if (x >= 1) return done.current?.()
      setT(x)
      raf = requestAnimationFrame(tick)
    }
    if (still) {
      const h = setTimeout(() => done.current?.(), MS)
      return () => clearTimeout(h)
    }
    raf = requestAnimationFrame(tick)
    const stop = () => done.current?.()
    addEventListener('pointerdown', stop, { once: true, capture: true })
    return () => { cancelAnimationFrame(raf); removeEventListener('pointerdown', stop, { capture: true }) }
  }, [still])
  useEffect(() => {
    if (!still) return undefined
    const stop = () => done.current?.()
    addEventListener('pointerdown', stop, { once: true, capture: true })
    return () => removeEventListener('pointerdown', stop, { capture: true })
  }, [still])

  const Shape = SHAPES[id]
  if (!Shape || !CAPTIONS[id]) return null
  return createPortal(
    <div className="wi-intro" aria-live="polite">
      {!still && p && <svg className="wi-intro-svg" width="100%" height="100%" aria-hidden="true"><Shape t={t} p={p} box={p.box} /></svg>}
      <div className="wi-intro-cap">{CAPTIONS[id]}</div>
      <style>{`
        .wi-intro { position: fixed; inset: 0; z-index: 6; pointer-events: none; }
        .wi-intro-svg { position: absolute; inset: 0; }
        .wi-intro-cap { position: absolute; left: 50%; top: 72px; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 8px 16px; border-radius: 999px; background: rgba(18,18,17,.92); color: #f4f4f0; font-size: 14px; font-weight: 600; text-align: center; animation: wi-cap .25s ease-out; }
        @keyframes wi-cap { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
      `}</style>
    </div>,
    document.body
  )
}
