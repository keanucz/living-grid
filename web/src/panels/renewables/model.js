// Pure pieces of the renewables card, so they can be checked without a browser.
import { compass, sample } from '../../layers/wind/grid.js'

// What the modelled weather says at a zone's centroid: wind speed (m/s), the direction it blows from, sunshine (W/m2).
export function weatherAt(field, centroid) {
  if (!field || !centroid) return null
  const [lon, lat] = centroid
  const speed = sample(field, field.speed, lon, lat)
  const u = sample(field, field.u, lon, lat)
  const v = sample(field, field.v, lon, lat)
  const sun = sample(field, field.sw, lon, lat)
  if (!Number.isFinite(speed)) return null
  const fromDeg = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360
  return { speed, fromDeg, from: compass(fromDeg), sun: Number.isFinite(sun) ? sun : null }
}

const SYM = { GBP: '£', EUR: '€' }
export const money = (v, currency, digits = 0) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${SYM[currency] ?? ''}${Math.abs(v).toFixed(digits)}`

const compact = (v) => (Math.abs(v) >= 1e6 ? `${(Math.abs(v) / 1e6).toFixed(1)}m` : Math.abs(v) >= 1e3 ? `${Math.round(Math.abs(v) / 1e3)}k` : String(Math.round(Math.abs(v))))

// A one-line reading of the estimated merit-order effect for the card: negative means prices were lower.
export function effectLine(impact, kind) {
  const m = impact?.[`${kind}_mean_effect_per_mwh`]
  if (m == null || !Number.isFinite(m)) return null
  const per = impact[`${kind}_per_gw`]
  const total = impact[`${kind}_total_money`]
  const cur = impact.currency
  return {
    mean: m,
    text: `${kind === 'wind' ? 'Wind' : 'Sun'} ${m <= 0 ? 'lowered' : 'raised'} the price by ${money(Math.abs(m), cur, Math.abs(m) < 10 ? 1 : 0).replace(/^[+−]/, '')}/MWh on average`,
    perGw: per == null ? null : `${money(per, cur, 1)}/MWh per extra GW`,
    total: total == null ? null : `${total < 0 ? '−' : '+'}${SYM[cur] ?? ''}${compact(total)} over the window`,
  }
}

// Sparkline geometry: price as a line, wind output as bars behind it, one marker for the hour on the map.
export function spark(hours, atIso, w = 320, h = 70) {
  const rows = (hours ?? []).filter((x) => Number.isFinite(x.price))
  if (rows.length < 2) return null
  const px = rows.map((x) => x.price)
  const lo = Math.min(...px)
  const hi = Math.max(...px)
  const wmax = Math.max(1, ...rows.map((x) => x.wind_mw ?? 0))
  const sx = (i) => (i / (rows.length - 1)) * w
  const sy = (p) => h - 4 - ((p - lo) / (hi - lo || 1)) * (h - 10)
  const marker = atIso ? rows.findIndex((x) => x.ts === atIso) : -1
  return {
    line: rows.map((x, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)} ${sy(x.price).toFixed(1)}`).join(''),
    bars: rows.map((x, i) => ({ x: sx(i), h: ((x.wind_mw ?? 0) / wmax) * (h - 6) })),
    marker: marker >= 0 ? sx(marker) : null,
    lo,
    hi,
    w,
    h,
  }
}
