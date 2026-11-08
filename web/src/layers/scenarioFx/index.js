import { PathLayer, ScatterplotLayer, TextLayer } from 'deck.gl'
import { COLORS } from '../../styles/tokens.js'
import { geometry } from '../flows/index.js'
import { slabHeight } from '../price/index.js'
import assets from '../../fixtures/assets.json'

// Short map effects for the world events in What if. They start when the scenario is run, take about four
// seconds and settle to a calm end state. The positions and timings are stylised, so each effect is labelled
// "illustrative"; the prices and costs elsewhere come from the model. No chip: it only shows with a scenario.
// Offsets keep the five names apart around the Channel; anchor 'end' puts a name to the left of its dot.
const LNG = [
  { name: 'Isle of Grain', at: [0.72, 51.44], off: [-10, 0], anchor: 'end' },
  { name: 'Dunkirk', at: [2.2, 51.05], off: [0, 14], anchor: 'middle' },
  { name: 'Zeebrugge', at: [3.18, 51.33], off: [10, 6], anchor: 'start' },
  { name: 'Rotterdam (Gate)', at: [4.07, 51.95], off: [0, -14], anchor: 'middle' },
  { name: 'Wilhelmshaven', at: [8.14, 53.52], off: [10, 0], anchor: 'start' },
]
const FRENCH_NUCLEAR = assets.filter((a) => ['Gravelines', 'Paluel', 'Flamanville'].includes(a.name))
const GAS = assets.filter((a) => a.type === 'gas')
const SETTLE = 4.2
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)
// Labels sit on a dark pill so they read over the red bars.
const PILL = { background: true, getBackgroundColor: [18, 18, 17, 215], backgroundPadding: [5, 2], fontFamily: 'Inter, sans-serif', parameters: { depthTest: false } }
const label = (id, data, text, y = 0) =>
  new TextLayer({ id, data, getPosition: (d) => d.at, getText: () => text, getSize: 11, getColor: [236, 236, 230, 235], getPixelOffset: [0, 14 + y], ...PILL })

// What if draws each country as a bar whose height is its price, so a point drawn at ground level shows up under the
// wrong country. Every effect is lifted to the top of its own country's bar.
function inRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const zoneCache = new Map()
export function zoneOf(data, [lon, lat]) {
  const key = `${lon},${lat}`
  if (zoneCache.has(key)) return zoneCache.get(key)
  let zone = null
  for (const f of data.geo?.features ?? []) {
    const z = f.properties?.zone
    const g = f.geometry
    if (!z || !g) continue
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    if (polys.some((rings) => inRing(lon, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lon, lat, h)))) {
      zone = z
      break
    }
  }
  // Coastal sites can fall just outside the simplified coastline: use the nearest zone centre.
  if (!zone) {
    let best = Infinity
    for (const z of data.zones?.zones ?? []) {
      const [x, y] = z.centroid ?? []
      const d = (x - lon) ** 2 + (y - lat) ** 2
      if (d < best) [best, zone] = [d, z.id]
    }
  }
  if (data.geo) zoneCache.set(key, zone)
  return zone
}
export const onTop = (data, priceOf, at, lift = 1500) => {
  const z = zoneOf(data, at)
  return [at[0], at[1], z ? slabHeight(priceOf(z)) + lift : lift]
}

function ring(id, centres, t, delay, colour) {
  const x = (t - delay) / 2.2
  if (x <= 0 || x >= 1) return null
  return new ScatterplotLayer({
    id, data: centres, getPosition: (d) => d.at, radiusUnits: 'meters', getRadius: 20000 + 160000 * ease(x), stroked: true, filled: false,
    getLineColor: [...colour, Math.round(220 * (1 - x))], lineWidthUnits: 'pixels', getLineWidth: 3.5, parameters: { depthTest: false },
    updateTriggers: { getRadius: t, getLineColor: t },
  })
}

function dashed(path, on = 3, off = 3) {
  const segs = []
  for (let i = 0; i + 1 < path.length; i += on + off) segs.push(path.slice(i, Math.min(path.length, i + on + 1)))
  return segs
}

export default {
  id: 'scenarioFx',
  label: 'World event effects',
  hidden: true,
  order: 60,
  modes: ['simulate'],
  defaultOn: true,
  build({ data, ui, scenario, priceOf }) {
    const run = ui.scenario
    if (!run || !scenario || !data.zones) return []
    const top = (at) => onTop(data, priceOf, at)
    const lift = (rows, key = 'at') => rows.map((r) => ({ ...r, at: top(r[key]) }))
    const t = reduced ? SETTLE + 10 : (Date.now() - run.ranAt) / 1000
    const strength = Math.min(1, 0.4 + 0.6 * (scenario.scale ?? 1))
    const settled = t >= SETTLE
    const out = []

    if (run.id === 'hormuz') {
      const warm = [...COLORS.hot]
      const lng = lift(LNG)
      out.push(ring('fx-lng-ring-a', lng, t, 0, warm), ring('fx-lng-ring-b', lng, t, 1.1, warm))
      out.push(new ScatterplotLayer({
        id: 'fx-lng-dot', data: lng, getPosition: (d) => d.at, radiusUnits: 'pixels', getRadius: 6, getFillColor: [...warm, 235],
        stroked: true, getLineColor: [20, 20, 20, 255], lineWidthUnits: 'pixels', getLineWidth: 1.5, parameters: { depthTest: false },
      }))
      // A small glow on each gas plant, kept inside its country so it never hides a border.
      out.push(new ScatterplotLayer({
        id: 'fx-gas-glow', data: lift(GAS, 'coord'), getPosition: (d) => d.at, radiusUnits: 'pixels', parameters: { depthTest: false },
        getRadius: 9 + 6 * ease((t - 1) / 3) * strength, getFillColor: [...warm, Math.round(60 + 70 * ease((t - 1) / 3) * strength)],
        updateTriggers: { getRadius: Math.floor(t * 20), getFillColor: Math.floor(t * 20) },
      }))
      out.push(new TextLayer({
        id: 'fx-lng-names', data: lng, getPosition: (d) => d.at, getText: (d) => `${d.name} LNG`, getSize: 10.5, getColor: [236, 236, 230, 235],
        getPixelOffset: (d) => d.off, getTextAnchor: (d) => d.anchor, getAlignmentBaseline: 'center', ...PILL,
      }))
      out.push(label('fx-ill', [{ at: top([2.6, 47.2]) }], 'Illustrative effect', 0))
    }

    if (run.id === 'interconnector_trip') {
      const links = geometry(data.zones, true)
      const nsl = links.find((l) => l.id === 'nsl')
      if (nsl) {
        const mid = nsl.path[Math.floor(nsl.path.length / 2)]
        if (t < 1.4) {
          out.push(new ScatterplotLayer({
            id: 'fx-snap', data: [{ at: mid }], getPosition: (d) => d.at, radiusUnits: 'pixels', getRadius: 14 + 70 * ease(t / 1.4),
            getFillColor: [255, 255, 235, Math.round(230 * (1 - t / 1.4))], parameters: { depthTest: false }, updateTriggers: { getRadius: t, getFillColor: t },
          }))
        }
        if (t > 0.5) {
          out.push(new PathLayer({
            id: 'fx-nsl-dash', data: dashed(nsl.path), getPath: (d) => d, getColor: [...COLORS.danger, 220], widthUnits: 'pixels', getWidth: 3, parameters: { depthTest: false },
          }))
        }
      }
      const others = links.filter((l) => scenario.links?.includes(l.id) ? false : ['ifa', 'ifa2', 'eleclink', 'britned', 'nemo'].includes(l.id))
      const glow = ease((t - 1.2) / 2.5)
      if (glow > 0) {
        out.push(new PathLayer({
          id: 'fx-reroute', data: others, getPath: (l) => l.path, getColor: [...COLORS.accent, Math.round(150 * glow)], widthUnits: 'pixels', getWidth: 5 + 5 * glow,
          parameters: { depthTest: false }, updateTriggers: { getColor: Math.floor(t * 20), getWidth: Math.floor(t * 20) },
        }))
      }
      out.push(label('fx-ill', [{ at: top([2.5, 49.6]) }], 'Illustrative effect', 0))
    }

    if (run.id === 'nuclear_outage') {
      const fr = FRENCH_NUCLEAR.map((a, i) => ({ at: top(a.coord), dim: ease((t - 0.5 * i) / 1.2) }))
      out.push(new ScatterplotLayer({
        id: 'fx-nuke', data: fr, getPosition: (d) => d.at, radiusUnits: 'pixels', getRadius: 13, parameters: { depthTest: false },
        getFillColor: (d) => [Math.round(220 - 150 * d.dim), Math.round(200 - 140 * d.dim), Math.round(120 - 60 * d.dim), 235],
        stroked: true, getLineColor: [20, 20, 20, 255], lineWidthUnits: 'pixels', getLineWidth: 1.5,
        updateTriggers: { getFillColor: Math.floor(t * 20) },
      }))
      const pull = ease((t - 1.5) / 2.5)
      const links = geometry(data.zones, true).filter((l) => scenario.links?.includes(l.id))
      if (pull > 0) {
        out.push(new PathLayer({
          id: 'fx-pull', data: links, getPath: (l) => l.path, getColor: [...COLORS.accent, Math.round(140 * pull)], widthUnits: 'pixels', getWidth: 4 + 5 * pull,
          parameters: { depthTest: false }, updateTriggers: { getColor: Math.floor(t * 20), getWidth: Math.floor(t * 20) },
        }))
      }
      out.push(label('fx-ill', [{ at: top([2.5, 47.2]) }], 'Illustrative effect', 0))
    }

    // While the pulses move the map must redraw every frame; once settled it holds still.
    return settled && !out.length ? [] : out.filter(Boolean)
  },
}
