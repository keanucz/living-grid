import raw from '../data/numbers.json'

// The only source of figures (written by scripts/snapshot.mjs). A missing value is null: the card then shows its
// label without a number, never a typed fallback.
type V = { value: number | null; source: string; fetched_at: string; [k: string]: unknown }
const data = raw as unknown as { fetched_at: string; values: Record<string, V | undefined> }

export const fetchedAt = data.fetched_at
export function val(id: string): V | null {
  return data.values[id] ?? null
}
export function n(id: string, key = 'value'): number | null {
  const x = data.values[id]?.[key]
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

export const fmt = {
  int: (v: number) => Math.round(v).toLocaleString('en-GB'),
  pct: (v: number) => `${Math.round(v)}%`,
  gbp: (v: number) => (Math.abs(v) >= 1e9 ? `£${(v / 1e9).toFixed(1)}bn` : Math.abs(v) >= 1e6 ? `£${(v / 1e6).toFixed(1)}m` : `£${Math.round(v).toLocaleString('en-GB')}`),
}

/** "8 Nov 07:52 UTC" */
export function stamp(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
  const hm = d.toISOString().slice(11, 16)
  return `${d.getUTCDate()} ${mon} ${hm} UTC`
}
