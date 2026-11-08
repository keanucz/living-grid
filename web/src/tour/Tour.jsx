import { useEffect, useState } from 'react'
import { back, next, skip, startFromHash, stepsOf } from './engine.js'
import { useTour } from './state.js'

const OFFLINE = import.meta.env.VITE_LG_OFFLINE === '1'

// The element(s) carrying data-tour=<id>. Panels are wrapped in display:contents, so the box is their children's union.
function boxOf(id) {
  for (const el of document.querySelectorAll(`[data-tour="${CSS.escape(id)}"]`)) {
    const kids = getComputedStyle(el).display === 'contents' ? [...el.children] : [el]
    const rs = kids.map((k) => k.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
    if (!rs.length) continue
    const l = Math.min(...rs.map((r) => r.left))
    const t = Math.min(...rs.map((r) => r.top))
    return { l, t, w: Math.max(...rs.map((r) => r.right)) - l, h: Math.max(...rs.map((r) => r.bottom)) - t }
  }
  return null
}

// The nearest ancestor that actually scrolls (on phones the section sheet scrolls, not the window).
function scroller(el) {
  for (let e = el?.parentElement; e && e !== document.body; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY
    if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1) return e
  }
  return null
}

// While a step is up, once its target exists and has stopped moving (sections open and panels load after apply), scroll
// its container so the target sits in the middle of what is visible there, or its top at the top when it is taller than
// that. Only when part of it is hidden; at most three times a step, a second apart, so late-loading panels are followed
// without fighting a viewer who scrolls. useBox re-measures as it scrolls.
const MAX_SCROLLS = 3
function useScrollIntoView(id) {
  useEffect(() => {
    if (!id) return
    let last = null
    let still = 0
    let done = 0
    let lastAt = 0
    let jump = null
    const h = setInterval(() => {
      const box = boxOf(id)
      if (!box) return (last = null)
      // Its top settling is enough: a result panel that keeps growing below (a count-up, a chart) should not hold it back.
      still = last && Math.abs(last.t - box.t) < 1 ? still + 1 : 0
      last = box
      if (still < 2 || Date.now() - lastAt < 1000) return
      const el = document.querySelector(`[data-tour="${CSS.escape(id)}"]`)
      const sc = scroller(el?.firstElementChild ?? el)
      const view = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight }
      const top = Math.max(0, view.top)
      const bottom = Math.min(innerHeight, view.bottom)
      const room = bottom - top
      const tall = box.h > room
      if (tall ? Math.abs(box.t - top - 8) < 24 : box.t >= top - 1 && box.t + box.h <= bottom + 1) return
      const delta = tall ? box.t - top - 8 : box.t + box.h / 2 - (top + room / 2)
      const target = sc ?? document.scrollingElement
      const from = target.scrollTop
      target.scrollBy({ top: delta, behavior: 'smooth' })
      // Some browsers drop smooth scrolls on a busy page: jump if nothing moved.
      clearTimeout(jump)
      jump = setTimeout(() => Math.abs(target.scrollTop - from) < 1 && target.scrollBy({ top: delta }), 700)
      lastAt = Date.now()
      if (++done >= MAX_SCROLLS) clearInterval(h)
    }, 150)
    return () => (clearInterval(h), clearTimeout(jump))
  }, [id])
}

function useBox(id) {
  const [box, setBox] = useState(null)
  useEffect(() => {
    if (!id) return setBox(null)
    const tick = () =>
      setBox((old) => {
        const b = boxOf(id)
        return !b || (old && ['l', 't', 'w', 'h'].every((k) => Math.abs(old[k] - b[k]) < 1)) ? (b ? old : null) : b
      })
    tick()
    const h = setInterval(tick, 200)
    return () => clearInterval(h)
  }, [id])
  return box
}

function useLive(step) {
  const [vals, setVals] = useState({})
  useEffect(() => {
    setVals({})
    if (!step?.live || OFFLINE) return
    let on = true
    for (const [k, spec] of Object.entries(step.live)) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 4000)
      fetch(`/api${spec.path}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j) => on && setVals((v) => ({ ...v, [k]: spec.get(j) })))
        .catch(() => {})
        .finally(() => clearTimeout(timer))
    }
    return () => { on = false }
  }, [step])
  return vals
}

function caption(step, vals) {
  return step.say.replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? step.live?.[k]?.fallback ?? '')
}

export default function Tour() {
  const tour = useTour()
  useEffect(() => { startFromHash() }, [])
  const steps = tour ? stepsOf(tour.name) : []
  const step = steps[tour?.i]
  const target = step && (step.target ?? step.panel)
  const box = useBox(target)
  useScrollIntoView(tour ? target : null)
  const vals = useLive(step)

  useEffect(() => {
    if (!tour) return
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') back()
      else if (e.key === 'Escape') skip()
      else return
      e.preventDefault()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [tour])

  useEffect(() => {
    if (!tour?.autoplay || !step) return
    const h = setTimeout(next, (step.duration ?? 8) * 1000)
    return () => clearTimeout(h)
  }, [tour, step])

  useEffect(() => {
    document.documentElement.dataset.tourStep = step?.id ?? ''
  }, [step])

  if (!tour || !step || tour.clean) return null
  const pad = 6
  const low = box && box.t + box.h / 2 > innerHeight * 0.55
  const wide = innerWidth > 700
  const cardAt = wide ? { right: 20, [low ? 'bottom' : 'top']: low ? 20 : 88 } : { left: 8, right: 8, [low ? 'top' : 'bottom']: low ? 52 : 64 }

  return (
    <div className="tour" role="dialog" aria-label={`${step.id}: tour`} data-tour-step={step.id}>
      {box && <div className="tour-ring" style={{ left: box.l - pad, top: box.t - pad, width: box.w + 2 * pad, height: box.h + 2 * pad }} />}
      <div className={`tour-card ${wide ? '' : 'sheet'}`} style={cardAt}>
        <p>{caption(step, vals)}</p>
        {!tour.autoplay && (
          <div className="tour-foot">
            <span className="tour-dots" aria-label={`Step ${tour.i + 1} of ${steps.length}`}>
              {steps.map((s, k) => <i key={s.id} className={k === tour.i ? 'on' : k < tour.i ? 'done' : ''} />)}
            </span>
            <span style={{ flex: 1 }} />
            <button className="tour-skip" onClick={skip}>Skip</button>
            <button className="tour-btn" onClick={back} disabled={tour.i === 0}>Back</button>
            <button className="tour-btn primary" onClick={next} autoFocus>{tour.i === steps.length - 1 ? 'Done' : 'Next'}</button>
          </div>
        )}
      </div>
      <style>{STYLE}</style>
    </div>
  )
}

const STYLE = `
.tour { position: fixed; inset: 0; z-index: 60; pointer-events: none; }
.tour-ring { position: fixed; border-radius: 14px; border: 2px solid var(--accent); box-shadow: 0 0 0 4px rgba(197,240,107,.18), 0 0 0 9999px rgba(8,8,8,.38);
  transition: all .35s ease; }
.tour-card { position: fixed; width: 340px; padding: 14px 16px; border-radius: 14px; pointer-events: auto; background: var(--panel-solid);
  border: 1px solid var(--line-2); box-shadow: 0 12px 40px rgba(0,0,0,.5); }
.tour-card.sheet { width: auto; }
.tour-card p { margin: 0 0 12px; line-height: 1.45; font-size: 14px; }
.tour-foot { display: flex; align-items: center; gap: 8px; }
.tour-dots { display: flex; gap: 4px; }
.tour-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); }
.tour-dots i.done { background: var(--text-2); }
.tour-dots i.on { background: var(--accent); }
.tour-skip { color: var(--text-2); font-size: 12px; padding: 6px 4px; }
.tour-btn { font-size: 12px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--text-3); color: var(--text); }
.tour-btn:disabled { opacity: .35; }
.tour-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
`
