import { api } from '../api/client.js'
import { actions, getState, setState } from '../store/store.js'
import { openSection, sectionById } from '../shell/sections.js'
import { TOURS } from './tours.js'
import { getTour, save, saved, setTour } from './state.js'

const hourIso = (offsetH) => {
  const d = new Date(Date.now() + offsetH * 3600e3)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString().replace('.000Z', 'Z')
}
let ranEvent = false
let seq = 0
export const CAMERA = { home: 'home' }

// Where a step leaves the camera: its own camera (null = the map's home view), else its section's view (the section's
// mode: flat for overview, tilted for simulate). Pages and the Play section have no map, so no camera.
function aimOf(step) {
  if (!step || step.page) return null
  if (step.camera !== undefined) return step.camera ?? CAMERA.home
  const mode = sectionById[step.section]?.mode
  return mode ? { mode } : null
}

// Every step entry, forwards or backwards, ends with the camera at the step's view (MapView, 'lg-camera'). Forwards it
// flies from wherever the camera is, so a half-finished move is picked up, never left mid-way. Backwards it first
// snaps to the previous step's view, so the step's own move (Proof un-tilting after What if, say) plays again. A
// newer step cancels an older step's pending move. The request is also left on window for a map that mounts late
// (coming back from a page such as Play).
function aim(steps, i, backwards) {
  const to = aimOf(steps[i])
  const n = ++seq
  if (!to) return
  const from = backwards && i > 0 ? aimOf(steps[i - 1]) : null
  const detail = { to, from, duration: 2000 }
  setTimeout(() => {
    if (n !== seq) return
    window.lgPendingCamera = { detail, at: performance.now() }
    dispatchEvent(new CustomEvent('lg-camera', { detail }))
  }, 150)
}

export const stepsOf = (name) => TOURS[name]?.steps ?? []

// Put the app where the step says: page or section, then layers, time and event.
export async function apply(step) {
  setState({ welcome: false })
  if (step.page) {
    if (location.hash !== step.page) location.hash = step.page
    return
  }
  if (step.section && sectionById[step.section]) openSection(step.section)
  if (step.layers) setState({ layers: { ...getState().layers, ...step.layers } })
  if (step.at != null) actions.setAt(step.at === 'now' ? null : /^[+-]\d+$/.test(step.at) ? hourIso(Number(step.at)) : step.at)
  if (step.event) {
    const sc = (await api.scenarios()).data?.[step.event.id]
    actions.armScenario(step.event.id)
    actions.runScenario(step.event.id, step.event.magnitude ?? sc?.magnitude)
    ranEvent = true
  } else if (ranEvent) {
    actions.clearScenario()
    ranEvent = false
  }
}

export function go(i) {
  const t = getTour()
  if (!t) return
  const steps = stepsOf(t.name)
  if (i >= steps.length) return t.autoplay ? go(0) : finish()
  const next = { ...t, i: Math.max(0, i) }
  const backwards = next.i < t.i
  setTour(next)
  save(next)
  apply(steps[next.i])
  aim(steps, next.i, backwards)
}

export function start(name, { i = 0, autoplay = false, clean = false } = {}) {
  if (!TOURS[name]) return false
  setTour({ name, i: 0, autoplay, clean })
  go(i)
  return true
}
export const next = () => go((getTour()?.i ?? 0) + 1)
export const back = () => go((getTour()?.i ?? 0) - 1)

export function finish() {
  setTour(null)
  save(null)
  if (ranEvent) (actions.clearScenario(), (ranEvent = false))
}
export const skip = finish

// What the welcome offers: a fresh start, or the step the viewer reached last time.
export function resumable(name = 'main') {
  const s = saved()
  return s && s.name === name && s.i > 0 && s.i < stepsOf(name).length ? s : null
}

// #tour=<name>[&step=N][&autoplay][&clean] (clean: drive the app but draw no ring or caption, for screen recordings); the hash is cleared so the app's own hash routes keep working.
export function startFromHash() {
  const raw = location.hash.replace(/^#/, '')
  if (!raw.startsWith('tour=')) return false
  const q = new URLSearchParams(raw)
  history.replaceState(null, '', location.pathname + location.search + '#/')
  return start(q.get('tour'), { i: Number(q.get('step') ?? 0) || 0, autoplay: q.has('autoplay'), clean: q.has('clean') })
}
