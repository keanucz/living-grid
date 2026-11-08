// Slims web/public/geo/europe.json to the part of the map the deck draws (lon -11..15, lat 43..62), 2 decimal places,
// into src/geo.json. Run from this folder: node scripts/slim-geo.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = JSON.parse(readFileSync(process.env.GEO ?? resolve(here, '../../../web/public/geo/europe.json'), 'utf8'))
const BOX = { lon: [-11, 15], lat: [43, 62] }
const r2 = (n) => Math.round(n * 100) / 100
const rings = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
const inBox = ([x, y]) => x > BOX.lon[0] && x < BOX.lon[1] && y > BOX.lat[0] && y < BOX.lat[1]
const out = []
for (const f of src.features) {
  const polys = rings(f.geometry)
    .filter((p) => p[0].some(inBox))
    .map((p) => p.map((ring) => ring.map(([x, y]) => [r2(x), r2(y)])))
  if (polys.length) out.push({ zone: f.properties.zone ?? null, name: f.properties.name, polys })
}
writeFileSync(resolve(here, '../src/geo.json'), JSON.stringify(out))
console.log(out.length, 'features')
