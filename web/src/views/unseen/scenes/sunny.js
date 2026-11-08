// Scene 4: a sunny Sunday with negative prices. Time-lapse through 26 April 2026 (data/events/sunny-weekend.json): the sun
// shading brightens, zones turn the negative-price colour as the German day-ahead price drops below zero, and a counter
// shows the hours below zero so far. Step format as in carbon.js.
import { api } from '../../../api/client.js'

const OFF = { ghostWind: false, boundaries: false, carbon: false, carbonPuffs: false, wind: false }
const DAY = '2026-04-26'
const BEATS = [
  [6, 'Sunday 26 April, early morning. Demand is low and the sun is just coming up.'],
  [8, null],
  [10, 'German solar peaks at 44.9 GW and prices are going below zero.'],
  [11, 'The deepest dip: generators pay to be allowed to produce.'],
  [13, null],
  [15, null],
  [17, 'The sun drops and prices climb back above zero.'],
  [19, 'Eight hours below zero in one day. Batteries and flexible demand exist for hours like these.'],
]
const HOURS = BEATS.map(([h]) => h)
const iso = (h) => `${DAY}T${String(h).padStart(2, '0')}:00:00Z`

// Hours with a negative German price up to and including `ts`, from the event's own series.
export function negativeSoFar(ev, ts) {
  const pts = ev?.series?.find((s) => s.key === 'price_de')?.points ?? []
  const day = pts.filter(([t]) => t.startsWith(DAY) && Date.parse(t) <= Date.parse(ts))
  const neg = day.filter(([, v]) => v < 0)
  return { hours: neg.length, now: day.at(-1)?.[1] ?? null, low: neg.length ? Math.min(...neg.map(([, v]) => v)) : null }
}

// Warm the per-hour /state cache so each step of the time-lapse changes the map at once instead of when the fetch lands.
// One hour at a time: the client drops an hour whose request is overtaken by a newer one, so a parallel warm-up keeps only the last.
export const prepare = async () => { for (const h of HOURS) await api.state(iso(h)).catch(() => null) }

// The time-lapse, in the runner's format plus one new step kind: { at, time: ISO | null } sets the map's hour (actions.setAt).
// Built from the event file: d = { event } (data/events/sunny-weekend.json). Call prepare() first so each hour is cached.
export default function sunnyScene(d = {}) {
  const ev = d.event
  const end = negativeSoFar(ev, iso(HOURS.at(-1)))
  const STEP = 1700
  const t0 = 2400
  const steps = [
    { at: 0, layers: { ...OFF, solar: true, flows: true } },
    { at: 100, camera: { longitude: 6, latitude: 51, zoom: 4.5, pitch: 0, bearing: 0 }, dur: 1400 },
  ]
  BEATS.forEach(([h, caption], i) => {
    const at = i === 0 ? 300 : t0 + (i - 1) * STEP
    steps.push({ at, time: iso(h) })
    if (caption) steps.push({ at: at + 50, caption })
    steps.push({ at: at + 100, count: { to: negativeSoFar(ev, iso(h)).hours, dur: 500 } })
  })
  return {
    id: 'sunny',
    duration: t0 + (BEATS.length - 1) * STEP + 1800,
    caption: BEATS[0][1],
    counter: { label: 'Hours below zero in Germany', from: 0, to: end.hours, format: 'int' },
    steps,
  }
}

export const reducedSunny = { layers: { ...OFF, solar: true, flows: true }, time: iso(11), caption: 'On a sunny Sunday Germany makes more power than it can use, and prices go below zero.' }
