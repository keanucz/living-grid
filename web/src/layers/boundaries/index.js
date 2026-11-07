import { PathLayer, TextLayer } from 'deck.gl'
import { scaleLinear } from 'd3-scale'
import { rgb } from 'd3-color'
import { getInfra, load, utilisation } from './data.js'

// Boundaries and interconnectors as lines: colour is how full they are (flow against capacity), width is capacity,
// the label gives the gauge and the cost over the window. Click a label to open the infrastructure view.
const STOPS = [[0, '#3fbf7a'], [0.6, '#e0c340'], [0.85, '#ee7d2c'], [1, '#c8322e']]
const scale = scaleLinear().domain(STOPS.map((s) => s[0])).range(STOPS.map((s) => s[1])).clamp(true)
export const gaugeColor = (u, alpha = 255) => {
  const c = rgb(scale(u))
  return [c.r, c.g, c.b, alpha]
}
const Z = 7100
const money = (v) => (v >= 1e6 ? `£${(v / 1e6).toFixed(1)}m` : `£${Math.round(v / 1e3)}k`)

export default {
  id: 'boundaries',
  label: 'Bottlenecks',
  swatch: '#ee7d2c',
  order: 45,
  modes: ['overview'],
  defaultOn: false,
  build({ data }) {
    load()
    const { data: infra, source } = getInfra()
    const ic = Object.fromEntries((data?.zones?.interconnectors ?? []).map((l) => [l.id, l]))
    const rows = [
      ...(infra.boundaries ?? []).map((b) => ({ ...b, kind: 'boundary', line: b.path })),
      ...(infra.interconnectors ?? []).map((l) => ({ ...l, kind: 'link', line: l.path ?? (ic[l.id]?.from_at && ic[l.id]?.to_at ? [ic[l.id].from_at, ic[l.id].to_at] : null) })),
    ].filter((r) => r.line?.length >= 2)
    const tag = source === 'sample' ? ' (sample)' : ''
    return [
      new PathLayer({
        id: 'boundaries-lines',
        data: rows,
        getPath: (r) => r.line.map(([x, y]) => [x, y, Z]),
        getColor: (r) => gaugeColor(utilisation(r), 230),
        getWidth: (r) => 2 + Math.min(8, r.capacity_mw / 900),
        widthUnits: 'pixels',
        capRounded: true,
        pickable: true,
        parameters: { depthTest: false },
        updateTriggers: { getColor: [infra], getWidth: [infra] },
      }),
      new TextLayer({
        id: 'boundaries-labels',
        data: rows,
        getPosition: (r) => [...r.line[Math.floor(r.line.length / 2)], Z],
        getText: (r) => `${r.id.toUpperCase()} ${Math.round(utilisation(r) * 100)}% full${r.cost_gbp_window != null ? ` · ${money(r.cost_gbp_window)}` : ''}${tag}`,
        getSize: 12,
        sizeUnits: 'pixels',
        getColor: [244, 244, 240, 240],
        background: true,
        getBackgroundColor: (r) => [...gaugeColor(utilisation(r)).slice(0, 3), 190],
        backgroundPadding: [6, 3],
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 600,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        getPixelOffset: [0, -16],
        pickable: true,
        onClick: (info) => {
          if (!info.object) return false
          location.hash = '#/infrastructure'
          return true
        },
        parameters: { depthTest: false },
        updateTriggers: { getText: [infra, source], getBackgroundColor: [infra] },
      }),
    ]
  },
}
