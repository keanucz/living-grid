import { useCallback, useEffect, useRef, useState } from 'react'
import { setState } from '../../../store/store.js'
import Overlays, { overlayCss } from './overlays.jsx'

// Plays a scene once: a timeline of steps over `duration` ms, ending on a still. See the bus note for the format:
//   scene = { duration, caption, counter?: { label, from, to, at, dur, format }, steps: [...] }
//   step  = { at, camera, dur }            fly the map ('lg-camera')
//         | { at, layers }                 merge into the store's layer switches
//         | { at, overlay, kind, on, ...props }  show/hide an SVG overlay (overlays.jsx)
//         | { at, tween: { overlay, prop, from, to, dur } }  animate one overlay prop
//         | { at, caption }                swap the caption
//         | { at, count: { to, dur } }     (re)start the counter
// Reduced motion jumps to the end still (the final state of every step, no tweens, no camera fly).
// `end` marks the still: steps flagged { end: true } are the ones that define it when skipping; all steps are applied in order.
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const FORMATS = {
  gbp: (v) => (v >= 1e6 ? `£${(v / 1e6).toFixed(1)}m` : `£${Math.round(v / 1e3)}k`),
  gwh: (v) => `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} GWh`,
  int: (v) => String(Math.round(v)),
}
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

export default function SceneRunner({ scene: sceneProp, onDone, autoplay = true }) {
  // The scene is fixed when the runner mounts (a parent re-render must not restart it); change `key` to replay with new data.
  const [scene] = useState(sceneProp)
  const [items, setItems] = useState({})
  const [caption, setCaption] = useState(scene.caption ?? '')
  const [num, setNum] = useState(scene.counter ? scene.counter.from ?? 0 : null)
  const [phase, setPhase] = useState('idle') // idle | playing | done
  const raf = useRef(0)
  const run = useRef(0)

  const apply = useCallback((s) => {
    if (s.layers) setState((st) => ({ layers: { ...st.layers, ...s.layers } }))
    if (s.camera) dispatchEvent(new CustomEvent('lg-camera', { detail: { to: s.camera, duration: s.dur ?? 2200 } }))
    if (s.caption != null) setCaption(s.caption)
    if (s.overlay) {
      setItems((it) => {
        const next = { ...it }
        if (s.on === false) delete next[s.overlay]
        else {
          const { at: _a, overlay, on: _o, ...props } = s
          next[overlay] = { ...(it[overlay] ?? {}), ...props }
        }
        return next
      })
    }
  }, [])

  const finish = useCallback(() => {
    cancelAnimationFrame(raf.current)
    const last = scene.counter
    if (last) setNum(scene.steps.filter((s) => s.count).at(-1)?.count.to ?? last.to)
    // End still: every overlay step's final prop value and the last caption, without playing the camera moves.
    for (const s of scene.steps) if (!s.camera || reduced()) apply(s)
    for (const s of scene.steps) if (s.tween) apply({ overlay: s.tween.overlay, [s.tween.prop]: s.tween.to })
    for (const s of scene.steps) if (s.camera) apply({ camera: s.camera, dur: 0 })
    setPhase('done')
    onDone?.()
  }, [scene, apply, onDone])

  const play = useCallback(() => {
    cancelAnimationFrame(raf.current)
    const id = ++run.current
    setItems({})
    setCaption(scene.caption ?? '')
    setNum(scene.counter ? scene.counter.from ?? 0 : null)
    if (reduced()) return finish()
    setPhase('playing')
    const t0 = performance.now()
    const fired = new Set()
    const tweens = []
    let count = scene.counter ? { ...scene.counter } : null
    let cur = count?.from ?? 0
    const tick = () => {
      if (id !== run.current) return
      const t = window.lgSceneAt ?? performance.now() - t0 // lgSceneAt: a test sets the clock to take stills at fixed moments
      scene.steps.forEach((s, i) => {
        if (fired.has(i) || t < s.at) return
        fired.add(i)
        if (s.tween) tweens.push({ ...s.tween, t0: t })
        else if (s.count) count = { ...(count ?? {}), ...s.count, from: cur, at: t }
        else apply(s)
      })
      for (const w of tweens) {
        const v = w.from + (w.to - w.from) * ease((t - w.t0) / w.dur)
        setItems((it) => (it[w.overlay] ? { ...it, [w.overlay]: { ...it[w.overlay], [w.prop]: v } } : it))
      }
      if (count && t >= (count.at ?? 0)) {
        cur = (count.from ?? 0) + (count.to - (count.from ?? 0)) * ease((t - (count.at ?? 0)) / (count.dur ?? 3000))
        setNum(cur)
      }
      if (t >= scene.duration) return finish()
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }, [scene, apply, finish])

  useEffect(() => {
    if (autoplay) play()
    return () => { run.current++; cancelAnimationFrame(raf.current) }
  }, [play, autoplay])

  const fmt = FORMATS[scene.counter?.format ?? 'int']
  return (
    <div className="scene" data-phase={phase}>
      <Overlays items={items} />
      <div className="scene-hud" role="status" aria-live="polite">
        {scene.counter && <div className="scene-num"><span className="faint">{scene.counter.label}</span><b className="num">{fmt(num ?? 0)}</b></div>}
        <p className="scene-cap">{caption}</p>
        <div className="scene-btns">
          {phase === 'playing' && <button type="button" onClick={finish}>Skip</button>}
          {phase === 'done' && <button type="button" onClick={play}>Replay</button>}
        </div>
      </div>
      <style>{overlayCss}{`
        .scene { margin: 4px 0 8px; }
        .scene-hud { display: grid; gap: 6px; padding: 10px 12px; border-radius: 12px; background: var(--card-2); }
        .scene-num { display: flex; align-items: baseline; gap: 10px; }
        .scene-num b { font-size: 28px; color: var(--accent); line-height: 1; }
        .scene-cap { margin: 0; font-size: 14px; color: var(--text); min-height: 2.6em; }
        .scene-btns { display: flex; gap: 8px; }
        .scene-btns button { padding: 4px 12px; border-radius: 999px; background: var(--card); color: var(--text); font-size: 12px; }
      `}</style>
    </div>
  )
}
