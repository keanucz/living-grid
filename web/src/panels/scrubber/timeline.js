// History for the scrubber strip: GET /timeline, shared in-flight and cached by range. No fixture fallback:
// when the API is unreachable the strip simply has no history and the slider still works.
const OFFLINE = import.meta.env.VITE_LG_OFFLINE === '1'
const cache = new Map()

export const HISTORY_START = Date.parse('2024-01-01T00:00:00Z')
export const HOUR = 3600e3
export const DAY = 24 * HOUR

export const ZOOMS = [
  { id: '2d', label: '2 days', back: DAY, ahead: DAY, step: 'hour' },
  { id: 'week', label: 'Week', back: 7 * DAY, ahead: 2 * DAY, step: 'hour' },
  { id: 'month', label: 'Month', back: 30 * DAY, ahead: 2 * DAY, step: 'day' },
  { id: 'year', label: 'Year', back: 365 * DAY, ahead: 2 * DAY, step: 'day' },
  { id: 'all', label: 'Since 2024', back: null, ahead: 2 * DAY, step: 'day' },
]

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z')

export function windowFor(zoom, nowMs, atMs) {
  const hi = nowMs + zoom.ahead
  const lo = zoom.back == null ? HISTORY_START : Math.max(HISTORY_START, nowMs - zoom.back)
  if (atMs == null || (atMs >= lo && atMs <= hi)) return [lo, hi]
  const half = (hi - lo) / 2
  const c = Math.min(Math.max(atMs, HISTORY_START + half), nowMs + 2 * DAY - half)
  return [Math.max(HISTORY_START, c - half), Math.min(nowMs + 2 * DAY, c + half)]
}

// Series for [lo, hi]: GB price, wind share, plus the event markers. Daily steps cover any range; hourly ones are
// limited by the API to 120 days.
export function loadTimeline(loMs, hiMs, step) {
  if (OFFLINE) return Promise.resolve(null)
  const key = `${step}:${step === 'day' ? 'all' : `${iso(loMs)}`}`
  if (!cache.has(key)) {
    const from = step === 'day' ? iso(HISTORY_START) : iso(loMs)
    const to = iso(Math.min(hiMs, Date.now()))
    const p = fetch(`/api/timeline?from=${from}&to=${to}&step=${step}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => (j ? { ...j, ms: j.ts.map(Date.parse) } : null))
    cache.set(key, p)
    p.then((v) => v ?? cache.delete(key))
  }
  return cache.get(key)
}
