import { PathLayer, ScatterplotLayer, TextLayer } from 'deck.gl'
import { COLORS } from '../../styles/tokens.js'
import { geometry } from '../flows/index.js'
import assets from '../../fixtures/assets.json'

// Short map effects for the world events in What if. They start when the scenario is run, take about four
// seconds and settle to a calm end state. The positions and timings are stylised, so each effect is labelled
// "illustrative"; the prices and costs elsewhere come from the model. No chip: it only shows with a scenario.
const LNG = [
  { name: 'Isle of Grain', at: [0.72, 51.44] }, { name: 'Dunkirk', at: [2.2, 51.05] }, { name: 'Zeebrugge', at: [3.18, 51.33] },
  { name: 'Gate, Rotterdam', at: [4.07, 51.95] }, { name: 'Wilhelmshaven', at: [8.14, 53.52] },
]
const FRENCH_NUCLEAR = assets.filter((a) => ['Gravelines', 'Paluel', 'Flamanville'].includes(a.name))
const GAS = assets.filter((a) => a.type === 'gas')
const SETTLE = 4.2
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)
const label = (id, data, text, y = 0) =>
  new TextLayer({
    id, data, getPosition: (d) => d.at, getText: () => text, getSize: 11, getColor: [230, 230, 224, 200], getPixelOffset: [0, 14 + y],
    fontFamily: 'Inter, sans-serif', background: false, parameters: { depthTest: false },
  })

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
  build({ data, ui, scenario }) {
    const run = ui.scenario
    if (!run || !scenario || !data.zones) return []
    const t = reduced ? SETTLE + 10 : (Date.now() - run.ranAt) / 1000
    const strength = Math.min(1, 0.4 + 0.6 * (scenario.scale ?? 1))
    const settled = t >= SETTLE
    const out = []

    if (run.id === 'hormuz') {
      const warm = [...COLORS.hot]
      out.push(ring('fx-lng-ring-a', LNG, t, 0, warm), ring('fx-lng-ring-b', LNG, t, 1.1, warm))
      out.push(new ScatterplotLayer({
        id: 'fx-lng-dot', data: LNG, getPosition: (d) => d.at, radiusUnits: 'pixels', getRadius: 6, getFillColor: [...warm, 235],
        stroked: true, getLineColor: [20, 20, 20, 255], lineWidthUnits: 'pixels', getLineWidth: 1.5, parameters: { depthTest: false },
      }))
      out.push(new ScatterplotLayer({
        id: 'fx-gas-glow', data: GAS, getPosition: (d) => d.coord, radiusUnits: 'pixels', parameters: { depthTest: false },
        getRadius: 26 + 18 * ease((t - 1) / 3) * strength, getFillColor: [...warm, Math.round(70 + 90 * ease((t - 1) / 3) * strength)],
        updateTriggers: { getRadius: Math.floor(t * 20), getFillColor: Math.floor(t * 20) },
      }))
      out.push(label('fx-lng-label', [LNG[3]], 'LNG terminals', 0), label('fx-ill', [{ at: [4.5, 49.3] }], 'Illustrative effect', 0))
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
      out.push(label('fx-ill', [{ at: [2.5, 49.6] }], 'Illustrative effect', 0))
    }

    if (run.id === 'nuclear_outage') {
      const fr = FRENCH_NUCLEAR.map((a, i) => ({ at: a.coord, dim: ease((t - 0.5 * i) / 1.2) }))
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
      out.push(label('fx-ill', [{ at: [2.5, 47.2] }], 'Illustrative effect', 0))
    }

    // While the pulses move the map must redraw every frame; once settled it holds still.
    return settled && !out.length ? [] : out.filter(Boolean)
  },
}
