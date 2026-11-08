import { PathLayer, ScatterplotLayer, TextLayer } from 'deck.gl'
import { EDINBURGH, ROUTE } from '../../intro/route.js'

// The intro on the real map, hidden from the Layers menu (no chip). During the pylon shot (ui.intro === 'pylon') the
// conductors continue on the map as the line's route with current pulses along it, for the match cut. After it
// (ui.intro === 'map', #308) a clear dot on Edinburgh, labelled, while the map zooms out.
const LIME = [197, 240, 107]
const along = (t) => {
  const n = ROUTE.length - 1
  const f = Math.min(0.9999, Math.max(0, t)) * n
  const i = Math.floor(f)
  const u = f - i
  return [ROUTE[i][0] + (ROUTE[i + 1][0] - ROUTE[i][0]) * u, ROUTE[i][1] + (ROUTE[i + 1][1] - ROUTE[i][1]) * u, 4000]
}
const here = [EDINBURGH.longitude, EDINBURGH.latitude, 0]
const label = (id, text, size, y, colour) =>
  new TextLayer({ id, data: [here], getPosition: (d) => d, getText: () => text, getSize: size, getColor: colour, getPixelOffset: [0, y],
    fontFamily: 'Inter, sans-serif', fontWeight: 600, outlineWidth: 4, outlineColor: [8, 8, 8, 230], fontSettings: { sdf: true }, parameters: { depthTest: false } })

export default {
  id: 'intro',
  hidden: true,
  order: 90,
  modes: ['overview', 'simulate'],
  defaultOn: true,
  build({ ui, time }) {
    if (ui.intro === 'map') {
      const pulse = (time * 0.8) % 1
      return [
        new ScatterplotLayer({ id: 'intro-here-pulse', data: [here], getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 8 + 22 * pulse, stroked: true, filled: false,
          getLineColor: [...LIME, Math.round(200 * (1 - pulse))], lineWidthUnits: 'pixels', getLineWidth: 2, parameters: { depthTest: false },
          updateTriggers: { getRadius: pulse, getLineColor: pulse } }),
        new ScatterplotLayer({ id: 'intro-here', data: [here], getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 7, stroked: true,
          getFillColor: [255, 255, 255, 255], getLineColor: [...LIME, 255], lineWidthUnits: 'pixels', getLineWidth: 3, parameters: { depthTest: false } }),
        label('intro-here-name', 'Edinburgh', 17, -40, [245, 247, 240, 255]),
        label('intro-here-you', 'You are here', 13, -20, [...LIME, 255]),
      ]
    }
    if (!ui.intro) return []
    const path = [{ path: ROUTE.map(([x, y]) => [x, y, 4000]) }]
    const pulses = Array.from({ length: 9 }, (_, k) => ({ p: along(((time * 0.22 + k / 9) % 1)) }))
    return [
      new PathLayer({ id: 'intro-glow', data: path, getPath: (d) => d.path, getColor: [...LIME, 60], getWidth: 9, widthUnits: 'pixels', capRounded: true, parameters: { depthTest: false } }),
      new PathLayer({ id: 'intro-line', data: path, getPath: (d) => d.path, getColor: [...LIME, 230], getWidth: 2, widthUnits: 'pixels', capRounded: true, parameters: { depthTest: false } }),
      new ScatterplotLayer({ id: 'intro-pulse', data: pulses, getPosition: (d) => d.p, getRadius: 6, radiusUnits: 'pixels', getFillColor: [255, 255, 255, 240], parameters: { depthTest: false } }),
    ]
  },
}
