import { PathLayer, TextLayer } from 'deck.gl'
import { scaleLinear } from 'd3-scale'
import { rgb } from 'd3-color'
import { getInfra, load, plainStatus, utilisation } from './data.js'

// Boundaries and interconnectors as lines: colour is how full they are (flow against capacity), width is capacity,
// the label gives the gauge and the cost over the window. Click a label to open the infrastructure view.
const STOPS = [[0, '#3fbf7a'], [0.6, '#e0c340'], [0.85, '#ee7d2c'], [1, '#c8322e']]
const scale = scaleLinear().domain(STOPS.map((s) => s[0])).range(STOPS.map((s) => s[1])).clamp(true)
export const gaugeColor = (u, alpha = 255) => {
  const c = rgb(scale(u))
  return [c.r, c.g, c.b, alpha]
}
const Z = 7100
// Phones: a short label (no cost, 'over limit 34%') wrapped to a narrow box, so it fits a 390 px map.
const NARROW = typeof innerWidth !== 'undefined' && innerWidth < 700
const shortStatus = (r) => plainStatus(r).replace(/^Over the limit in (\S+) of hours$/, 'over limit $1').replace(/^Over the limit on average$/, 'over limit')
const money = (v) => (v >= 1e6 ? `£${(v / 1e6).toFixed(1)}m` : `£${Math.round(v / 1e3)}k`)
// The three Channel cables end close together: their labels sit at the continental end, fanned out vertically
// (north to south, as on the map) so they never overlap at any zoom. Netherlands reads to the left, over the
// North Sea, so the story panel on smaller screens does not cover it.
const CHANNEL = { NL: [-10, -24, 'end'], BE: [10, 0, 'start'], FR: [10, 24, 'start'] }
const fanned = (r) => r.kind === 'link' && (r.zone ?? r.id) in CHANNEL

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
    const zl = data?.zones?.interconnectors ?? []
    const ic = Object.fromEntries(zl.map((l) => [l.id, l]))
    // /infrastructure groups links by far-end country: draw that country's largest cable from Britain.
    const byZone = {}
    for (const l of zl) if (l.from === 'GB' && l.from_at && l.to_at && l.capacity_mw > (byZone[l.to]?.capacity_mw ?? 0)) byZone[l.to] = l
    const lineFor = (l) => {
      const z = ic[l.id] ?? byZone[l.zone ?? l.id]
      return z?.from_at && z?.to_at ? [z.from_at, z.to_at] : null
    }
    const rows = [
      ...(infra.boundaries ?? []).map((b) => ({ ...b, kind: 'boundary', line: b.path })),
      ...(infra.interconnectors ?? []).map((l) => ({ ...l, kind: 'link', line: l.path ?? lineFor(l) })),
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
        // Phones label the boundaries and the busy links only; the Channel links' labels would sit on top of each other.
        data: NARROW ? rows.filter((r) => r.kind === 'boundary' || utilisation(r) >= 0.8) : rows,
        getPosition: (r) => [...(fanned(r) ? r.line[r.line.length - 1] : r.line[Math.floor(r.line.length / 2)]), Z],
        getText: (r) =>
          NARROW
            ? `${r.name}: ${shortStatus(r)}${tag}`
            : `${r.name}: ${plainStatus(r).replace(/^Over/, 'over')}${r.cost_gbp_window != null ? ` · ${money(r.cost_gbp_window)}` : ''}${tag}`,
        ...(NARROW ? { maxWidth: 11, wordBreak: 'break-word' } : {}),
        getSize: NARROW ? 10 : 12,
        sizeUnits: 'pixels',
        getColor: [244, 244, 240, 240],
        background: true,
        getBackgroundColor: (r) => [...gaugeColor(utilisation(r)).slice(0, 3), 190],
        backgroundPadding: [6, 3],
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 600,
        getTextAnchor: (r) => (fanned(r) ? CHANNEL[r.zone ?? r.id][2] : 'middle'),
        getAlignmentBaseline: 'center',
        getPixelOffset: (r) => (fanned(r) ? CHANNEL[r.zone ?? r.id].slice(0, 2) : [0, -16]),
        pickable: true,
        onClick: (info) => {
          if (!info.object) return false
          location.hash = '#/infrastructure'
          return true
        },
        parameters: { depthTest: false },
        updateTriggers: { getText: [infra, source], getBackgroundColor: [infra], getPosition: [infra] },
      }),
    ]
  },
}
