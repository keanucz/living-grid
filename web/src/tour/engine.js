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
export const CAMERA = { home: { longitude: 3.6, latitude: 54.2, zoom: 3.15, pitch: 0, bearing: 0 } }

export const stepsOf = (name) => TOURS[name]?.steps ?? []

// Put the app where the step says: page or section, then layers, time and event.
export async function apply(step) {
  setState({ welcome: false })
  if (step.page) {
    if (location.hash !== step.page) location.hash = step.page
    return
  }
  if (step.section && sectionById[step.section]) openSection(step.section)
  if (step.camera !== undefined) setTimeout(() => dispatchEvent(new CustomEvent('lg-camera', { detail: step.camera ?? CAMERA.home })), 400)
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
  setTour(next)
  save(next)
  apply(steps[next.i])
}

export function start(name, { i = 0, autoplay = false } = {}) {
  if (!TOURS[name]) return false
  setTour({ name, i: 0, autoplay })
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

// #tour=<name>[&step=N][&autoplay]; the hash is cleared so the app's own hash routes keep working.
export function startFromHash() {
  const raw = location.hash.replace(/^#/, '')
  if (!raw.startsWith('tour=')) return false
  const q = new URLSearchParams(raw)
  history.replaceState(null, '', location.pathname + location.search + '#/')
  return start(q.get('tour'), { i: Number(q.get('step') ?? 0) || 0, autoplay: q.has('autoplay') })
}
