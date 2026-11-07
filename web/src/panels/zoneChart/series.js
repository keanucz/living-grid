// Hourly history and forecasts straight from SpacetimeDB's SQL endpoint (same origin, /v1).
// Shared by the zone chart and the forecast ghost/scrubber (layers/ghost/series.js re-exports this module, so
// both use one cache).
const DB = '/v1/database/living-grid/sql'
const cache = new Map()

async function sql(q) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await fetch(DB, { method: 'POST', body: q, signal: ctrl.signal })
    if (!r.ok) return null
    const [res] = await r.json()
    const names = res.schema.elements.map((e) => e.name.some)
    return res.rows.map((row) => Object.fromEntries(row.map((v, i) => [names[i], Array.isArray(v) && v.length === 1 ? v[0] : v])))
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const iso = (us) => new Date(us / 1000).toISOString().replace('.000Z', 'Z')

// { actual: [{ts, value, unit}], forecast: [{ts, p10, p50, p90, made_at, horizon_h}] } sorted by ts, or null.
// Concurrent callers (the chart and the ghost layer) share one request per zone.
const inflight = new Map()

export function zoneSeries(zone, maxAgeMs = 60_000) {
  const hit = cache.get(zone)
  if (hit && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit.data)
  if (!inflight.has(zone)) inflight.set(zone, fetchSeries(zone).finally(() => inflight.delete(zone)))
  return inflight.get(zone)
}

async function fetchSeries(zone) {
  const [a, f] = await Promise.all([
    sql(`SELECT ts, value, unit FROM actual WHERE zone = '${zone}' AND series = 'price_da'`),
    sql(`SELECT ts, made_at, horizon_h, p10, p50, p90 FROM latest_forecast WHERE zone = '${zone}' AND target = 'price_da'`),
  ])
  if (!a && !f) return null
  const data = {
    actual: (a ?? []).map((r) => ({ ts: iso(r.ts), value: r.value, unit: r.unit })).sort((x, y) => x.ts.localeCompare(y.ts)),
    forecast: (f ?? [])
      .map((r) => ({ ts: iso(r.ts), made_at: iso(r.made_at), horizon_h: r.horizon_h, p10: r.p10, p50: r.p50, p90: r.p90 }))
      .sort((x, y) => x.ts.localeCompare(y.ts)),
  }
  cache.set(zone, { at: Date.now(), data })
  return data
}
