import { useEffect, useState } from 'react'
import mock from './infrastructure.mock.json'
import { adapt, isEngineShape } from './adapt.js'

// GET /infrastructure (#184, typed as InfrastructureResponse): adapt.js maps the engine's body to the shape the map layer
// and the view read. Until the endpoint answers with that shape (or if it is missing) the bundled sample is shown and
// the screens badge it as sample data. Shared by the map layer and the view.
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
    .then((body) => {
      if (!isEngineShape(body)) return Promise.reject(new Error('unexpected shape'))
      const data = adapt(body)
      set({ data, source: data.sample ? 'sample' : 'live', fetchedAt: Date.now(), loading: false })
    })
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

export const utilisation = (x) => {
  const u = x.util ?? (x.capacity_mw > 0 ? Math.abs(x.flow_mw ?? 0) / x.capacity_mw : 0)
  return Math.min(1.5, Math.max(0, u))
}

// Cost and wind saved at `addMw` extra capacity, interpolated between the API's scenarios (never extrapolated):
// returns null when the boundary has no counterfactual rows.
export function whatIf(boundary, addMw) {
  const rows = [...(boundary.counterfactual ?? [])].sort((a, b) => a.add_mw - b.add_mw)
  if (rows.length < 2) return null
  const x = Math.min(Math.max(addMw, rows[0].add_mw), rows[rows.length - 1].add_mw)
  const hi = rows.findIndex((r) => r.add_mw >= x)
  const b = rows[hi]
  const a = rows[Math.max(0, hi - 1)]
  const t = b.add_mw === a.add_mw ? 0 : (x - a.add_mw) / (b.add_mw - a.add_mw)
  const lerp = (k) => a[k] + (b[k] - a[k]) * t
  return { addMw: x, costSaved: lerp('cost_saved_gbp'), windSaved: lerp('wind_saved_mwh'), maxMw: rows[rows.length - 1].add_mw }
}

const pct = (v) => `${Math.round(v * 100)}%`

// One plain line for a boundary or cable: over 100% reads as how often it was over its limit, never 'N% full' above 100.
export function plainStatus(row) {
  const u = utilisation(row)
  if (u > 1 && row.over_share != null) return `Over the limit in ${pct(row.over_share)} of hours`
  if (u > 1) return 'Over the limit on average'
  return `${pct(u)} full`
}

// 'Scotland to England' style direction, only when both ends are known (never 'null to null').
export function direction(row) {
  if (row.flow_mw == null || !row.from || !row.to) return ''
  return row.flow_mw >= 0 ? `${row.from} to ${row.to}` : `${row.to} to ${row.from}`
}
