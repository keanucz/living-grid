// Builds web/public/geo/europe.json from Natural Earth (world-atlas) 50m.
// Country outlines stand in for bidding zones until data/static/bidding_zones.geojson lands.
// Run: node scripts/build-geo.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { feature } from 'topojson-client'

const require = createRequire(import.meta.url)
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'))
const world = feature(topo, topo.objects.countries)

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
const round = (ring) => ring.map(([x, y]) => [Math.round(x * 1e3) / 1e3, Math.round(y * 1e3) / 1e3])

const features = []
for (const f of world.features) {
  const g = f.geometry
  if (!g) continue
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  const kept = polys.filter((p) => p[0].some(inBox)).map((p) => p.map(round))
  if (!kept.length) continue
  const name = f.properties.name
  features.push({
    type: 'Feature',
    properties: { name, zone: ZONE_OF[name] ?? null },
    geometry: { type: 'MultiPolygon', coordinates: kept },
  })
}

mkdirSync(new URL('../public/geo/', import.meta.url), { recursive: true })
writeFileSync(
  new URL('../public/geo/europe.json', import.meta.url),
  JSON.stringify({ type: 'FeatureCollection', features }),
)
console.log(`europe.json: ${features.length} countries, ${features.filter((f) => f.properties.zone).length} in zones`)
