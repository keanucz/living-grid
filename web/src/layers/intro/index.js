import { PathLayer, ScatterplotLayer } from 'deck.gl'
import { ROUTE } from '../../intro/route.js'

// The intro's match cut: while the pylon intro plays, the conductors continue on the real map as the line's route
// with current pulses along it. Drawn only while ui.intro is set; hidden from the Layers menu (no chip).
const LIME = [197, 240, 107]
const along = (t) => {
  const n = ROUTE.length - 1
  const f = Math.min(0.9999, Math.max(0, t)) * n
  const i = Math.floor(f)
  const u = f - i
  return [ROUTE[i][0] + (ROUTE[i + 1][0] - ROUTE[i][0]) * u, ROUTE[i][1] + (ROUTE[i + 1][1] - ROUTE[i][1]) * u, 4000]
}

export default {
  id: 'intro',
  hidden: true,
  order: 90,
  modes: ['overview', 'simulate'],
  defaultOn: true,
  build({ ui, time }) {
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
