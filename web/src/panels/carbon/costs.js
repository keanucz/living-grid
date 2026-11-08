import { useEffect, useState } from 'react'

// GET /carbon/costs (#187): carbon cost per MWh by zone for the latest hour, plus four earlier hours (6 h apart) for the
// over-time view. The panel shows what arrives; zones without a carbon price keep their intensity and show no cost.
const STEPS_H = [24, 18, 12, 6]
let state = { now: null, series: {}, status: 'idle', fetchedAt: 0 }
const listeners = new Set()
const set = (next) => {
  state = next
  listeners.forEach((f) => f(state))
}

async function get(at) {
  const r = await fetch(`/api/carbon/costs${at ? `?at=${encodeURIComponent(at)}` : ''}`)
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

export function buildSeries(bodies) {
  const out = {}
  for (const b of bodies) {
    for (const z of b?.zones ?? []) {
      if (z.carbon_cost_per_mwh == null) continue
      ;(out[z.zone] ??= []).push({ ts: z.ts, cost: z.carbon_cost_per_mwh })
    }
  }
  for (const rows of Object.values(out)) rows.sort((a, b) => new Date(a.ts) - new Date(b.ts))
  return out
}

export async function loadCosts() {
  if (state.status === 'loading' || Date.now() - state.fetchedAt < 10 * 60_000) return
  set({ ...state, status: 'loading', fetchedAt: Date.now() })
  try {
    const now = await get()
    const t = new Date(now.at).getTime()
    const earlier = await Promise.all(STEPS_H.map((h) => get(new Date(t - h * 3600e3).toISOString()).catch(() => null)))
    set({ now, series: buildSeries([...earlier.filter(Boolean), now]), status: 'live', fetchedAt: Date.now() })
  } catch {
    set({ ...state, status: state.now ? 'live' : 'missing' })
  }
}

export function useCarbonCosts() {
  const [s, setS] = useState(state)
  useEffect(() => {
    listeners.add(setS)
    loadCosts()
    return () => listeners.delete(setS)
  }, [])
  return s
}

const SYM = { GBP: '£', EUR: '€' }
export const sym = (cur) => SYM[cur] ?? ''
export const perMwh = (v, cur) => `${sym(cur)}${v.toFixed(v >= 100 ? 0 : 1)}`
export const perYear = (v, cur) => {
  const a = Math.abs(v)
  const s = sym(cur)
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}m`
  return `${s}${Math.round(a).toLocaleString('en-GB')}`
}
