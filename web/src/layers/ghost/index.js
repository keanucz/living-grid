import { GeoJsonLayer, PathLayer } from 'deck.gl'
import { priceColor } from '../../styles/tokens.js'
import { zoneSeries } from './series.js'

// Forecast ghost: when the scrubber is ahead of now, each zone floats a translucent slab coloured by
// the forecast P50 for that hour. Opacity falls as the P10-P90 band widens (less certain, fainter ghost).
const series = {}
let loading = false
function ensure(zones) {
  if (loading || !zones?.length) return
  loading = true
  Promise.all(zones.map((z) => zoneSeries(z.id).then((d) => (series[z.id] = d)))).finally(() => {
    loading = false
    setTimeout(() => Object.keys(series).forEach((k) => delete series[k]), 5 * 60_000)
  })
}

export function ghostAt(zoneId, at, currency) {
  const row = series[zoneId]?.forecast?.find((r) => r.ts === at)
  if (!row) return null
  const k = currency === 'GBP' ? 1.15 : 1
  const width = (row.p90 - row.p10) / Math.max(1, Math.abs(row.p50))
  return { ...row, eur: row.p50 * k, certainty: Math.max(0.15, Math.min(0.85, 1 - width)) }
}

const Z = 16000

export default {
  id: 'ghost',
  label: 'Forecast',
  swatch: '#c5f06b',
  order: 15,
  modes: ['overview', 'simulate'],
  defaultOn: true,
  build({ data, ui, zoneById }) {
    ensure(data.zones?.zones)
    if (!ui.at || Date.parse(ui.at) <= Date.now() || !data.geo) return []
    const feats = data.geo.features
      .filter((f) => f.properties.zone)
      .map((f) => ({ f, g: ghostAt(f.properties.zone, ui.at, zoneById[f.properties.zone]?.currency) }))
      .filter((d) => d.g)
    const rings = feats.flatMap(({ f, g }) =>
      (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => ({ g, path: p[0].map(([x, y]) => [x, y, Z]) })),
    )
    return [
      new GeoJsonLayer({
        id: 'ghost-slab',
        data: feats.map((d) => ({ ...d.f, properties: { ...d.f.properties, g: d.g } })),
        extruded: true,
        getElevation: Z,
        filled: true,
        stroked: false,
        getFillColor: (f) => priceColor(f.properties.g.eur, 40 + 110 * f.properties.g.certainty),
        material: { ambient: 0.8, diffuse: 0.3, shininess: 140, specularColor: [120, 140, 110] },
        pickable: true,
        updateTriggers: { getFillColor: [ui.at] },
        parameters: { depthWriteEnabled: false },
      }),
      new PathLayer({
        id: 'ghost-edge',
        data: rings,
        getPath: (d) => d.path,
        getColor: (d) => [214, 255, 160, 60 + 160 * d.g.certainty],
        getWidth: 1.4,
        widthUnits: 'pixels',
        updateTriggers: { getColor: [ui.at] },
      }),
    ]
  },
}
