import { scaleLinear } from 'd3-scale'
import { rgb } from 'd3-color'

// Household price (p/kWh) on its own sequential scale, deliberately unlike the wholesale scale: dim indigo to bright ice-blue.
export const RAMP = ['#2c3b73', '#4f86d8', '#a6ecff']
const NEUTRAL = [120, 124, 132]

export function regionExtent(data) {
  const v = (data?.regions ?? []).map((r) => r.agile_now_p_kwh).filter(Number.isFinite)
  return v.length ? [Math.min(...v), Math.max(...v)] : null
}

export function regionColour(v, extent, alpha = 232) {
  if (!Number.isFinite(v) || !extent) return [...NEUTRAL, Math.round(alpha * 0.5)]
  const [lo, hi] = extent
  const mid = (lo + hi) / 2
  const c = rgb(scaleLinear().domain([lo, hi > lo ? mid : lo + 1, hi > lo ? hi : lo + 2]).range(RAMP).clamp(true)(v))
  return [c.r, c.g, c.b, alpha]
}
