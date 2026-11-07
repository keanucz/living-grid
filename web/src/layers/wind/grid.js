// The modelled weather grid (GET /weather/grid?t=), shared by the wind layer, the sun layer and the side card.
// One hour at a time, cached; the next hour is fetched ahead so the scrubber does not stall. The grid is 0.5 degrees
// and sparse (only points near Europe's zones), so it is expanded into a dense raster with NaN for missing cells.
export const STEP = 0.5

const cache = new Map() // hour key -> { status: 'loading' | 'ok' | 'none', field }
const subs = new Set()
const notify = () => subs.forEach((f) => f())
export const subscribe = (f) => (subs.add(f), () => subs.delete(f))
export const version = () => cache.size + [...cache.values()].filter((c) => c.status === 'ok').length * 1000

export const hourKey = (at) => {
  const d = at ? new Date(at) : new Date()
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString().replace('.000Z', 'Z')
}
const plusHours = (key, h) => hourKey(new Date(Date.parse(key) + h * 3600e3))

// Decode the compact arrays (tenths of m/s, degrees the wind blows FROM, W/m2) into a dense raster.
export function decode(d) {
  const lons = d.lons
  const lats = d.lats
  const lat0 = Math.min(...lats)
  const lon0 = Math.min(...lons)
  const ny = Math.round((Math.max(...lats) - lat0) / STEP) + 1
  const nx = Math.round((Math.max(...lons) - lon0) / STEP) + 1
  const n = nx * ny
  const u = new Float32Array(n).fill(NaN) // m/s towards the east
  const v = new Float32Array(n).fill(NaN) // m/s towards the north
  const speed = new Float32Array(n).fill(NaN)
  const sw = new Float32Array(n).fill(NaN)
  for (let i = 0; i < lats.length; i++) {
    const k = Math.round((lats[i] - lat0) / STEP) * nx + Math.round((lons[i] - lon0) / STEP)
    const s = d.wind_speed_dms[i] / 10
    const rad = (d.wind_dir_deg[i] * Math.PI) / 180 // direction the wind comes from
    speed[k] = s
    u[k] = -s * Math.sin(rad)
    v[k] = -s * Math.cos(rad)
    sw[k] = d.shortwave_wm2[i]
  }
  return { nx, ny, lat0, lon0, u, v, speed, sw, kind: d.kind, note: d.note, source: d.source, ts: d.ts }
}

async function fetchHour(key) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const r = await fetch(`/api/weather/grid?t=${encodeURIComponent(key)}`, { signal: ctrl.signal })
    if (!r.ok) return null
    return decode(await r.json())
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function ensure(key) {
  if (cache.has(key)) return cache.get(key)
  const entry = { status: 'loading', field: null }
  cache.set(key, entry)
  fetchHour(key).then((field) => {
    entry.status = field ? 'ok' : 'none'
    entry.field = field
    notify()
  })
  if (cache.size > 40) cache.delete(cache.keys().next().value) // oldest first
  return entry
}

// The field for the hour shown on the map (at = ISO hour or null for now); fetches it and the next hour if needed.
export function getField(at) {
  const key = hourKey(at)
  const e = ensure(key)
  ensure(plusHours(key, 1))
  return e.status === 'ok' ? e.field : null
}
export const status = (at) => cache.get(hourKey(at))?.status ?? 'loading'


// Bilinear sample of one raster at lon/lat; NaN outside the mask. Cells without data count as zero weight.
// (Unrolled: called thousands of times per frame by the wind layer.)
export function sample(f, arr, lon, lat) {
  const x = (lon - f.lon0) / STEP
  const y = (lat - f.lat0) / STEP
  const i = Math.floor(x)
  const j = Math.floor(y)
  if (i < 0 || j < 0 || i >= f.nx - 1 || j >= f.ny - 1) return NaN
  const fx = x - i
  const fy = y - j
  const k = j * f.nx + i
  const a = arr[k]
  const b = arr[k + 1]
  const c = arr[k + f.nx]
  const d = arr[k + f.nx + 1]
  const wa = (1 - fx) * (1 - fy)
  const wb = fx * (1 - fy)
  const wc = (1 - fx) * fy
  const wd = fx * fy
  let sum = 0
  let w = 0
  if (a === a) { sum += a * wa; w += wa }
  if (b === b) { sum += b * wb; w += wb }
  if (c === c) { sum += c * wc; w += wc }
  if (d === d) { sum += d * wd; w += wd }
  return w > 0.25 ? sum / w : NaN
}

// Direction text for a wind that blows FROM `deg`.
export const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8]
