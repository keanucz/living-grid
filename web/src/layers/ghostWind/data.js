import { useSyncExternalStore } from 'react'
import fixture from './fixture.json'

// Shared between the ghost wind layer and the constraint bill panel.
// Windows: the last 24 h (live), or the 26 October 2026 storm (the replay hero moment).
export const WINDOWS = {
  live: { label: 'Last 24 h' },
  storm: { label: '26 Oct storm', from: '2026-10-26T00:00:00Z', to: '2026-10-27T00:00:00Z' },
}

// NESO "Constraints" category for 26 Oct 2026 (engine/reference/facts/constraints.json, con_2026_10_26_cost).
export const STORM_CONSTRAINT_GBP = 36_530_869

let state = { window: null, data: null, source: null, loading: false, auto: false }
const subs = new Set()
const set = (patch) => {
  state = { ...state, ...patch }
  subs.forEach((f) => f())
}

async function fetchWindow(key) {
  const w = WINDOWS[key]
  const qs = w.from ? `?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}` : ''
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await fetch(`/api/unseen/ghost-wind${qs}`, { signal: ctrl.signal })
    return r.ok ? await r.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const total = (d) => (d?.total_boalf_mwh ?? 0) + (d?.total_weather_gap_mwh ?? 0)

export async function load(key, auto = false) {
  set({ window: key, loading: true, auto })
  let d = await fetchWindow(key)
  // Nothing switched off lately: show the storm rather than an empty map, and say so.
  if (key === 'live' && d && !total(d)) {
    const storm = await fetchWindow('storm')
    if (storm && total(storm)) return set({ window: 'storm', data: storm, source: 'live', loading: false, auto: true })
  }
  if (d) return set({ data: d, source: 'live', loading: false })
  set({ data: fixture, source: 'sample', loading: false })
}

export function getGhostWind() {
  return state
}

export function useGhostWind() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
  )
}
