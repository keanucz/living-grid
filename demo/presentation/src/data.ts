import raw from '../data/snapshot.json'

// Every figure in the deck comes through here, from data/snapshot.json (scripts/snapshot.mjs). A figure carries where it
// came from, so a scene can show its source and nothing is typed by hand. A figure the snapshot lacks is null, and the
// scene shows a dash and says so, rather than inventing a number.
type Item = { url: string; status: number; fetched_at: string; body?: any; error?: string }
const snapshot = raw as unknown as { generated_at: string; api: string; items: Record<string, Item>; hub: any; weather_v2?: any }

export type Fig = { v: number | null; unit: string; src: string; at: string }

export const generatedAt = snapshot.generated_at
export const body = (name: string): any => snapshot.items[name]?.body

function fig(name: string, pick: (b: any) => unknown, unit = ''): Fig {
  const it = snapshot.items[name]
  let v: number | null = null
  try {
    const x = it?.body ? pick(it.body) : null
    v = typeof x === 'number' && Number.isFinite(x) ? x : null
  } catch {
    v = null
  }
  const path = it ? it.url.replace(snapshot.api, '') : name
  return { v, unit, src: path, at: it?.fetched_at ?? snapshot.generated_at }
}

const gb = (b: any) => b.zones.find((z: any) => z.zone === 'GB')
const hormuz = (b: any) => b.scenarios.find((s: any) => s.key === 'hormuz' || s.result?.request?.type === 'hormuz').result

export const F = {
  gbPrice: () => fig('state', (b) => gb(b).price.value, '£/MWh'),
  gbForecastP50: () => fig('state', (b) => gb(b).forecast.p50, '£/MWh'),
  gbForecastP10: () => fig('state', (b) => gb(b).forecast.p10, '£/MWh'),
  gbForecastP90: () => fig('state', (b) => gb(b).forecast.p90, '£/MWh'),
  gbCarbonProduced: () => fig('state', (b) => gb(b).carbon.production_gco2_kwh, 'g/kWh'),
  gbCarbonConsumed: () => fig('state', (b) => gb(b).carbon.consumption_gco2_kwh, 'g/kWh'),
  maeModel: () => fig('scores', (b) => b.headline.mae_model),
  maePersistence: () => fig('scores', (b) => b.headline.mae_persistence),
  maeImprovementPct: () => fig('scores', (b) => (1 - b.headline.mae_model / b.headline.mae_persistence) * 100, '%'),
  coverage: () => fig('scores', (b) => b.headline.coverage_p10_p90 * 100, '%'),
  forecastsScored: () => fig('scores', (b) => b.headline.forecasts_scored),
  batteryShare: () => fig('scores', (b) => b.headline.battery_share_of_perfect * 100, '%'),
  hormuzCostGbp: () => fig('scenarios', (b) => hormuz(b).cost_total_gbp, '£'),
  hormuzGbDelta: () => fig('scenarios', (b) => hormuz(b).zones.find((z: any) => z.zone === 'GB').avg_delta, '£/MWh'),
  hormuzGasPct: () => fig('scenarios', (b) => hormuz(b).applied_magnitude, '%'),
  hormuzDays: () => fig('scenarios', (b) => hormuz(b).applied_hours / 24, 'days'),
  windSwitchedOffMwh: () => fig('ghostWind', (b) => b.total_boalf_mwh, 'MWh'),
  constraintTotalGbp: () => fig('ghostWind', (b) => b.constraint_cost_total_gbp, '£'),
  stormConstraintGbp: () => fig('replay', (b) => b.constraint_cost_gbp, '£'),
  weatherPriceCutPct: (): Fig => ({ v: typeof snapshot.weather_v2?.price_da_mae_change_pct === 'number' ? -snapshot.weather_v2.price_da_mae_change_pct : null, unit: '%', src: snapshot.weather_v2?.source ?? 'weather_v2', at: snapshot.generated_at }),
  weatherWindCutPct: (): Fig => ({ v: typeof snapshot.weather_v2?.wind_mae_change_pct === 'number' ? -snapshot.weather_v2.wind_mae_change_pct : null, unit: '%', src: snapshot.weather_v2?.source ?? 'weather_v2', at: snapshot.generated_at }),
  weatherPriceZones: (): string | null => (snapshot.weather_v2?.price_zones ? `${snapshot.weather_v2.price_zones_better} of ${snapshot.weather_v2.price_zones}` : null),
  batteryHours: (): number | null => body('scores')?.headline?.battery_hours ?? null,
  weatherFolds: (): number | null => snapshot.weather_v2?.folds ?? null,
  weatherWindow: (): string | null => snapshot.weather_v2?.window ?? null,
  hubMerged: (): Fig => ({ v: snapshot.hub?.merged_tasks ?? null, unit: 'tasks', src: 'hub.db', at: snapshot.hub?.fetched_at ?? snapshot.generated_at }),
  hubAgents: (): Fig => ({ v: snapshot.hub?.agents ?? null, unit: 'agents', src: 'hub.db', at: snapshot.hub?.fetched_at ?? snapshot.generated_at }),
}

export const wallet: string | null = body('commitments')?.wallet ?? null
export const commitments: any[] = body('commitments')?.records ?? []

export function zonePrices(): { zone: string; price: number | null; unit: string }[] {
  return (body('state')?.zones ?? []).map((z: any) => ({ zone: z.zone, price: z.price?.value ?? null, unit: z.price?.unit ?? '' }))
}

/** The 26 October replay for one zone and target: hours with actual and the as-of P10/P50/P90. */
export function replaySeries(zone = 'GB', target = 'price_da'): { hour: number; actual: number | null; p10: number; p50: number; p90: number }[] {
  const s = body('replay')?.series?.find((x: any) => x.zone === zone && x.target === target)
  return (s?.points ?? []).map((p: any, i: number) => ({ hour: i, actual: p.actual, p10: p.p10, p50: p.p50, p90: p.p90 }))
}

export const fmt = {
  n: (v: number | null, d = 0) => (v == null ? '–' : v.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d })),
  gbp: (v: number | null) => (v == null ? '–' : `£${fmt.n(Math.round(v))}`),
  /** £143m, £1.8bn: for large bills */
  bigGbp2: (v: number | null) => (v == null ? '–' : `£${(v / 1e9).toFixed(2)}bn`),
  bigGbp: (v: number | null) => (v == null ? '–' : Math.abs(v) >= 1e9 ? `£${(v / 1e9).toFixed(1)}bn` : `£${(v / 1e6).toFixed(Math.abs(v) >= 1e8 ? 0 : 1)}m`),
  pct: (v: number | null, d = 0) => (v == null ? '–' : `${v.toFixed(d)}%`),
}
