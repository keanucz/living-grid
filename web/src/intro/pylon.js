// A lattice pylon and its conductors, drawn as line segments in metres around the pylon (x east, y along the line, z up).
const H = 52 // tower height
const SPAN = 320 // distance to the next pylon along the line
const SAG = 12
const ARMS = [
  { z: 0.6 * H, w: 10 },
  { z: 0.77 * H, w: 9 },
  { z: 0.94 * H, w: 7.5 },
]
const halfAt = (z) => 4.6 - (3.4 * Math.min(z, 0.7 * H)) / (0.7 * H) // legs taper to the waist, then run straight

export function tower(y0 = 0) {
  const seg = []
  const add = (a, b) => seg.push({ a: [a[0], a[1] + y0, a[2]], b: [b[0], b[1] + y0, b[2]] })
  const levels = []
  for (let z = 0; z <= H; z += 4) levels.push(z)
  const corner = (z) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [sx * halfAt(z), sy * halfAt(z), z])
  levels.forEach((z, i) => {
    const c = corner(z)
    for (let k = 0; k < 4; k++) add(c[k], c[(k + 1) % 4])
    if (i > 0) {
      const p = corner(levels[i - 1])
      for (let k = 0; k < 4; k++) {
        add(p[k], c[k])
        add(p[k], c[(k + 1) % 4]) // diagonal brace on each face
      }
    }
  })
  const out = []
  for (const arm of ARMS) {
    for (const s of [-1, 1]) {
      const root = [s * halfAt(arm.z), 0, arm.z]
      const tip = [s * arm.w, 0, arm.z]
      add(root, tip)
      add([s * halfAt(arm.z - 4), 0, arm.z - 4], tip) // arm brace
      add(tip, [s * arm.w, 0, arm.z - 5]) // insulator string
      out.push([s * arm.w, 0, arm.z - 5])
    }
  }
  add([0, 0, H], [0, 0, H + 6]) // earth peak
  return { seg, attach: out }
}

// The line: pylons every SPAN metres towards the horizon, with sagging conductors between them.
export function line(count = 14) {
  const seg = []
  const conductors = []
  const { attach } = tower(0)
  for (let n = 0; n < count; n++) {
    seg.push(...tower(n * SPAN).seg)
    for (const a of attach) {
      const pts = []
      for (let k = 0; k <= 12; k++) {
        const u = k / 12
        pts.push([a[0], a[1] + n * SPAN + u * SPAN, a[2] - SAG * 4 * u * (1 - u)])
      }
      conductors.push(pts)
      for (let k = 0; k < 12; k++) seg.push({ a: pts[k], b: pts[k + 1], conductor: true })
    }
  }
  return { seg, conductors, span: SPAN, height: H }
}

// A point a fraction u of the way along the whole run on conductor c (0 to 5), six conductors per bay.
export function pointOn(conductors, c, u) {
  const bays = conductors.length / 6
  const f = Math.min(0.9999, u) * bays
  const bay = Math.floor(f)
  const pts = conductors[bay * 6 + (c % 6)]
  const g = (f - bay) * 12
  const i = Math.floor(g)
  const w = g - i
  return pts[i].map((v, k) => v + (pts[i + 1][k] - v) * w)
}
