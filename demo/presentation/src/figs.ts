import { body, generatedAt, replaySeries, type Fig } from './data'

// Extra figures for the scenes, all read from data/snapshot.json through body(). Same rule as data.ts: a figure the snapshot
// lacks is null and the scene shows a dash. `src` is the API path the figure came from.
const PATH: Record<string, string> = { zones: '/zones', state: '/state', scores: '/scores', replay: '/replay', scenarios: '/scenarios', carbon: '/unseen/carbon', household: '/household', datacentre: '/datacentre', reveal: '/reveal', commitments: '/commitments', ghostWind: '/unseen/ghost-wind' }

export function figOf(name: string, pick: (b: any) => unknown, unit = ''): Fig {
  let v: number | null = null
  try {
    const b = body(name)
    const x = b ? pick(b) : null
    v = typeof x === 'number' && Number.isFinite(x) ? x : null
  } catch {
    v = null
  }
  return { v, unit, src: PATH[name] ?? name, at: generatedAt }
}

export const text = (name: string, pick: (b: any) => unknown): string | null => {
  try {
    const x = body(name) ? pick(body(name)) : null
    return typeof x === 'string' ? x : null
  } catch {
    return null
  }
}

export type ZonePrice = { zone: string; name: string; price: number | null; unit: string; gbp: boolean }
export function zonePriceList(): ZonePrice[] {
  const names: Record<string, string> = Object.fromEntries((body('zones')?.zones ?? []).map((z: any) => [z.zone, z.name]))
  return (body('state')?.zones ?? []).map((z: any) => ({ zone: z.zone, name: names[z.zone] ?? z.zone, price: z.price?.value ?? null, unit: z.price?.unit ?? '', gbp: z.price?.unit?.startsWith('GBP') ?? false }))
}

export const stateSrc = (): Fig => figOf('state', () => 0)
export const zoneCount = () => figOf('zones', (b) => b.zones.length)
export const linkCount = () => figOf('zones', (b) => b.interconnectors.filter((i: any) => i.in_v1).length)

/** The 26 October GB day-ahead price: lowest and highest actual hour. */
export const stormLow = () => figOf('replay', (b) => Math.min(...replayActuals(b)), '£/MWh')
export const stormHigh = () => figOf('replay', (b) => Math.max(...replayActuals(b)), '£/MWh')
const replayActuals = (b: any): number[] => b.series.find((x: any) => x.zone === 'GB' && x.target === 'price_da').points.map((p: any) => p.actual).filter((v: any) => v != null)
export { replaySeries }

/** The zone whose grid looks cleaner than the power it actually uses, because of what it imports. */
export function dirtiestImportGap() {
  const zs: any[] = body('carbon')?.zones ?? []
  const best = [...zs].sort((a, b) => b.consumption_gco2_kwh - b.production_gco2_kwh - (a.consumption_gco2_kwh - a.production_gco2_kwh))[0]
  const f = (pick: (z: any) => number) => ({ v: best ? pick(best) : null, unit: 'g/kWh', src: '/unseen/carbon', at: generatedAt }) as Fig
  return { zone: best?.zone ?? null, made: f((z) => z.production_gco2_kwh), used: f((z) => z.consumption_gco2_kwh), share: f((z) => z.imports_share * 100) }
}

export const hormuzCost = () => figOf('scenarios', (b) => hormuz(b).cost_total_gbp.p50, '£')
export const hormuzCostLow = () => figOf('scenarios', (b) => hormuz(b).cost_total_gbp.p10, '£')
export const hormuzCostHigh = () => figOf('scenarios', (b) => hormuz(b).cost_total_gbp.p90, '£')
const hormuz = (b: any) => b.scenarios.find((s: any) => s.key === 'hormuz').result
export const hormuzSentence = () => text('scenarios', (b) => hormuz(b).explanation.sentence)

export function householdWindows() {
  const w: any[] = body('household')?.windows ?? []
  return w.map((x) => ({
    label: x.label as string,
    start: String(x.start).slice(11, 16),
    end: String(x.end).slice(11, 16),
    pence: x.avg_p_kwh as number,
    saving: x.saving_gbp?.p50 as number,
    src: '/household',
  }))
}

export const dcGpus = () => figOf('datacentre', (b) => b.gpus)
export const dcFlexPct = () => figOf('datacentre', (b) => b.flexible_share * 100, '%')
export const dcCheapest = () => text('datacentre', (b) => b.cheapest_site)

export const backtestHours = (): Fig => figOf('scores', (b) => Number(/\((\d+) hours\)/.exec(b.headline.sentence)?.[1]))
export const coverageTarget = 80

export function revealGb() {
  const z = body('reveal')?.zones?.find((x: any) => x.zone === 'GB')
  return (z?.hours ?? []).map((h: any, i: number) => ({ hour: i, actual: h.actual as number | null, p10: h.p10 as number, p50: h.p50 as number, p90: h.p90 as number }))
}
export const frozenAt = () => text('reveal', (b) => b.frozen_at)
export const deliveryDate = () => text('reveal', (b) => b.delivery_date)
export const commitmentCount = () => figOf('commitments', (b) => b.records.length)
export const latestCommit = (): { sha: string; at: string } | null => {
  const r = body('commitments')?.records ?? []
  const x = r.filter((y: any) => y.status === 'posted').at(-1) ?? r.at(-1)
  return x ? { sha: String(x.sha256), at: String(x.posted_at ?? x.recorded_at) } : null
}
export const revealSrc = () => figOf('reveal', () => 0)
