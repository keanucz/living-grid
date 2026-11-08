import { useEffect, useMemo, useRef, useState } from 'react'
import { DeckGL, FirstPersonView, LineLayer, ScatterplotLayer, COORDINATE_SYSTEM } from 'deck.gl'
import { getState, setState } from '../store/store.js'
import { matchView, redirectOf } from '../views/index.js'
import { line, pointOn } from './pylon.js'
import { IS_PHONE, OVERVIEW, SITE, markSeen, seen } from './route.js'

// First visit only: look up at a pylon, rise to the cross-arms, follow the conductors, then match-cut into the map at the
// same place and pull back to Europe. ~5 s, any click or key skips. The map loads underneath, so nothing waits.
// Timeline (s): 0 to 1.8 rise · 1.8 to 2.6 pitch forward along the line · 2.6 to 3.0 cross-fade into the map ·
// 3.0 to 5.0 fly out to the overview, title fades in and out.
const END = 5
const LIME = [197, 240, 107]
const ease = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)
const lerp = (a, b, u) => a + (b - a) * u
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const view = new FirstPersonView({ id: 'pylon', fovy: 72, near: 0.5, far: 5200 })

function webgl() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function wanted(force) {
  const h = location.hash
  if (h.startsWith('#tour=')) return false
  if (matchView(h) || redirectOf(h)) return false
  return force || h === '#intro' || !seen()
}

const camera = (detail) => dispatchEvent(new CustomEvent('lg-camera', { detail }))

// The camera: rise along the tower looking up, then level out and fly down the line.
function pose(t) {
  const up = ease(clamp01(t / 1.8))
  const fwd = ease(clamp01((t - 1.8) / 0.8))
  return {
    longitude: SITE.longitude,
    latitude: SITE.latitude,
    position: [0, lerp(-16, -10, up) + fwd * 70 + Math.max(0, t - 2.6) * 60, lerp(2, 40, up)],
    bearing: 0,
    pitch: lerp(lerp(78, 46, up), -2, fwd),
  }
}

export default function Intro() {
  const [mode, setMode] = useState(() => (wanted(false) ? (reduced() || !webgl() ? 'plain' : 'deck') : null))
  const [t, setT] = useState(0)
  const done = useRef(false)
  const flown = useRef(false)
  const welcome = useRef(false) // the welcome waits for the intro, then appears as it would have
  const world = useMemo(() => (mode === 'deck' ? line(IS_PHONE ? 9 : 14) : null), [mode])

  useEffect(() => {
    const again = (force) => {
      if (mode || !wanted(force)) return
      done.current = false
      flown.current = false
      setT(0)
      setMode(reduced() || !webgl() ? 'plain' : 'deck')
    }
    const onEvent = () => again(true)
    const onHash = () => location.hash === '#intro' && again(true)
    addEventListener('lg-intro', onEvent)
    addEventListener('hashchange', onHash)
    return () => {
      removeEventListener('lg-intro', onEvent)
      removeEventListener('hashchange', onHash)
    }
  }, [mode])

  const finish = (skipped) => {
    if (done.current) return
    done.current = true
    markSeen()
    setState({ intro: false, welcome: welcome.current })
    if (location.hash === '#intro') history.replaceState(null, '', `${location.pathname}${location.search}#/`)
    if (skipped || !flown.current) camera({ ...OVERVIEW, duration: skipped ? 700 : 1200 })
    setMode(null)
  }

  useEffect(() => {
    if (!mode) return
    welcome.current = !!getState().welcome
    setState({ intro: true, welcome: false })
    const startMap = mode === 'deck' ? setTimeout(() => camera({ ...SITE, duration: 0 }), 60) : null
    const length = mode === 'plain' ? 1.2 : END
    const t0 = performance.now()
    let raf
    const tick = () => {
      const s = (performance.now() - t0) / 1000
      setT(s)
      if (mode === 'deck' && s >= 3 && !flown.current) {
        flown.current = true
        camera({ ...OVERVIEW, duration: 2000 })
      }
      if (s >= length) return finish(false)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const skip = () => finish(true)
    addEventListener('keydown', skip)
    return () => {
      clearTimeout(startMap)
      cancelAnimationFrame(raf)
      removeEventListener('keydown', skip)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  if (!mode) return null
  const veil = mode === 'plain' ? 1 - clamp01((t - 0.7) / 0.5) : 1 - clamp01((t - 2.6) / 0.4)
  const title = mode === 'plain' ? clamp01(t / 0.3) * (1 - clamp01((t - 0.9) / 0.3)) : clamp01((t - 3.2) / 0.6) * (1 - clamp01((t - 4.4) / 0.5))

  const layers = world
    ? [
        new LineLayer({
          id: 'pylon-glow', data: world.seg, coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS, coordinateOrigin: [SITE.longitude, SITE.latitude, 0],
          getSourcePosition: (d) => d.a, getTargetPosition: (d) => d.b, getColor: [...LIME, 70], getWidth: 10, widthUnits: 'pixels',
        }),
        new LineLayer({
          id: 'pylon-line', data: world.seg, coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS, coordinateOrigin: [SITE.longitude, SITE.latitude, 0],
          getSourcePosition: (d) => d.a, getTargetPosition: (d) => d.b, getColor: (d) => (d.conductor ? [...LIME, 255] : [205, 240, 130, 255]), getWidth: (d) => (d.conductor ? 2.2 : 1.8), widthUnits: 'pixels',
        }),
        new ScatterplotLayer({
          id: 'pylon-pulses', data: Array.from({ length: IS_PHONE ? 8 : 24 }, (_, k) => k), coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS, coordinateOrigin: [SITE.longitude, SITE.latitude, 0],
          getPosition: (k) => pointOn(world.conductors, k, (t * 0.2 + k / 24) % 1), getRadius: 3.2, radiusUnits: 'pixels', getFillColor: [255, 255, 255, 255],
          updateTriggers: { getPosition: [t] },
        }),
      ]
    : []

  return (
    <div className="intro" data-tour="intro" role="presentation" onPointerDown={() => finish(true)} style={{ opacity: veil }}>
      {mode === 'deck' && <DeckGL views={view} viewState={{ pylon: pose(Math.min(t, 3.1)) }} controller={false} layers={layers} style={{ position: 'absolute', inset: 0 }} />}
      <div className="intro-title" style={{ opacity: title }}>This is the living grid of Europe</div>
      <button className="intro-skip" onClick={() => finish(true)} style={{ opacity: veil }}>Skip</button>
      <style>{`
        .intro { position: fixed; inset: 0; z-index: 70; background: radial-gradient(ellipse at 50% 100%, #10150c 0%, #070807 70%); cursor: pointer; }
        .intro-title { position: absolute; left: 0; right: 0; top: 42%; text-align: center; padding: 0 24px; font-size: clamp(26px, 5vw, 54px);
          font-weight: 500; letter-spacing: -0.02em; color: #f2f5ea; text-shadow: 0 2px 30px rgba(0,0,0,.8); pointer-events: none; }
        .intro-skip { position: absolute; right: 18px; bottom: 18px; font-size: 12px; color: var(--text-2); padding: 6px 10px; border-radius: 8px; border: 1px solid var(--text-3); }
      `}</style>
    </div>
  )
}
