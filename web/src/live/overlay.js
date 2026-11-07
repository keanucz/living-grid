// Pure helpers: turn rows cached from the SpacetimeDB tables into the fields the map state needs.
// Timestamps are microseconds since the Unix epoch (numbers). Nothing here touches the network or the store.

const HOUR = 3600e3
const TOLERANCE_H = 3

export const hourMs = (iso) => {
  const t = iso ? Date.parse(iso) : Date.now()
  return Math.floor(t / HOUR) * HOUR
}

// Latest row per key with ts in (hour - tolerance, hour], preferring an exact hour.
function latestAt(rows, hour) {
  let best = null
  for (const r of rows) {
    const t = r.ts / 1000
    if (t > hour || t <= hour - TOLERANCE_H * HOUR) continue
    if (!best || t > best.ts / 1000) best = r
  }
  return best
}

export function buildOverlay(rows, atIso, now = Date.now()) {
  const hour = hourMs(atIso)
  const byZone = {}
  const bucket = (z) => (byZone[z] ??= { price: [], load: [], gen: {}, carbon: [], forecast: [] })
  for (const a of rows.actual) {
    if (a.series === 'price_da') bucket(a.zone).price.push(a)
    else if (a.series === 'load') bucket(a.zone).load.push(a)
    else if (a.series.startsWith('gen_')) (bucket(a.zone).gen[a.series.slice(4)] ??= []).push(a)
  }
  for (const c of rows.carbon) bucket(c.zone).carbon.push(c)
  for (const f of rows.latestForecast) if (f.target === 'price_da' || f.target === 'gb_system_price') bucket(f.zone).forecast.push(f)

  const out = {}
  for (const [zone, b] of Object.entries(byZone)) {
    const p = latestAt(b.price, hour)
    const load = latestAt(b.load, hour)
    const carbon = latestAt(b.carbon, hour)
    const mix = {}
    for (const [fuel, list] of Object.entries(b.gen)) {
      const g = latestAt(list, hour)
      if (g) mix[fuel] = g.value
    }
    const future = b.forecast.filter((f) => f.ts / 1000 >= hour && f.made_at / 1000 <= now)
    // The first forecast hour at or after the shown hour, day-ahead price preferred, newest run first.
    future.sort((x, y) => x.ts - y.ts || (x.target === 'price_da' ? -1 : 1) - (y.target === 'price_da' ? -1 : 1) || y.made_at - x.made_at)
    const f = future[0]
    out[zone] = {
      price: p && { value: p.value, unit: p.unit, ts: p.ts / 1000 },
      load_mw: load?.value ?? null,
      mix_mw: mix,
      carbon: carbon && {
        production_gco2_kwh: carbon.production_gco2_kwh,
        consumption_gco2_kwh: carbon.consumption_gco2_kwh,
        imports_share: carbon.imports_share,
        kind: 'modelled',
      },
      forecast: f && { p10: f.p10, p50: f.p50, p90: f.p90, made_at: new Date(f.made_at / 1000).toISOString(), horizon_h: f.horizon_h, target: f.target, kind: 'forecast' },
    }
  }
  return out
}

// Overwrite the price, load, mix, carbon and forecast of a normalised /state with what the tables hold.
// Zones the tables have no price for are left as the API (or fixture) gave them. Flows are not in the overlay.
export function applyOverlay(state, overlay, { gbpEur, groupMix }) {
  if (!state || !overlay) return state
  const zones = state.zones.map((z) => {
    const o = overlay[z.zone]
    if (!o?.price) return z
    const gbp = o.price.unit?.startsWith('GBP')
    return {
      ...z,
      currency: gbp ? 'GBP' : 'EUR',
      price: o.price.value,
      price_eur: gbp ? o.price.value * gbpEur : o.price.value,
      price_kind: 'actual',
      demand_mw: o.load_mw ?? z.demand_mw,
      mix: Object.keys(o.mix_mw).length ? groupMix(o.mix_mw) : z.mix,
      carbon: o.carbon ?? z.carbon,
      forecast: o.forecast ?? z.forecast,
      live: true,
    }
  })
  return { ...state, zones, source: 'live' }
}
