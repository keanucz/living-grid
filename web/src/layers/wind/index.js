import { LineLayer } from 'deck.gl'
import { getField, sample } from './grid.js'

// Wind as drifting streaks: a few thousand particles are carried by the modelled 100 m wind and drawn as short lines
// along their motion, brighter and bluer-white the stronger the wind. Time is sped up (1 s of screen = TIME_SCALE s
// of wind) so a gale is visibly faster than a breeze. Follows the scrubber hour. Modelled, not measured.
const N = 2200
const TIME_SCALE = 2400
const MAX_AGE = 3.2
const TRAIL_S = 0.7
const Z = 6500
const LON = [-11, 14]
const LAT = [43, 62]

export const WIND_STOPS = [
  [0, [92, 126, 168]],
  [6, [96, 176, 220]],
  [12, [150, 224, 244]],
  [20, [255, 255, 255]],
]
export function windColor(speed, alpha = 255) {
  const stops = WIND_STOPS
  if (speed <= stops[0][0]) return [...stops[0][1], alpha]
  for (let i = 1; i < stops.length; i++) {
    if (speed <= stops[i][0]) {
      const [s0, c0] = stops[i - 1]
      const [s1, c1] = stops[i]
      const t = (speed - s0) / (s1 - s0)
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)).concat(alpha)
    }
  }
  return [...stops.at(-1)[1], alpha]
}

const ps = { lon: new Float32Array(N), lat: new Float32Array(N), age: new Float32Array(N), life: new Float32Array(N) }
let seeded = false
let last = 0

function respawn(f, i) {
  for (let tries = 0; tries < 12; tries++) {
    const lon = LON[0] + Math.random() * (LON[1] - LON[0])
    const lat = LAT[0] + Math.random() * (LAT[1] - LAT[0])
    if (Number.isFinite(sample(f, f.speed, lon, lat))) {
      ps.lon[i] = lon
      ps.lat[i] = lat
      ps.age[i] = 0
      ps.life[i] = MAX_AGE * (0.5 + Math.random() * 0.5)
      return
    }
  }
  ps.age[i] = ps.life[i] = 1e9 // nowhere sensible to be: try again next frame
}

export default {
  id: 'wind',
  label: 'Wind',
  swatch: '#7fd0f0',
  order: 46,
  modes: ['overview'],
  defaultOn: false,
  build({ ui, time }) {
    const f = getField(ui.at)
    if (!f) return []
    const dt = Math.min(0.1, Math.max(0, time - last))
    last = time
    if (!seeded) {
      for (let i = 0; i < N; i++) {
        respawn(f, i)
        ps.age[i] = Math.random() * ps.life[i]
      }
      seeded = true
    }
    const src = new Float32Array(N * 3)
    const dst = new Float32Array(N * 3)
    const col = new Uint8Array(N * 4)
    for (let i = 0; i < N; i++) {
      ps.age[i] += dt
      const s = sample(f, f.speed, ps.lon[i], ps.lat[i])
      if (ps.age[i] > ps.life[i] || !Number.isFinite(s)) {
        respawn(f, i)
        continue
      }
      const uu = sample(f, f.u, ps.lon[i], ps.lat[i])
      const vv = sample(f, f.v, ps.lon[i], ps.lat[i])
      const cosLat = Math.cos((ps.lat[i] * Math.PI) / 180)
      const dLon = ((uu * TIME_SCALE) / (111320 * cosLat)) * dt
      const dLat = ((vv * TIME_SCALE) / 110540) * dt
      ps.lon[i] += dLon
      ps.lat[i] += dLat
      const k = TRAIL_S / Math.max(dt, 1e-3)
      src[i * 3] = ps.lon[i] - dLon * k
      src[i * 3 + 1] = ps.lat[i] - dLat * k
      src[i * 3 + 2] = Z
      dst[i * 3] = ps.lon[i]
      dst[i * 3 + 1] = ps.lat[i]
      dst[i * 3 + 2] = Z
      const fade = Math.min(1, ps.age[i] / 0.4, (ps.life[i] - ps.age[i]) / 0.5)
      const c = windColor(s, Math.round(255 * Math.max(0, fade) * Math.min(0.95, 0.3 + s / 18)))
      col.set(c, i * 4)
    }
    return [
      new LineLayer({
        id: 'wind-streaks',
        data: { length: N, attributes: { getSourcePosition: { value: src, size: 3 }, getTargetPosition: { value: dst, size: 3 }, getColor: { value: col, size: 4 } } },
        widthUnits: 'pixels',
        getWidth: 1.4,
        parameters: { depthTest: false },
        pickable: false,
      }),
    ]
  },
}
