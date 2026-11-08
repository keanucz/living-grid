import { sample } from './grid.js'

// The streak engine shared by the Wind layer and the wind in a What if simulation. A few thousand particles are carried by
// the modelled 100 m wind field and drawn as short lines along their motion. One engine instance owns preallocated
// buffers, so a frame allocates nothing beyond a small data wrapper. Time is sped up (1 s of screen = TIME_SCALE s of wind),
// so a gale visibly outruns a breeze. With prefers-reduced-motion the particles stay put (the streaks still show direction).
export const TIME_SCALE = 2400
const MAX_AGE = 3.2
const TRAIL_S = 0.7
export const Z = 6500
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

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function createStreaks(n = 2200) {
  const lon = new Float32Array(n)
  const lat = new Float32Array(n)
  const age = new Float32Array(n)
  const life = new Float32Array(n)
  const src = new Float32Array(n * 3)
  const dst = new Float32Array(n * 3)
  const col = new Uint8Array(n * 4)
  const rank = new Float32Array(n) // a fixed random 0..1 per particle: which ones a lower density switches off
  for (let i = 0; i < n; i++) rank[i] = Math.random()
  let seeded = false
  let last = 0

  const respawn = (f, i) => {
    for (let tries = 0; tries < 12; tries++) {
      const x = LON[0] + Math.random() * (LON[1] - LON[0])
      const y = LAT[0] + Math.random() * (LAT[1] - LAT[0])
      if (Number.isFinite(sample(f, f.speed, x, y))) {
        lon[i] = x
        lat[i] = y
        age[i] = 0
        life[i] = MAX_AGE * (0.5 + Math.random() * 0.5)
        return
      }
    }
    age[i] = life[i] = 1e9 // nowhere sensible to be: try again next frame
  }

  // opts.speedAt(lon, lat) scales the wind there (default 1); opts.boostAt(lon, lat) brightens streaks there (default 0);
  // opts.density 0..1 is the share of particles drawn. Returns the LineLayer `data` (binary attributes).
  return function frame(f, time, opts = {}) {
    const { speedAt, boostAt, density = 1 } = opts
    const still = reducedMotion()
    const dt = still ? 0 : Math.min(0.1, Math.max(0, time - last))
    last = time
    if (!seeded) {
      for (let i = 0; i < n; i++) {
        respawn(f, i)
        age[i] = Math.random() * life[i]
      }
      seeded = true
    }
    const trailDt = dt > 1e-3 ? dt : 1 / 60
    for (let i = 0; i < n; i++) {
      const o = i * 3
      if (rank[i] > density) {
        col[i * 4 + 3] = 0
        continue
      }
      age[i] += dt
      const s0 = sample(f, f.speed, lon[i], lat[i])
      if (age[i] > life[i] || !Number.isFinite(s0)) {
        respawn(f, i)
        col[i * 4 + 3] = 0
        continue
      }
      const k = speedAt ? speedAt(lon[i], lat[i]) : 1
      const s = s0 * k
      const uu = sample(f, f.u, lon[i], lat[i]) * k
      const vv = sample(f, f.v, lon[i], lat[i]) * k
      const cosLat = Math.cos((lat[i] * Math.PI) / 180)
      const dLon = ((uu * TIME_SCALE) / (111320 * cosLat)) * trailDt
      const dLat = ((vv * TIME_SCALE) / 110540) * trailDt
      if (!still) {
        lon[i] += dLon * (dt / trailDt)
        lat[i] += dLat * (dt / trailDt)
      }
      const reach = TRAIL_S / trailDt
      src[o] = lon[i] - dLon * reach
      src[o + 1] = lat[i] - dLat * reach
      src[o + 2] = Z
      dst[o] = lon[i]
      dst[o + 1] = lat[i]
      dst[o + 2] = Z
      const fade = still ? 1 : Math.min(1, age[i] / 0.4, (life[i] - age[i]) / 0.5)
      const boost = boostAt ? boostAt(lon[i], lat[i]) : 0
      const c = windColor(Math.min(24, s * (1 + 0.5 * boost)), 0)
      col[i * 4] = c[0]
      col[i * 4 + 1] = c[1]
      col[i * 4 + 2] = c[2]
      col[i * 4 + 3] = Math.round(255 * Math.max(0, fade) * Math.min(0.98, (0.3 + s / 18) * (1 + 0.45 * boost)))
    }
    return { length: n, attributes: { getSourcePosition: { value: src, size: 3 }, getTargetPosition: { value: dst, size: 3 }, getColor: { value: col, size: 4 } } }
  }
}
