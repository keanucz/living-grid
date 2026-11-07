// Builds web/public/geo/europe.json from Natural Earth (world-atlas) 50m.
// Country outlines stand in for bidding zones until data/static/bidding_zones.geojson lands.
// Run: node scripts/build-geo.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { feature } from 'topojson-client'

const require = createRequire(import.meta.url)
const load = (f) => {
  const t = JSON.parse(readFileSync(require.resolve(`world-atlas/${f}`), 'utf8'))
  return feature(t, t.objects.countries)
}
// Detailed outlines around Europe, light ones for the rest of the world (grey context only).
const detail = load('countries-50m.json')
const coarse = load('countries-110m.json')

const BBOX = [-30, 33, 48, 72]
const ZONE_OF = {
  'United Kingdom': 'GB',
  France: 'FR',
  Germany: 'DE-LU',
  Luxembourg: 'DE-LU',
  Netherlands: 'NL',
  Belgium: 'BE',
  Norway: 'NO2',
}

const inBox = ([x, y]) => x >= BBOX[0] && x <= BBOX[2] && y >= BBOX[1] && y <= BBOX[3]
const round = (ring) => ring.map(([x, y]) => [Math.round(x * 1e2) / 1e2, Math.round(y * 1e2) / 1e2])

// Polygons that wrap the antimeridian (Russia's far east, Fiji) would draw a band across the map.
const spansDateline = (p) => {
  const xs = p[0].map(([x]) => x)
  return Math.max(...xs) - Math.min(...xs) > 180
}

const features = []
const seen = new Set()
for (const [world, near] of [[detail, true], [coarse, false]]) {
  for (const f of world.features) {
    const g = f.geometry
    if (!g) continue
    const name = f.properties.name
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).filter((p) => !spansDateline(p))
    const kept = polys.filter((p) => p[0].some(inBox) === near).map((p) => p.map(round))
    if (!kept.length) continue
    const key = `${name}|${near}`
    if (seen.has(key)) continue
    seen.add(key)
    features.push({
      type: 'Feature',
      properties: { name, zone: near ? ZONE_OF[name] ?? null : null },
      geometry: { type: 'MultiPolygon', coordinates: kept },
    })
  }
}

mkdirSync(new URL('../public/geo/', import.meta.url), { recursive: true })
writeFileSync(
  new URL('../public/geo/europe.json', import.meta.url),
  JSON.stringify({ type: 'FeatureCollection', features }),
)
console.log(`europe.json: ${features.length} countries, ${features.filter((f) => f.properties.zone).length} in zones`)
