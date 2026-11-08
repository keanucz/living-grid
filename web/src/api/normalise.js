// Maps engine contract responses (engine/schemas.py, engine/contract/openapi.json) to the shapes the
// layers and panels use. Every field the engine may leave null is tolerated here so the UI never crashes.
const GBP_EUR = 1.15

// Nicer label positions than the raw centroids (GB label clear of the flows, NO2 inland).
const LABEL_AT = { GB: [-3.2, 54.6], NL: [5.6, 52.6], BE: [4.4, 50.5], NO2: [8.4, 60.4] }

const MIX_GROUPS = [
  [/consumption|load|import|export|cross_border/, null],
  [/wind/, 'wind'],
  [/solar/, 'solar'],
  [/nuclear/, 'nuclear'],
  [/coal|lignite/, 'coal'],
  [/gas/, 'gas'],
  [/hydro|pumped/, 'hydro'],
  [/biomass|biogas|waste/, 'biomass'],
]

export function groupMix(mixMw) {
  const out = {}
  for (const [k, v] of Object.entries(mixMw ?? {})) {
    if (!(v > 0)) continue
    const hit = MIX_GROUPS.find(([re]) => re.test(k))
    const g = hit ? hit[1] : 'other'
    if (g) out[g] = (out[g] ?? 0) + v
  }
  const total = Object.values(out).reduce((a, b) => a + b, 0)
  if (!total) return {}
  return Object.fromEntries(
    Object.entries(out)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, v / total]),
  )
}

const toEur = (value, unit) => (unit?.startsWith('GBP') ? value * GBP_EUR : value)

export function normaliseZones(c) {
  return {
    zones: (c.zones ?? []).map((z) => ({
      id: z.zone,
      name: z.name,
      currency: z.currency,
      centroid: z.centroid,
      label_at: LABEL_AT[z.zone] ?? z.centroid,
      approximate_border: z.approximate_border,
    })),
    interconnectors: (c.interconnectors ?? [])
      .filter((ic) => ic.in_v1 !== false)
      .map((ic) => ({
        id: ic.id,
        name: ic.name,
        from: ic.from_zone,
        to: ic.to_zone,
        capacity_mw: ic.capacity_mw,
        from_at: ic.from_coord ?? undefined,
        to_at: ic.to_coord ?? undefined,
      })),
    gb_regions: c.gb_regions ?? [],
    zones_geojson: c.zones_geojson ?? null,
  }
}

export function normaliseState(c, zones) {
  const icById = Object.fromEntries((zones?.interconnectors ?? []).map((ic) => [ic.id, ic]))
  // Flow mw signed relative to the interconnector's own from -> to.
  const flows = (c.flows ?? [])
    .filter((f) => f.mw != null)
    .map((f) => {
      const ic = icById[f.interconnector_id]
      const same = !ic || ic.from === f.from_zone
      return { interconnector: f.interconnector_id, mw: same ? f.mw : -f.mw, kind: f.kind, from_zone: f.from_zone, to_zone: f.to_zone, raw: f.mw }
    })
  const netImport = {}
  for (const f of flows) {
    netImport[f.to_zone] = (netImport[f.to_zone] ?? 0) + f.raw
    netImport[f.from_zone] = (netImport[f.from_zone] ?? 0) - f.raw
  }

  return {
    at: c.at,
    source: 'live',
    zones: (c.zones ?? [])
      .filter((z) => z.price?.value != null)
      .map((z) => {
        const unit = z.price.unit ?? 'EUR/MWh'
        return {
          zone: z.zone,
          currency: unit.startsWith('GBP') ? 'GBP' : 'EUR',
          price: z.price.value,
          price_eur: toEur(z.price.value, unit),
          price_kind: z.price.kind,
          change_24h_eur: null,
          demand_mw: z.load_mw ?? null,
          // /state carries only Britain's interconnectors, so a net figure is complete for GB alone; other zones'
          // cross-border flows (FR-DE, NL-BE, ...) are not in the payload, so leave theirs empty rather than partial.
          net_import_mw: flows.length && z.zone === 'GB' ? netImport[z.zone] ?? 0 : null,
          mix: groupMix(z.mix_mw),
          metered_as_of: z.metered_as_of ?? null,
          carbon: z.carbon ?? null,
          forecast: z.forecast ?? null,
          series: [],
        }
      }),
    flows: flows.map(({ interconnector, mw, kind }) => ({ interconnector, mw, kind })),
  }
}

const KIND = { hormuz: 'World event', interconnector_trip: 'Grid fault', nuclear_outage: 'Plant outage', scottish_storm: 'Weather', carbon_price: 'Market', cold_snap: 'Weather', wind: 'Weather' }
const UNIT = { hormuz: '% gas', interconnector_trip: 'MW lost', nuclear_outage: 'MW lost', scottish_storm: '% wind', carbon_price: '% carbon', cold_snap: '°C', wind: '% wind' }
const LINKS = {
  hormuz: ['ifa', 'ifa2', 'eleclink', 'britned'],
  interconnector_trip: ['nsl'],
  nuclear_outage: ['ifa', 'ifa2', 'eleclink', 'fr-be', 'fr-de'],
  scottish_storm: ['nsl', 'ifa'],
}

export function normaliseScenarios(c) {
  const out = {}
  for (const s of c.scenarios ?? []) {
    const r = s.result ?? {}
    const type = r.request?.type ?? s.key
    const zones = r.zones ?? []
    const delta = Object.fromEntries(zones.map((z) => [z.zone, toEur(z.avg_delta ?? 0, z.currency === 'GBP' ? 'GBP' : 'EUR')]))
    const focus = zones.reduce((best, z) => (Math.abs(delta[z.zone]) > Math.abs(delta[best] ?? 0) ? z.zone : best), 'GB')
    out[type] = {
      type,
      key: s.key,
      label: s.title ?? r.title,
      kind: KIND[type] ?? 'Event',
      summary: s.blurb ?? '',
      magnitude: r.applied_magnitude ?? r.request?.magnitude ?? 1,
      magnitude_unit: UNIT[type] ?? '',
      hours: r.applied_hours ?? r.request?.hours ?? 24,
      price_delta_eur: delta,
      cost_gbp: r.cost_total_gbp?.p50 ?? zones.reduce((a, z) => a + (z.cost_gbp ?? 0), 0),
      cost_band_gbp: r.cost_total_gbp ?? null,
      explanation: r.explanation?.sentence ?? '',
      winners: (r.winners ?? []).map((w) => w.who),
      losers: (r.losers ?? []).map((w) => w.who),
      battery: r.battery ?? [],
      ghost_wind_mwh: r.ghost_wind?.delta_mwh ?? null,
      focus: type === 'nuclear_outage' ? 'FR' : focus === 'NO2' ? 'GB' : focus,
      links: LINKS[type] ?? [],
      tripped: type === 'interconnector_trip' ? ['nsl'] : [],
      result: r,
    }
  }
  return out
}

// One POST /intervene result -> the scenario fields the map and impact card read (already at the chosen magnitude).
export function normaliseResult(r) {
  if (!r?.zones?.length) return null
  const delta = Object.fromEntries(r.zones.map((z) => [z.zone, toEur(z.avg_delta ?? 0, z.currency === 'GBP' ? 'GBP' : 'EUR')]))
  return {
    price_delta_eur: delta,
    cost_gbp: r.cost_total_gbp?.p50 ?? r.zones.reduce((a, z) => a + (z.cost_gbp ?? 0), 0),
    cost_band_gbp: r.cost_total_gbp ?? null,
    hours: r.applied_hours ?? r.request?.hours,
    explanation: r.explanation?.sentence ?? '',
    winners: (r.winners ?? []).map((w) => w.who),
    losers: (r.losers ?? []).map((w) => w.who),
    battery: r.battery ?? [],
    ghost_wind_mwh: r.ghost_wind?.delta_mwh ?? null,
    live: true,
  }
}
