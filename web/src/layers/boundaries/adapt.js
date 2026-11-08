// Maps the engine's GET /infrastructure body (InfrastructureResponse, #184/#202) to the shape the map layer and the
// Infrastructure view read. Path geometry stays client side. Numbers the engine did not send stay null, never 0.
const GEO = {
  SCOTEX: { from: 'Scotland', to: 'England', path: [[-3.6, 54.95], [-2.6, 55.12], [-1.7, 55.2]] },
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const urlIn = (s) => (typeof s === 'string' ? s.match(/\((https?:\/\/[^)\s]+)\)/)?.[1] ?? null : null)
const nameIn = (s) => (typeof s === 'string' ? s.replace(/\s*\(https?:\/\/[^)]*\)/, '').trim() : '')
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return 'source page'
  }
}

export const isEngineShape = (d) =>
  Array.isArray(d?.boundaries) && d.boundaries.every((b) => typeof b?.boundary === 'string' && num(b.median_limit_mw) != null) &&
  Array.isArray(d?.interconnectors) && Array.isArray(d?.planned_links) && Array.isArray(d?.counterfactual?.scenarios)

export function adapt(d) {
  const to = d.window?.to ? new Date(d.window.to) : null
  const from = d.window?.from ? new Date(d.window.from) : null
  const date = to ? to.toISOString().slice(0, 10) : null
  const days = to && from ? Math.max(1, Math.round((to - from) / 864e5)) : 7
  const cc = d.constraint_costs
  const cf = d.counterfactual
  const first = cf.scenarios[0]
  const flowSrc = { name: nameIn(d.boundary_source) || 'NESO day-ahead constraint flows and limits', url: urlIn(d.boundary_source), date }
  const boundaries = d.boundaries.map((b) => {
    const geo = GEO[b.boundary] ?? {}
    const isCf = b.boundary === cf.boundary
    return {
      id: b.boundary,
      // The engine's plain name (#271); the NESO code only when it has none.
      name: b.name ?? b.boundary,
      code: b.boundary,
      etys: b.etys_boundary ?? null,
      from: geo.from ?? null,
      to: geo.to ?? null,
      path: geo.path ?? null,
      capacity_mw: num(b.median_limit_mw),
      flow_mw: num(b.mean_flow_mw),
      util: num(b.mean_utilisation),
      over_share: num(b.hours_over_limit_share),
      overload_mwh: num(b.overload_mwh),
      cost_gbp_window: null,
      wind_curtailed_mwh_window: isCf ? num(first?.scotland_wind_switched_off_mwh) : null,
      source: flowSrc,
      counterfactual: isCf
        ? [{ add_mw: 0, cost_saved_gbp: 0, wind_saved_mwh: 0 }, ...cf.scenarios.map((s) => ({
            add_mw: num(s.extra_mw), cost_saved_gbp: num(s.avoided_cost_gbp), wind_saved_mwh: num(s.avoided_wind_mwh),
          }))].filter((r) => r.add_mw != null && r.cost_saved_gbp != null && r.wind_saved_mwh != null)
        : [],
      cf: isCf
        ? { cost_total_gbp: num(cc?.thermal_cost_gbp), cost_days: num(first?.avoided_cost_days), wind_total_mwh: num(first?.scotland_wind_switched_off_mwh), estimate: true }
        : null,
    }
  })
  const interconnectors = d.interconnectors.map((l) => ({
    id: l.zone,
    zone: l.zone,
    name: l.name,
    from: 'Britain',
    to: l.name ?? l.zone,
    capacity_mw: num(l.capacity_mw),
    flow_mw: num(l.mean_import_mw) == null ? null : -l.mean_import_mw, // view: positive is GB to the far end
    util: num(l.import_utilisation),
    full_import_share: num(l.hours_full_import_share),
    full_export_share: num(l.hours_full_export_share),
    source: { name: d.interconnector_basis, url: null, date },
  }))
  const planned = d.planned_links.map((p) => ({
    id: p.id, name: p.name, capacity_mw: num(p.capacity_mw), expected_year: p.operational ?? null, status: p.status,
    source: { name: host(p.source), url: p.source, date: null },
  }))
  const q = d.connections_queue
  const notes = [d.note]
  if (q) {
    notes.push(`NESO's new connections pipeline (${q.as_of}): ${q.new_pipeline_generation_storage_gw} GW of generation and storage and ${q.new_pipeline_demand_gw} GW of demand, down from a queue of ${q.before_reform_gw} GW. Source: ${q.source}`)
  }
  return { sample: !!d.sample, window_days: days, boundaries, interconnectors, planned, notes: notes.filter(Boolean) }
}
