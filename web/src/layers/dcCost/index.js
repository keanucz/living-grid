import { GeoJsonLayer } from 'deck.gl'

// Data centre cost map: the six zones tinted by the annual energy cost of the current spec (from GET /datacentre),
// cheap to dear on one scale. Not part of the Layers menu: the data centre page builds it itself.
export const ZONE_ORDER = ['GB', 'FR', 'DE-LU', 'NL', 'BE', 'NO2']
export const ZONE_NAME = { GB: 'Britain', FR: 'France', 'DE-LU': 'Germany', NL: 'Netherlands', BE: 'Belgium', NO2: 'S. Norway' }
export const ZONE_LABEL = { GB: [-2.4, 54.2], FR: [2.4, 46.8], 'DE-LU': [10.3, 51.4], NL: [5.4, 52.25], BE: [4.6, 50.55], NO2: [7.2, 59.2] }
// Scottish regions: the ones behind the B6 boundary, where a new site can meet the same limits that waste wind.
export const SCOTLAND = ['N', 'P']

const CHEAP = [197, 240, 107]
const DEAR = [255, 112, 40]
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

// Colour on the range of the zones' costs (min cheap, max dear).
export function costScale(costs) {
  const v = Object.values(costs).filter((x) => Number.isFinite(x))
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  return { lo, hi, at: (c) => (hi > lo ? mix(CHEAP, DEAR, (c - lo) / (hi - lo)) : mix(CHEAP, DEAR, 0.5)) }
}

function inRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function inGeom(x, y, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  return polys.some(([outer, ...holes]) => inRing(x, y, outer) && !holes.some((h) => inRing(x, y, h)))
}

// Which place a dropped pin is in: a GB region letter when it is in one, else a zone id, else null.
export function locate(lng, lat, geo, regions) {
  const r = regions?.features?.find((f) => inGeom(lng, lat, f.geometry))
  if (r) return { location: r.properties.region, zone: 'GB', name: r.properties.name }
  const z = geo?.features?.find((f) => ZONE_ORDER.includes(f.properties?.zone) && inGeom(lng, lat, f.geometry))
  return z ? { location: z.properties.zone, zone: z.properties.zone, name: ZONE_NAME[z.properties.zone] } : null
}

// geo: the world (public/geo/europe.json); costs: { zone: annual cost }; hot: region letters to outline as a warning.
export function buildCostLayers({ geo, regions, costs, hot = [], marked = [] }) {
  if (!geo) return []
  const scale = costs && Object.keys(costs).length ? costScale(costs) : null
  return [
    new GeoJsonLayer({
      id: 'dc-land', data: geo, filled: true, stroked: true, getFillColor: [38, 38, 36, 255], getLineColor: [64, 64, 62, 255],
      getLineWidth: 0.8, lineWidthUnits: 'pixels',
    }),
    new GeoJsonLayer({
      id: 'dc-zones', data: { type: 'FeatureCollection', features: geo.features.filter((f) => ZONE_ORDER.includes(f.properties?.zone)) },
      filled: true, stroked: true, pickable: true,
      getFillColor: (f) => (scale && costs[f.properties.zone] != null ? [...scale.at(costs[f.properties.zone]), 215] : [70, 70, 66, 255]),
      getLineColor: [10, 10, 10, 255], getLineWidth: 1.2, lineWidthUnits: 'pixels',
      transitions: { getFillColor: 350 }, updateTriggers: { getFillColor: [JSON.stringify(costs)] },
    }),
    regions && new GeoJsonLayer({
      id: 'dc-regions', data: regions, filled: true, stroked: true, pickable: false,
      getFillColor: (f) => (marked.includes(f.properties.region) ? [255, 255, 255, 60] : [0, 0, 0, 0]),
      getLineColor: (f) => (hot.includes(f.properties.region) ? [255, 140, 40, 255] : [10, 10, 10, 90]),
      getLineWidth: (f) => (hot.includes(f.properties.region) ? 2.5 : 0.6), lineWidthUnits: 'pixels',
      updateTriggers: { getFillColor: [marked.join()], getLineColor: [hot.join()], getLineWidth: [hot.join()] },
    }),
  ].filter(Boolean)
}
