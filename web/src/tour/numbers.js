// Live figures for tour captions. `loadTourData()` fetches what the captions need once; `fill(step, data)` swaps each
// {token} for a formatted figure. If any token a caption uses cannot be worked out, the step's `fallback` is used, so a
// caption never shows a dash or an invented number. Every token says where its figure comes from.
const hourIso = (h) => {
  const d = new Date(Date.now() + h * 3600e3)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString().replace('.000Z', 'Z')
}

async function get(path, ms = 12000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(`/api${path}`, { signal: ctrl.signal })
    return r.ok ? await r.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

export async function loadTourData(region = 'C') {
  const [now, ahead, scores, ghost, scen, reveal, replay, explain, dc, home] = await Promise.all([
    get('/state'), get(`/state?at=${hourIso(6)}`), get('/scores', 30000), get('/unseen/ghost-wind'), get('/scenarios'), get('/reveal'),
    get('/replay?event=2026-10-26', 20000), get(`/explain?zone=GB&ts=${hourIso(6)}`), get('/datacentre?locations=GB'),
    get(`/household/savings?region=${region}&devices=ev`),
  ])
  return { now, ahead, scores, ghost, scen, reveal, replay, explain, dc, home }
}

const zone = (state, z) => state?.zones?.find((x) => x.zone === z)
const pounds = (v) => `£${Math.round(v).toLocaleString('en-GB')}`
const euros = (v) => `€${Math.round(v).toLocaleString('en-GB')}`
const big = (v, sym = '£') => {
  const a = Math.abs(v)
  return a >= 1e9 ? `${sym}${(a / 1e9).toFixed(2)}bn` : a >= 1e6 ? `${sym}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}m` : `${sym}${Math.round(a).toLocaleString('en-GB')}`
}
const pct = (v) => `${Math.round(v * 100)}%`
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strategyShare = (battery, name) => {
  const v = (battery ?? []).filter((b) => b.strategy === name).map((b) => b.share_of_perfect).filter((x) => num(x) != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

// token -> (data) => string | null
export const TOKENS = {
  // Elexon and Nord Pool day-ahead price for GB; Energy-Charts / Nord Pool for NO2, as served by /state.
  gb_price: ({ now }) => (num(zone(now, 'GB')?.price?.value) != null ? pounds(zone(now, 'GB').price.value) : null),
  no2_price: ({ now }) => (num(zone(now, 'NO2')?.price?.value) != null ? euros(zone(now, 'NO2').price.value) : null),
  flows_gw: ({ now }) => (now?.flows?.length ? `${(now.flows.reduce((a, f) => a + Math.abs(f.mw || 0), 0) / 1000).toFixed(1)} GW` : null),
  // Our as-of forecast for the hour six ahead, GB day-ahead price: median and P10 to P90.
  gb_p6: ({ ahead }) => (num(zone(ahead, 'GB')?.forecast?.p50) != null ? pounds(zone(ahead, 'GB').forecast.p50) : null),
  gb_band: ({ ahead }) => {
    const f = zone(ahead, 'GB')?.forecast
    return num(f?.p10) != null && num(f?.p90) != null ? `${pounds(f.p10)} and ${pounds(f.p90)}` : null
  },
  explain_sentence: ({ explain }) => explain?.sentence ?? null,
  // NESO constraint costs (daily actuals) summed over the days /unseen/ghost-wind returns.
  ghost_from: ({ ghost }) => (ghost?.constraint_costs?.length ? day(ghost.constraint_costs[0].date) : null),
  ghost_to: ({ ghost }) => (ghost?.constraint_costs?.length ? day(ghost.constraint_costs.at(-1).date) : null),
  ghost_bill: ({ ghost }) => (ghost?.constraint_costs?.length ? big(ghost.constraint_costs.reduce((a, c) => a + c.gbp, 0)) : null),
  // Modelled consumption-based carbon intensity, GB (IPCC lifecycle emission factors).
  gb_prod: ({ now }) => (num(zone(now, 'GB')?.carbon?.production_gco2_kwh) != null ? `${Math.round(zone(now, 'GB').carbon.production_gco2_kwh)}` : null),
  gb_cons: ({ now }) => (num(zone(now, 'GB')?.carbon?.consumption_gco2_kwh) != null ? `${Math.round(zone(now, 'GB').carbon.consumption_gco2_kwh)} grams` : null),
  // NESO day-ahead boundary flow forecasts (via /unseen/ghost-wind): B6 across southern Scotland when it is in the data,
  // otherwise the fullest boundary. The row nearest the current hour.
  b6_line: ({ ghost }) => {
    const rows = (ghost?.boundary_flows ?? []).filter((b) => num(b.flow_mw) != null && num(b.limit_mw) > 0)
    if (!rows.length) return null
    const nearest = (list) => list.reduce((a, b) => (Math.abs(Date.parse(b.ts) - Date.now()) < Math.abs(Date.parse(a.ts) - Date.now()) ? b : a))
    const b6 = rows.filter((b) => /^B6$/i.test(b.boundary))
    const near = b6.length ? nearest(b6) : nearest(rows.filter((b) => Math.abs(Date.parse(b.ts) - Date.now()) <= 3 * 3600e3).sort((a, b) => b.flow_mw / b.limit_mw - a.flow_mw / a.limit_mw).slice(0, 1).concat(nearest(rows)).slice(0, 1))
    return `NESO’s day-ahead forecast has the ${near.boundary} boundary carrying ${(near.flow_mw / 1000).toFixed(1)} GW against a limit of ${(near.limit_mw / 1000).toFixed(1)} GW. When the wind outruns a limit like that, farms are paid to stop.`
  },
  // NESO's constraints figure for 26 October (engine/reference fact con_2026_10_26_cost: £36,530,868.70).
  storm_cost: () => '£36.5m',
  // Hours of the replay day whose actual landed inside the model's P10-P90, over all series (engine.replay).
  storm_inside: ({ replay }) => {
    const pts = (replay?.series ?? []).flatMap((s) => s.points).filter((p) => p.actual != null)
    return pts.length ? `${pts.filter((p) => p.actual >= p.p10 && p.actual <= p.p90).length} of ${pts.length}` : null
  },
  // POST /intervene result for the Strait of Hormuz default (+40% gas for two weeks), via /scenarios.
  hormuz_cost: ({ scen }) => {
    const r = scen?.scenarios?.find((s) => s.key === 'hormuz')?.result
    return num(r?.cost_total_gbp?.p50) != null ? big(r.cost_total_gbp.p50) : null
  },
  hormuz_gb: ({ scen }) => {
    const gb = scen?.scenarios?.find((s) => s.key === 'hormuz')?.result?.zones?.find((z) => z.zone === 'GB')
    return num(gb?.avg_delta) != null ? `by about ${pounds(gb.avg_delta)} a megawatt-hour` : null
  },
  // /scores battery comparison: mean share of perfect-foresight profit across zones.
  battery_risk: ({ scores }) => (strategyShare(scores?.battery, 'risk_aware') != null ? pct(strategyShare(scores.battery, 'risk_aware')) : null),
  battery_median: ({ scores }) => (strategyShare(scores?.battery, 'median_only') != null ? pct(strategyShare(scores.battery, 'median_only')) : null),
  // GET /datacentre, GB, 1,000 H100 at 60% utilisation (modelled; wholesale energy only).
  dc_line: ({ dc }) => {
    const s = dc?.sites?.[0]
    return s?.energy ? `A thousand H100 GPUs in Britain would draw ${(s.annual_mwh / 1000).toFixed(1)} GWh a year and cost about ${big(s.energy.cost_local)} in wholesale energy. Modelled, not a quote.` : null
  },
  // /scores headline: the walk-forward backtest and the live count.
  forecasts_scored: ({ scores }) => (num(scores?.headline?.forecasts_scored) != null ? `${scores.headline.forecasts_scored}` : null),
  mae_model: ({ scores }) => (num(scores?.headline?.mae_model) != null ? scores.headline.mae_model.toFixed(1) : null),
  mae_persistence: ({ scores }) => (num(scores?.headline?.mae_persistence) != null ? scores.headline.mae_persistence.toFixed(1) : null),
  coverage: ({ scores }) => (num(scores?.headline?.coverage_p10_p90) != null ? pct(scores.headline.coverage_p10_p90) : null),
  // /reveal: when Monday's forecast was frozen, and the result if the auction has published.
  frozen_at: ({ reveal }) => (reveal?.frozen_at ? `${new Date(reveal.frozen_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC` : null),
  reveal_line: ({ reveal }) => {
    if (!reveal) return null
    return reveal.zones_published > 0 && num(reveal.mean_abs_error) != null
      ? `${reveal.zones_published} zones have published and the average miss was ${reveal.mean_abs_error.toFixed(1)}.`
      : 'The real result arrives when the auction publishes.'
  },
  // /household/savings: tonight's cheapest EV window and its saving against Ofgem's price cap, which can be negative.
  tonight_line: ({ home }) => {
    const t = home?.tonight?.find((x) => x.device === 'ev')
    if (!t || num(t.saving_vs_cap_gbp?.p50) == null) return null
    const at = new Date(t.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
    const s = t.saving_vs_cap_gbp.p50
    return s >= 0
      ? `Tonight the cheapest time to charge a car in ${home.name} starts at ${at}, and saves about £${s.toFixed(2)} against the price cap.`
      : `Tonight the cheapest time to charge a car in ${home.name} starts at ${at}, but even that is about £${Math.abs(s).toFixed(2)} dearer than the price cap.`
  },
}

export function tokensIn(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
}

// The caption to show: tokens filled in, or the fallback if any is missing. Returns { text, live }.
export function fill(step, data) {
  const names = tokensIn(step.caption)
  if (!names.length) return { text: step.caption, live: false }
  const got = Object.fromEntries(names.map((n) => [n, data ? TOKENS[n]?.(data) ?? null : null]))
  if (Object.values(got).some((v) => v == null)) return { text: step.fallback ?? step.caption.replace(/\{\w+\}/g, '').replace(/\s+/g, ' ').trim(), live: false }
  return { text: step.caption.replace(/\{(\w+)\}/g, (_, n) => got[n]), live: true }
}
