// Generation by type for one zone and day: the fuel order and colours are fixed so a bar means the same thing everywhere.
// GET /generation?zone=&date= (engine, #370) answers { zone, date, unit:'MW', source, as_of, estimated, hours:[{ ts, mw:{fuel:MW}, imports_mw, pumped_mw, demand_mw }] }.
// Until the endpoint answers, a labelled sample with the same shape is shown, never passed off as real.
export const FUELS = [
  { id: 'nuclear', label: 'Nuclear', color: '#a78bfa' },
  { id: 'wind', label: 'Wind', color: '#5ed6c4' },
  { id: 'solar', label: 'Solar', color: '#facc15' },
  { id: 'hydro', label: 'Hydro', color: '#60a5fa' },
  { id: 'biomass', label: 'Biomass', color: '#84a35b' },
  { id: 'gas', label: 'Gas', color: '#ff8a1f' },
  { id: 'coal', label: 'Coal', color: '#8b6f5a' },
  { id: 'oil', label: 'Oil', color: '#c2410c' },
  { id: 'other', label: 'Other', color: '#6b7280' },
]
export const ZONES = ['GB', 'FR', 'DE-LU', 'NL', 'BE', 'NO2']
export const STORM_DAY = '2026-10-26'
const PLACE = { GB: 'Britain', FR: 'France', 'DE-LU': 'Germany', NL: 'the Netherlands', BE: 'Belgium', NO2: 'southern Norway' }
export const placeName = (z) => PLACE[z] ?? z

export const todayUtc = () => new Date().toISOString().slice(0, 10)
export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

export function dayLabel(date) {
  const t = todayUtc()
  if (date === t) return 'today'
  if (date === addDays(t, -1)) return 'yesterday'
  if (date === STORM_DAY) return 'on the 26 October storm day'
  return `on ${new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
}

const cache = new Map()
async function fetchReal(zone, date) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch(`/api/generation?zone=${encodeURIComponent(zone)}&date=${date}`, { signal: ctrl.signal })
    if (!res.ok) return null
    const j = await res.json()
    return Array.isArray(j?.hours) && j.hours.length ? j : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function loadGeneration(zone, date) {
  const key = `${zone}|${date}`
  if (!cache.has(key)) {
    cache.set(key, fetchReal(zone, date).then((real) => {
      const out = real ? { ...real, sample: false } : sampleDay(zone, date)
      if (!real) cache.delete(key)
      return out
    }))
  }
  return cache.get(key)
}

// Hours as 24 slots (null = not published yet), plus per-hour totals.
export function slots(g) {
  const by = new Map((g?.hours ?? []).map((h) => [new Date(h.ts ?? h.t).getUTCHours(), h]))
  return Array.from({ length: 24 }, (_, h) => {
    const r = by.get(h)
    if (!r) return null
    const mw = Object.fromEntries(FUELS.map((f) => [f.id, Math.max(0, Number(r.mw?.[f.id]) || 0)]))
    return { h, mw, total: Object.values(mw).reduce((a, b) => a + b, 0), imports: Number(r.imports_mw) || 0, pumped: Number(r.pumped_mw) || 0, demand: r.demand_mw ?? r.load_mw ?? null }
  })
}

export function totals(g) {
  const s = slots(g).filter(Boolean)
  const sum = Object.fromEntries(FUELS.map((f) => [f.id, s.reduce((a, r) => a + r.mw[f.id], 0)]))
  const all = Object.values(sum).reduce((a, b) => a + b, 0)
  return { sum, all, hours: s.length }
}

// One plain sentence, weather-report voice: "Gas made 69% of Britain's power today; wind 3%."
export function sentence(g, zone, date) {
  const { sum, all, hours } = totals(g)
  if (!all) return `No generation figures published ${dayLabel(date)} for ${placeName(zone)} yet.`
  const pct = (id) => Math.round((sum[id] / all) * 100)
  const top = FUELS.slice().sort((a, b) => sum[b.id] - sum[a.id])[0]
  const poss = placeName(zone).endsWith('s') ? `${placeName(zone)}’` : `${placeName(zone)}’s`
  const second = top.id === 'wind' ? FUELS.filter((f) => f.id !== 'wind').sort((a, b) => sum[b.id] - sum[a.id])[0] : FUELS[1]
  const part = hours < 24 ? ` (${hours} hours so far)` : ''
  return `${top.label} made ${pct(top.id)}% of ${poss} power ${dayLabel(date)}; ${second.label.toLowerCase()} ${pct(second.id)}%${part}.`
}

// ---- sample (same shape as the endpoint) ---------------------------------------------------------------------------
const BASE = {
  GB: { nuclear: 4500, wind: 7000, solar: 2500, hydro: 400, biomass: 2000, gas: 11000, coal: 0, oil: 0, other: 700 },
  FR: { nuclear: 38000, wind: 4500, solar: 5500, hydro: 6500, biomass: 900, gas: 2800, coal: 100, oil: 300, other: 800 },
  'DE-LU': { nuclear: 0, wind: 14000, solar: 9000, hydro: 2200, biomass: 4500, gas: 7500, coal: 12000, oil: 300, other: 1800 },
  NL: { nuclear: 400, wind: 3200, solar: 2600, hydro: 0, biomass: 500, gas: 5200, coal: 800, oil: 0, other: 700 },
  BE: { nuclear: 2800, wind: 1400, solar: 1500, hydro: 100, biomass: 500, gas: 2300, coal: 0, oil: 0, other: 400 },
  NO2: { nuclear: 0, wind: 900, solar: 0, hydro: 6800, biomass: 0, gas: 100, coal: 0, oil: 0, other: 50 },
}
const seed = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
export function sampleDay(zone, date) {
  const r0 = seed(zone + date)
  const storm = date === STORM_DAY
  const hours = Array.from({ length: 24 }, (_, h) => {
    const mw = {}
    FUELS.forEach((f, i) => {
      const b = (BASE[zone] ?? BASE.GB)[f.id]
      const wob = 1 + 0.18 * Math.sin((h + (r0 % 7) + i * 2) / 3.6)
      let v = b * wob
      if (f.id === 'solar') v = b * Math.max(0, Math.sin(((h - 5.5) / 13) * Math.PI)) * 1.6
      if (f.id === 'wind' && storm && zone === 'GB') v = b * 2.6 * (1 + 0.1 * Math.sin(h / 2))
      if (f.id === 'gas' && storm && zone === 'GB') v = b * (h > 15 && h < 21 ? 0.9 : 0.35)
      mw[f.id] = Math.round(v)
    })
    return { ts: `${date}T${String(h).padStart(2, '0')}:00:00Z`, mw, imports_mw: Math.round((BASE[zone]?.gas ?? 3000) * 0.18), pumped_mw: 0, demand_mw: null }
  })
  return { zone, date, unit: 'MW', source: 'sample shape', as_of: null, estimated: true, hours, sample: true }
}
