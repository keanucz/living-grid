import { PathLayer, ScatterplotLayer } from 'deck.gl'
import { COLORS } from '../../styles/tokens.js'

const N = 40
const PACKETS = 5
const cache = new Map()

// Quadratic curve between two zone anchors, bowed sideways; parallel links fan out.
function curve(a, b, bow, lift) {
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const c = [mx - dy * bow, my + dx * bow]
  const pts = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const u = 1 - t
    pts.push([
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
      lift * Math.sin(Math.PI * t),
    ])
  }
  return pts
}

function geometry(zones, sim) {
  const key = `${zones.interconnectors.length}:${sim}`
  if (cache.has(key)) return cache.get(key)
  const at = Object.fromEntries(zones.zones.map((z) => [z.id, z.centroid]))
  const seen = {}
  const links = zones.interconnectors
    .filter((ic) => at[ic.from] && at[ic.to])
    .map((ic) => {
      const pair = [ic.from, ic.to].sort().join('|')
      const k = (seen[pair] = (seen[pair] ?? -1) + 1)
      const bow = 0.18 + 0.14 * k
      const a = ic.from_at ?? at[ic.from]
      const b = ic.to_at ?? at[ic.to]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      return { ...ic, path: curve(a, b, ic.from_at ? 0.2 : bow, sim ? 22000 * len : 0) }
    })
  cache.set(key, links)
  return links
}

function along(path, f) {
  const x = f * N
  const i = Math.min(N - 1, Math.floor(x))
  const t = x - i
  const a = path[i]
  const b = path[i + 1]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export default {
  id: 'flows',
  label: 'Flows',
  swatch: '#c5f06b',
  order: 20,
  modes: ['overview', 'simulate'],
  defaultOn: true,
  build({ data, ui, time, scenario }) {
    if (!data.zones || !data.state) return []
    const sim = ui.mode === 'simulate'
    const flow = Object.fromEntries(data.state.flows.map((f) => [f.interconnector, f.mw]))
    const focus = new Set(scenario?.links ?? [])
    const tripped = new Set(scenario?.tripped ?? [])
    const links = geometry(data.zones, sim).map((l) => ({
      ...l,
      mw: tripped.has(l.id) ? 0 : flow[l.id] ?? 0,
      focus: focus.has(l.id),
      tripped: tripped.has(l.id),
    }))

    const colorOf = (l, a) =>
      l.tripped ? [...COLORS.danger, a] : l.focus ? [...COLORS.hot, a] : [...COLORS.accent, a]

    const packets = []
    for (const l of links) {
      if (!l.mw) continue
      const util = Math.min(1, Math.abs(l.mw) / l.capacity_mw)
      const speed = 0.08 + 0.32 * util
      for (let k = 0; k < PACKETS; k++) {
        let f = (time * speed + k / PACKETS) % 1
        if (l.mw < 0) f = 1 - f
        packets.push({ p: along(l.path, f), l, fade: Math.sin(Math.PI * f) })
      }
    }

    return [
      new PathLayer({
        id: 'flows-glow',
        data: links,
        getPath: (l) => l.path,
        getColor: (l) => colorOf(l, l.focus || l.tripped ? 70 : 28),
        getWidth: (l) => 4 + (l.capacity_mw / 1000) * (sim ? 5 : 3),
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        updateTriggers: { getColor: [scenario?.type], getWidth: [sim] },
      }),
      new PathLayer({
        id: 'flows-line',
        data: links,
        getPath: (l) => l.path,
        getColor: (l) => colorOf(l, l.tripped ? 230 : l.focus ? 230 : 150),
        getWidth: (l) => (l.focus || l.tripped ? 2.5 : 1.4),
        widthUnits: 'pixels',
        pickable: true,
        updateTriggers: { getColor: [scenario?.type], getWidth: [scenario?.type] },
      }),
      new ScatterplotLayer({
        id: 'flows-packets-halo',
        data: packets,
        getPosition: (d) => d.p,
        getRadius: (d) => 7 + 4 * Math.min(1, Math.abs(d.l.mw) / d.l.capacity_mw),
        radiusUnits: 'pixels',
        getFillColor: (d) => colorOf(d.l, 60 * d.fade),
        updateTriggers: { getPosition: time, getFillColor: time },
      }),
      new ScatterplotLayer({
        id: 'flows-packets',
        data: packets,
        getPosition: (d) => d.p,
        getRadius: 2.6,
        radiusUnits: 'pixels',
        getFillColor: (d) => [255, 255, 240, 255 * d.fade],
        updateTriggers: { getPosition: time, getFillColor: time },
      }),
    ]
  },
}
