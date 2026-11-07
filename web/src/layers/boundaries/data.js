import { useEffect, useState } from 'react'
import mock from './infrastructure.mock.json'

// GET /infrastructure (stefan-4, #184): boundaries and interconnectors with capacity, flow and cost over the last
// window, a counterfactual table per boundary, and planned links. Until the endpoint answers (or if it is missing)
// the bundled sample is shown and the screens badge it as sample data. Shared by the map layer and the view.
let state = { data: mock, source: 'sample', fetchedAt: 0, loading: false }
const listeners = new Set()
const set = (next) => {
  state = next
  listeners.forEach((f) => f(state))
}

export const getInfra = () => state

export function load() {
  if (state.loading || Date.now() - state.fetchedAt < 10 * 60_000) return
  set({ ...state, loading: true, fetchedAt: Date.now() })
  fetch('/api/infrastructure')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data) => (Array.isArray(data?.boundaries) ? set({ data, source: data.sample ? 'sample' : 'live', fetchedAt: Date.now(), loading: false }) : Promise.reject(new Error('unexpected shape'))))
    .catch(() => set({ ...state, loading: false }))
}

export function useInfra() {
  const [s, setS] = useState(state)
  useEffect(() => {
    listeners.add(setS)
    load()
    return () => listeners.delete(setS)
  }, [])
  return s
}

export const utilisation = (x) => (x.capacity_mw > 0 ? Math.min(1.5, Math.abs(x.flow_mw ?? 0) / x.capacity_mw) : 0)

// Remaining cost and wind at `addMw` extra capacity, interpolated between the API's rows (never extrapolated):
// returns null when the boundary has no counterfactual rows.
export function whatIf(boundary, addMw) {
  const rows = [...(boundary.counterfactual ?? [])].sort((a, b) => a.add_mw - b.add_mw)
  if (rows.length < 2) return null
  const base = rows.find((r) => r.add_mw === 0) ?? rows[0]
  const x = Math.min(Math.max(addMw, rows[0].add_mw), rows[rows.length - 1].add_mw)
  const hi = rows.findIndex((r) => r.add_mw >= x)
  const b = rows[hi]
  const a = rows[Math.max(0, hi - 1)]
  const t = b.add_mw === a.add_mw ? 0 : (x - a.add_mw) / (b.add_mw - a.add_mw)
  const lerp = (k) => a[k] + (b[k] - a[k]) * t
  const cost = lerp('cost_gbp_window')
  const wind = lerp('wind_curtailed_mwh_window')
  return {
    addMw: x,
    cost,
    wind,
    costSaved: base.cost_gbp_window - cost,
    windSaved: base.wind_curtailed_mwh_window - wind,
    maxMw: rows[rows.length - 1].add_mw,
  }
}
