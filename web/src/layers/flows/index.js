import { PathLayer, TripsLayer } from 'deck.gl'
import { COLORS } from '../../styles/tokens.js'

const N = 64
const TAIL = 0.4 // bar length as a share of the link
const cache = new Map()

// Quadratic curve between two anchors, bowed sideways; parallel links fan out.
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

// Cumulative arc length, normalised to 0..1, so the bar moves at constant speed along the curve.
function progress(path) {
  const d = [0]
  for (let i = 1; i < path.length; i++) {
    d.push(d[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
  }
  const total = d[d.length - 1] || 1
  return d.map((v) => v / total)
}

export function geometry(zones, sim) {
  const key = `${zones.interconnectors.length}:${sim}`
  if (cache.has(key)) return cache.get(key)
  const at = Object.fromEntries(zones.zones.map((z) => [z.id, z.centroid]))
  const seen = {}
  const links = zones.interconnectors
    .filter((ic) => (ic.from_at || at[ic.from]) && (ic.to_at || at[ic.to]))
    .map((ic) => {
      const pair = [ic.from, ic.to].sort().join('|')
      const k = (seen[pair] = (seen[pair] ?? -1) + 1)
      const a = ic.from_at ?? at[ic.from]
      const b = ic.to_at ?? at[ic.to]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const path = curve(a, b, ic.from_at ? 0.2 : 0.18 + 0.14 * k, sim ? 22000 * len : 0)
      const prog = progress(path)
      // Phase offset per link so the bars don't sweep in lockstep.
      const phase = ((ic.id.split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 7) >>> 0) % 1000) / 1000
      return { ...ic, path, prog, rpath: [...path].reverse(), rprog: prog.map((p) => 1 - p).reverse(), phase }
    })
  cache.set(key, links)
  return links
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
    const links = geometry(data.zones, sim).map((l) => {
      const mw = tripped.has(l.id) ? 0 : flow[l.id] ?? 0
      const util = Math.min(1, Math.abs(mw) / l.capacity_mw)
      return { ...l, mw, util, focus: focus.has(l.id), tripped: tripped.has(l.id) }
    })

    const colorOf = (l, a) =>
      l.tripped ? [...COLORS.danger, a] : l.focus ? [...COLORS.hot, a] : [...COLORS.accent, a]

    // Each link sweeps a bar from sender to receiver in a loop. The head sits at `head` in 0..1;
    // shifting the timestamps by -head lets one shared currentTime (0) serve every link.
    const bars = links
      .filter((l) => l.mw)
      .map((l) => {
        const speed = 0.12 + 0.3 * l.util
        const head = ((time * speed + l.phase) % 1) * (1 + TAIL)
        const [path, prog] = l.mw > 0 ? [l.path, l.prog] : [l.rpath, l.rprog]
        return { l, path, ts: prog.map((p) => p - head) }
      })

    const trips = (id, width, alpha, white) =>
      new TripsLayer({
        id,
        data: bars,
        getPath: (d) => d.path,
        getTimestamps: (d) => d.ts,
        getColor: (d) => (white ? [255, 255, 235] : colorOf(d.l, 255)),
        opacity: alpha,
        getWidth: width,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        fadeTrail: true,
        trailLength: TAIL,
        currentTime: 0,
        parameters: { depthTest: false },
        updateTriggers: { getTimestamps: time, getColor: [scenario?.type] },
      })

    return [
      new PathLayer({
        id: 'flows-line',
        data: links,
        getPath: (l) => l.path,
        getColor: (l) => colorOf(l, l.tripped ? 200 : l.focus ? 120 : 55),
        getWidth: (l) => (l.focus || l.tripped ? 2.5 : 1.5) + (l.capacity_mw / 1000) * 0.6,
        widthUnits: 'pixels',
        capRounded: true,
        pickable: true,
        updateTriggers: { getColor: [scenario?.type], getWidth: [scenario?.type] },
      }),
      trips('flows-bar', (d) => 3 + 1.5 * d.l.util, 0.95, false),
      trips('flows-bar-core', 1.4, 0.9, true),
    ]
  },
}
