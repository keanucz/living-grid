import { ArcLayer, GeoJsonLayer, ScatterplotLayer, TextLayer } from 'deck.gl'
import { scaleLinear } from 'd3-scale'
import { rgb } from 'd3-color'
import { getCarbon, intensities, load } from './data.js'

// gCO2/kWh, one fixed scale for every zone and hour. Standard-estimate lifecycle factors, modelled.
const STOPS = [
  [0, '#3fbf7a'],
  [100, '#9acd4a'],
  [200, '#e0c340'],
  [350, '#ee7d2c'],
  [500, '#c8322e'],
]
const scale = scaleLinear()
  .domain(STOPS.map((s) => s[0]))
  .range(STOPS.map((s) => s[1]))
  .clamp(true)
export const CARBON_LEGEND = STOPS.map(([v, c]) => ({ v, c }))

export function carbonColor(g, alpha = 255) {
  const c = rgb(scale(g))
  return [c.r, c.g, c.b, alpha]
}

const FLAG_COLOR = [255, 90, 150]
const Z = 7000 // above the glass slabs

export default {
  id: 'carbon',
  label: 'Carbon',
  swatch: '#9acd4a',
  order: 30,
  modes: ['overview'],
  defaultOn: false,
  build({ data, ui, time, stateByZone }) {
    if (!data.geo || !data.zones) return []
    load()
    const live = getCarbon()
    const by = intensities(stateByZone, live.zones)
    const feats = data.geo.features.filter((f) => f.properties.zone && by[f.properties.zone])
    const centroid = Object.fromEntries(data.zones.zones.map((z) => [z.id, z.centroid]))
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4)
    const flagged = Object.entries(by)
      .filter(([z, v]) => v.flagged && centroid[z])
      .map(([zone, v]) => ({ zone, at: centroid[zone], ...v }))

    // Imports drawn as arcs, tinted by what the exporter's electricity carries (its consumption intensity,
    // since exports leave the same pool). Direction follows the sign of the measured flow.
    const ic = Object.fromEntries(data.zones.interconnectors.map((l) => [l.id, l]))
    const imports = (data.state?.flows ?? [])
      .filter((f) => f.mw && ic[f.interconnector])
      .map((f) => {
        const l = ic[f.interconnector]
        const [from, to] = f.mw > 0 ? [l.from, l.to] : [l.to, l.from]
        const a = (f.mw > 0 ? l.from_at : l.to_at) ?? centroid[from]
        const b = (f.mw > 0 ? l.to_at : l.from_at) ?? centroid[to]
        return a && b && by[from] ? { from, to, a, b, mw: Math.abs(f.mw), g: by[from].consumption } : null
      })
      .filter(Boolean)

    return [
      new GeoJsonLayer({
        id: 'carbon-zones',
        data: feats,
        filled: true,
        stroked: true,
        getFillColor: (f) => carbonColor(by[f.properties.zone].consumption, 78),
        getLineColor: (f) => carbonColor(by[f.properties.zone].consumption, 210),
        getLineWidth: 1.6,
        lineWidthUnits: 'pixels',
        pickable: true,
        updateTriggers: { getFillColor: [live.zones, data.state], getLineColor: [live.zones, data.state] },
        parameters: { depthTest: false },
      }),
      new ArcLayer({
        id: 'carbon-imports',
        data: imports,
        getSourcePosition: (d) => [...d.a, Z],
        getTargetPosition: (d) => [...d.b, Z],
        getSourceColor: (d) => carbonColor(d.g, 235),
        getTargetColor: (d) => carbonColor(d.g, 235),
        getWidth: (d) => 1.5 + Math.min(5, d.mw / 450),
        widthUnits: 'pixels',
        getHeight: 0.35,
        parameters: { depthTest: false },
        updateTriggers: { getSourceColor: [live.zones, data.state], getTargetColor: [live.zones, data.state], getWidth: [data.state] },
      }),
      new ScatterplotLayer({
        id: 'carbon-flag-ring',
        data: flagged,
        getPosition: (d) => [...d.at, Z],
        getRadius: 36000 + 22000 * pulse,
        getFillColor: [...FLAG_COLOR, 26 + 30 * pulse],
        stroked: true,
        getLineColor: [...FLAG_COLOR, 200 + 55 * pulse],
        lineWidthUnits: 'pixels',
        getLineWidth: 2.4,
        updateTriggers: { getRadius: time, getFillColor: time, getLineColor: time },
        parameters: { depthTest: false },
      }),
      new TextLayer({
        id: 'carbon-labels',
        data: feats.map((f) => ({ zone: f.properties.zone, at: centroid[f.properties.zone], ...by[f.properties.zone] })).filter((d) => d.at),
        getPosition: (d) => [...d.at, Z],
        getText: (d) =>
          d.flagged
            ? `${d.zone}  ${Math.round(d.production)} → ${Math.round(d.consumption)} g\nclean grid, dirty imports`
            : `${d.zone}  ${Math.round(d.consumption)} g`,
        getSize: (d) => (d.flagged ? 15 : 13),
        sizeUnits: 'pixels',
        getColor: (d) => (d.flagged ? [255, 214, 230, 255] : [244, 244, 240, 235]),
        background: true,
        getBackgroundColor: (d) => (d.flagged ? [60, 14, 34, 235] : [18, 18, 18, 200]),
        backgroundPadding: [7, 4],
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 600,
        lineHeight: 1.25,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        getPixelOffset: [0, 30], // sits under the price label instead of on top of it
        parameters: { depthTest: false },
        updateTriggers: { getText: [live.zones, data.state], getSize: [live.zones, data.state], getColor: [live.zones, data.state], getBackgroundColor: [live.zones, data.state] },
      }),
    ]
  },
}
