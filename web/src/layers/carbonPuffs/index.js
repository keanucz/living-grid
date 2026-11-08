import { ScatterplotLayer, TextLayer } from 'deck.gl'
import { getCarbon, intensities, load } from '../carbon/data.js'

// Scene overlay for "carbon that comes in by cable" (Hidden grid). Grey puffs travel along each interconnector that is
// bringing power into GB, tagged with what the neighbour's electricity carries (g/kWh, modelled). The scene's counter shows
// tonnesPerHour(carbonImports(...)). Not in the Layers menu; scenes switch it on and off.
const Z = 7000
const PER_LINK = 7
export const carbonImports = (zones, flows, by, to = 'GB') => {
  const ic = Object.fromEntries((zones?.interconnectors ?? []).map((l) => [l.id, l]))
  return (flows ?? [])
    .filter((f) => f.mw && ic[f.interconnector])
    .map((f) => {
      const l = ic[f.interconnector]
      const fwd = f.mw > 0
      const [from, dest] = fwd ? [l.from, l.to] : [l.to, l.from]
      const a = fwd ? l.from_at : l.to_at, b = fwd ? l.to_at : l.from_at
      return dest === to && a && b && by[from] ? { id: l.id, from, a, b, mw: Math.abs(f.mw), g: by[from].consumption } : null
    })
    .filter(Boolean)
}

// kg per hour = MW x 1000 kWh x g/kWh / 1000 = MW x g; tonnes per hour = MW x g / 1000
export const tonnesPerHour = (links) => links.reduce((s, d) => s + (d.mw * d.g) / 1000, 0)

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

export default {
  id: 'carbonPuffs',
  label: 'Carbon puffs',
  order: 31,
  modes: ['overview'],
  defaultOn: false,
  hidden: true,
  build({ data, time, stateByZone }) {
    if (!data.zones || !data.state) return []
    load()
    const by = intensities(stateByZone, getCarbon().zones)
    const links = carbonImports(data.zones, data.state.flows, by)
    if (!links.length) return []
    const el = time
    const puffs = links.flatMap((d) =>
      Array.from({ length: PER_LINK }, (_, i) => {
        const u = (((el * (0.05 + d.mw / 60000) + i / PER_LINK + (hash(d.id) % 100) / 100) % 1) + 1) % 1
        return { pos: [d.a[0] + (d.b[0] - d.a[0]) * u, d.a[1] + (d.b[1] - d.a[1]) * u, Z], u, g: d.g, r: 18000 + Math.min(20000, d.g * 70) }
      }),
    )
    const tags = links.map((d) => ({ at: d.a, text: `${d.from} ${Math.round(d.g)} g/kWh` }))
    const font = { fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, background: true, backgroundPadding: [7, 4], sizeUnits: 'pixels', parameters: { depthTest: false } }
    return [
      new ScatterplotLayer({
        id: 'carbon-puffs', data: puffs, getPosition: (d) => d.pos, getRadius: (d) => d.r * (0.7 + 0.5 * d.u),
        getFillColor: (d) => [168, 168, 160, Math.round(190 * Math.sin(Math.PI * Math.min(1, d.u * 1.05)) + 40)],
        radiusUnits: 'meters', parameters: { depthTest: false }, updateTriggers: { getPosition: time, getRadius: time, getFillColor: time },
      }),
      new TextLayer({
        id: 'carbon-puff-tags', data: tags, getPosition: (d) => [...d.at, Z], getText: (d) => d.text, getSize: 13,
        getColor: [244, 244, 240, 240], getBackgroundColor: [18, 18, 18, 210], getPixelOffset: [0, -16], getTextAnchor: 'middle', getAlignmentBaseline: 'center', ...font,
      }),
    ].filter(Boolean)
  },
}
