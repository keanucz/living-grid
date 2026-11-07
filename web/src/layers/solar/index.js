import { BitmapLayer } from 'deck.gl'
import { STEP, getField } from '../wind/grid.js'

// Sunshine as soft shading: the modelled shortwave radiation (W/m2) on the 0.5 degree grid, smoothed and drawn as one
// image under the other layers. Follows the scrubber hour; at night there is nothing to show. Modelled, not measured.
const W = 300 // pixels across; rows follow the map's projection so the image lines up
export const SUN_STOPS = [
  [0, [255, 150, 40]],
  [300, [255, 190, 60]],
  [600, [255, 225, 110]],
  [900, [255, 250, 200]],
]
export function sunColor(w) {
  const t = Math.max(0, Math.min(900, w))
  for (let i = 1; i < SUN_STOPS.length; i++) {
    if (t <= SUN_STOPS[i][0]) {
      const [a, ca] = SUN_STOPS[i - 1]
      const [b, cb] = SUN_STOPS[i]
      const u = (t - a) / (b - a)
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * u))
    }
  }
  return SUN_STOPS.at(-1)[1]
}

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const latOf = (y) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI

// Bilinear sample that fades to nothing at the edge of the data instead of cutting off.
function coverageSample(f, lon, lat) {
  const x = (lon - f.lon0) / STEP
  const y = (lat - f.lat0) / STEP
  const i = Math.floor(x)
  const j = Math.floor(y)
  if (i < -1 || j < -1 || i >= f.nx || j >= f.ny) return [0, 0]
  const fx = x - i
  const fy = y - j
  let sum = 0
  let cover = 0
  for (const [di, dj, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const ii = i + di
    const jj = j + dj
    if (ii < 0 || jj < 0 || ii >= f.nx || jj >= f.ny) continue
    const v = f.sw[jj * f.nx + ii]
    if (Number.isFinite(v)) {
      sum += v * w
      cover += w
    }
  }
  return cover > 0 ? [sum / cover, cover] : [0, 0]
}

const images = new WeakMap() // field -> { canvas, bounds, any }

function render(f) {
  const lonMin = f.lon0 - STEP / 2
  const lonMax = f.lon0 + (f.nx - 1) * STEP + STEP / 2
  const latMin = f.lat0 - STEP / 2
  const latMax = f.lat0 + (f.ny - 1) * STEP + STEP / 2
  const yMin = mercY(latMin)
  const yMax = mercY(latMax)
  const H = Math.round((W * (yMax - yMin)) / (((lonMax - lonMin) * Math.PI) / 180))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(W, H)
  let any = false
  for (let r = 0; r < H; r++) {
    const lat = latOf(yMax - ((yMax - yMin) * (r + 0.5)) / H)
    for (let c = 0; c < W; c++) {
      const lon = lonMin + ((lonMax - lonMin) * (c + 0.5)) / W
      const [w, cover] = coverageSample(f, lon, lat)
      const o = (r * W + c) * 4
      if (w > 5 && cover > 0) {
        const [R, G, B] = sunColor(w)
        img.data[o] = R
        img.data[o + 1] = G
        img.data[o + 2] = B
        img.data[o + 3] = Math.round(255 * Math.min(0.62, (w / 900) ** 0.7 * 0.7) * Math.min(1, cover * 1.6))
        any = true
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return { canvas, bounds: [lonMin, latMin, lonMax, latMax], any }
}

export default {
  id: 'solar',
  label: 'Sun',
  swatch: '#ffc04a',
  order: 45,
  modes: ['overview'],
  defaultOn: false,
  build({ ui }) {
    const f = getField(ui.at)
    if (!f) return []
    if (!images.has(f)) images.set(f, render(f))
    const im = images.get(f)
    if (!im.any) return []
    return [new BitmapLayer({ id: 'solar-shade', image: im.canvas, bounds: im.bounds, opacity: 1, parameters: { depthTest: false }, pickable: false })]
  },
}
