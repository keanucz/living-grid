import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DeckGL, FirstPersonView, LineLayer, ScatterplotLayer, COORDINATE_SYSTEM } from 'deck.gl'
import { getState, setState } from '../store/store.js'
import { matchView, redirectOf } from '../views/index.js'
import { line, pointOn } from './pylon.js'
import { ARRIVE_AT, CAPTIONS, CROSSFADE, EDINBURGH_VIEW, IS_PHONE, OVERVIEW, SITE, TITLE_HOLD, TITLE_IN, ZOOM_OUT_AT, ZOOM_OUT_MS, markSeen, seen } from './route.js'

// First visit only: look up at a pylon, rise to the cross-arms, follow the conductors, then match-cut into the map at the
// same place. Then (#308, #317) the map turns north-up on a dot labelled Edinburgh, holds, and makes one smooth eased
// zoom-out to the six countries, with "Scotland" and "United Kingdom" fading in as the zoom passes them. Only once the
// camera has stopped does the title come in; it holds, then fades out while the welcome fades in. Any click or key skips
// straight to the welcome.
// Timeline (s): 0 to 1.8 rise · 1.8 to 2.6 pitch forward along the line · 2.6 to 3.0 cross-fade into the map ·
// 3.0 to 3.6 north-up on Edinburgh · hold to 4.8 · zoom out 4.8 to 7.8 · camera settles · title 0.5 s in, 1.5 s hold ·
// 0.4 s title fade-out, then the welcome (and the app UI) fade in: never both at once. About 10 s on a normal machine.
const END = 1.2 // the plain (reduced motion) version
const LATEST = 40 // s of intro time: a page this stalled lands on the overview and hands over regardless
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

// While the intro runs the app's own UI (top bar, headline, panels, legend; on the phone the top bar, layer chips,
// sheet and tabs) is hidden, so the map is clean; it fades back in with the welcome. The rule is added to <head> once
// so the fade-in still applies after the intro has gone.
const HIDE_CSS = `
:root[data-intro] .app .topbar, :root[data-intro] .app .headline, :root[data-intro] .app .slot, :root[data-intro] .app .legend,
:root[data-intro] .m-top, :root[data-intro] .m-layers, :root[data-intro] .m-sel, :root[data-intro] .m-sheet, :root[data-intro] .m-tabs {
  opacity: 0 !important; pointer-events: none !important; }
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-intro]) :is(.app .topbar, .app .headline, .app .slot, .app .legend, .m-top, .m-layers, .m-sel, .m-sheet, .m-tabs) { transition: opacity .5s ease; } }
`
function hideApp(on) {
  if (typeof document === 'undefined') return
  if (!document.getElementById('lg-intro-hide')) {
    const el = document.createElement('style')
    el.id = 'lg-intro-hide'
    el.textContent = HIDE_CSS
    document.head.appendChild(el)
  }
  if (on) document.documentElement.dataset.intro = '1'
  else delete document.documentElement.dataset.intro
}

function wanted(force) {
  const h = location.hash
  if (h.startsWith('#tour=')) return false
  if (matchView(h) || redirectOf(h)) return false
  return force || h === '#intro' || !seen()
}

// The app decides on the welcome when its module loads (main.jsx imports it before this one). When the intro will
// play, take that decision now, before anything renders, and hide the app's UI, so neither shows for a frame.
let startWelcome = null
if (typeof window !== 'undefined' && wanted(false)) {
  startWelcome = !!getState().welcome
  setState({ welcome: false })
  hideApp(true)
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
  const sent = useRef(0) // map moves already sent: 1 = Edinburgh, 2 = the zoom-out
  const [beat, setBeat] = useState({ zoomFrac: 0, title: 0 }) // how far out the zoom is (0 to 1), and the title's opacity
  const welcome = useRef(false) // the welcome waits for the intro, then appears as it would have
  const world = useMemo(() => (mode === 'deck' ? line(IS_PHONE ? 9 : 14) : null), [mode])

  useEffect(() => {
    const again = (force) => {
      if (mode || !wanted(force)) return
      done.current = false
      flown.current = false
      sent.current = 0
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
    hideApp(false) // the app's UI fades back in with the welcome
    setState({ intro: false, welcome: welcome.current })
    if (location.hash === '#intro') history.replaceState(null, '', `${location.pathname}${location.search}#/`)
    // Skipped, or ended before the zoom-out was sent: land on the overview rather than wherever the camera was.
    if (skipped || sent.current < 2) camera({ ...OVERVIEW, duration: skipped ? 700 : 1200 })
    setMode(null)
  }

  // A layout effect, so the welcome (set on load by the app) is hidden before the first paint instead of flashing.
  useLayoutEffect(() => {
    if (!mode) return
    welcome.current = startWelcome ?? !!getState().welcome
    startWelcome = null
    setState({ intro: 'pylon', welcome: false })
    hideApp(true)
    sent.current = mode === 'deck' ? 0 : 2
    const startMap = mode === 'deck' ? setTimeout(() => camera({ ...SITE, duration: 0 }), 60) : null
    let settledAt = null // intro time when the camera stopped on the overview
    let titleGone = false // a frame has been drawn with the title fully faded
    // Intro time advances with the frames, at most 0.25 s a frame, so a page that stalls while the map loads plays the
    // whole intro late rather than skipping it. The map part waits at the cross-fade until the map has loaded
    // (MapView's onLoad), since a camera set while deck is starting up is lost.
    let s = 0
    let last = performance.now()
    let raf
    const tick = (now) => {
      s += Math.min(0.25, Math.max(0, (now - last) / 1000))
      last = now
      const mapReady = window.lgMapReady && now - window.lgMapReady > 300
      if (mode === 'deck' && !mapReady) s = Math.min(s, 2.9)
      setT(s)
      if (mode === 'deck' && s >= 3 && !flown.current) {
        flown.current = true
        setState({ intro: 'map' })
      }
      if (mode === 'plain') {
        if (s >= END) return finish(false)
        raf = requestAnimationFrame(tick)
        return
      }
      if (sent.current === 0 && s >= ARRIVE_AT) {
        sent.current = 1
        camera({ ...EDINBURGH_VIEW, duration: 600 })
      }
      if (sent.current === 1 && s >= ZOOM_OUT_AT) {
        sent.current = 2
        camera({ ...OVERVIEW, duration: ZOOM_OUT_MS, interp: 'linear' })
      }
      const v = window.lgViewState
      const frac = v ? clamp01((EDINBURGH_VIEW.zoom - v.zoom) / (EDINBURGH_VIEW.zoom - OVERVIEW.zoom)) : 0
      if (sent.current === 2 && settledAt === null) {
        const there = v && Math.abs(v.zoom - OVERVIEW.zoom) < 0.02 && Math.abs(v.longitude - OVERVIEW.longitude) < 0.05 && Math.abs(v.latitude - OVERVIEW.latitude) < 0.05
        if (there || s > LATEST) {
          settledAt = s
          setState({ intro: 'title' }) // the Edinburgh dot goes, so the title stands alone
        }
      }
      let title = 0
      if (settledAt !== null) {
        const since = s - settledAt
        const out = since - TITLE_IN - TITLE_HOLD
        title = clamp01(since / TITLE_IN) * (1 - clamp01(out / CROSSFADE))
        // One after the other, never both: the title fades out fully, a frame is drawn without it, then finish() brings
        // the welcome (and the app's UI) in.
        if (out >= CROSSFADE) {
          if (titleGone) return finish(false)
          titleGone = true
        }
      }
      setBeat({ zoomFrac: sent.current === 2 ? frac : 0, title })
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
  const title = mode === 'plain' ? clamp01(t / 0.3) * (1 - clamp01((t - 0.9) / 0.3)) : beat.title
  // Each caption rises and falls around its share of the way out; gone by the time the camera stops.
  const captions = CAPTIONS.map(([text, peak]) => [text, beat.title > 0 ? 0 : clamp01(1 - Math.abs(beat.zoomFrac - peak) / 0.22) * 1.4])

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
    <div className="intro" data-tour="intro" role="presentation" onPointerDown={() => finish(true)}>
      {/* The pylon shot and its dark ground fade out at the cross-fade; the title and Skip stay above the map after it. */}
      <div className="intro-veil" style={{ opacity: veil }}>
        {mode === 'deck' && t < 3.1 && <DeckGL views={view} viewState={{ pylon: pose(Math.min(t, 3.1)) }} controller={false} layers={layers} style={{ position: 'absolute', inset: 0 }} />}
      </div>
      {captions.map(([text, o]) => <div key={text} className="intro-caption" style={{ opacity: Math.min(1, o) }}>{text}</div>)}
      <div className="intro-title" style={{ opacity: title }}>This is the living grid of Europe</div>
      <button className="intro-skip" onClick={() => finish(true)}>Skip</button>
      <style>{`
        .intro { position: fixed; inset: 0; z-index: 70; cursor: pointer; }
        .intro-veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 100%, #10150c 0%, #070807 70%); }
        .intro-title { position: absolute; left: 0; right: 0; top: 14%; text-align: center; padding: 0 24px; font-size: clamp(26px, 5vw, 54px);
          font-weight: 500; letter-spacing: -0.02em; color: #f2f5ea; text-shadow: 0 2px 30px rgba(0,0,0,.8); pointer-events: none; }
        .intro-caption { position: absolute; left: 0; right: 0; top: 18%; text-align: center; font-size: clamp(20px, 3.2vw, 32px); font-weight: 500;
          letter-spacing: -0.01em; color: #f2f5ea; text-shadow: 0 2px 24px rgba(0,0,0,.85); pointer-events: none; }
        .intro-skip { position: absolute; right: 18px; bottom: 18px; font-size: 13px; color: var(--text); padding: 8px 14px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--panel-solid); }
      `}</style>
    </div>
  )
}
