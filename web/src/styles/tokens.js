import { scaleLinear } from 'd3-scale'
import { rgb } from 'd3-color'

// One fixed price scale for every zone and every hour (EUR/MWh), so colours are comparable.
const STOPS = [
  [-50, '#7b6cf6'],
  [-0.01, '#5146b8'],
  [0, '#1f3b2c'],
  [30, '#2f6a3a'],
  [60, '#7fa33a'],
  [80, '#d0b043'],
  [95, '#e08a2e'],
  [120, '#d4502e'],
  [200, '#9e1f2e'],
]
const scale = scaleLinear()
  .domain(STOPS.map((s) => s[0]))
  .range(STOPS.map((s) => s[1]))
  .clamp(true)

export function priceColor(eur, alpha = 230) {
  const c = rgb(scale(eur))
  return [c.r, c.g, c.b, alpha]
}

export const PRICE_LEGEND = STOPS.filter(([v]) => v >= 0 || v === -50).map(([v, c]) => ({ v, c }))

export const COLORS = {
  land: [31, 31, 30, 255],
  border: [52, 52, 50, 255],
  zoneBorder: [12, 12, 12, 255],
  accent: [197, 240, 107],
  hot: [255, 138, 31],
  danger: [240, 82, 64],
  wind: [94, 214, 196],
  nuclear: [167, 139, 250],
  gas: [255, 138, 31],
  hydro: [96, 165, 250],
}

export const fmt = {
  price: (v, cur) => `${cur === 'GBP' ? '£' : '€'}${v.toFixed(v >= 100 ? 0 : 1)}`,
  money: (v) => {
    const a = Math.abs(v)
    const s = v < 0 ? '−' : ''
    if (a >= 1e9) return `${s}£${(a / 1e9).toFixed(2)}bn`
    if (a >= 1e6) return `${s}£${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}m`
    if (a >= 1e3) return `${s}£${(a / 1e3).toFixed(0)}k`
    return `${s}£${a.toFixed(0)}`
  },
  gw: (mw) => `${(mw / 1000).toFixed(1)} GW`,
  signed: (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`,
}
