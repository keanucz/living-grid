import { GeoJsonLayer, ScatterplotLayer, PathLayer } from 'deck.gl'
import regions from './regions.json'
import farms from './farms.json'
import { getGhostWind, load } from './data.js'

const TEAL = [94, 214, 196]
const Z = 7000 // above the glass slabs

// Spread each region's estimate over its mapped farms by capacity (an estimate, labelled as such).
function farmShares(d) {
  const byRegion = Object.fromEntries((d?.regions ?? []).map((r) => [r.region, (r.boalf_mwh ?? 0) + (r.weather_gap_mwh ?? 0) / 2]))
  const cap = {}
  for (const f of farms) cap[f.region] = (cap[f.region] ?? 0) + f.mw
  return farms.map((f) => ({ ...f, mwh: ((byRegion[f.region] ?? 0) * f.mw) / (cap[f.region] || 1) }))
}

export default {
  id: 'ghostWind',
  label: 'Ghost wind',
  swatch: '#5ed6c4',
  order: 40,
  modes: ['overview', 'simulate'],
  defaultOn: false,
  build({ time }) {
    const gw = getGhostWind()
    if (!gw.window && !gw.loading) load('live')
    const d = gw.data
    const max = Math.max(1, ...(d?.regions ?? []).map((r) => r.boalf_mwh ?? 0))
    const intensity = Object.fromEntries((d?.regions ?? []).map((r) => [r.region, (r.boalf_mwh ?? 0) / max]))
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2)
    const fs = farmShares(d)
    const fmax = Math.max(1, ...fs.map((f) => f.mwh))

    return [
      new GeoJsonLayer({
        id: 'ghostwind-regions',
        data: regions,
        filled: true,
        stroked: false,
        getFillColor: (f) => [...TEAL, 30 + 90 * (intensity[f.properties.region] ?? 0)],
        updateTriggers: { getFillColor: [gw.window, d] },
        parameters: { depthTest: false },
      }),
      new PathLayer({
        id: 'ghostwind-region-edge',
        data: regions.features.flatMap((f) =>
          (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => ({ path: p[0].map(([x, y]) => [x, y, Z]) })),
        ),
        getPath: (r) => r.path,
        getColor: [...TEAL, 160],
        getWidth: 1.4,
        widthUnits: 'pixels',
      }),
      new ScatterplotLayer({
        id: 'ghostwind-halo',
        data: fs,
        getPosition: (f) => [...f.coord, Z],
        getRadius: (f) => 9000 + 38000 * Math.sqrt(f.mwh / fmax) * (0.85 + 0.3 * pulse),
        getFillColor: (f) => [...TEAL, f.mwh ? 40 + 50 * pulse : 0],
        stroked: true,
        getLineColor: (f) => [...TEAL, f.mwh ? 120 + 100 * pulse : 60],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.2,
        pickable: true,
        updateTriggers: { getRadius: [time, d], getFillColor: [time, d], getLineColor: [time, d] },
        parameters: { depthTest: false },
      }),
      new ScatterplotLayer({
        id: 'ghostwind-core',
        data: fs,
        getPosition: (f) => [...f.coord, Z],
        getRadius: 3,
        radiusUnits: 'pixels',
        getFillColor: [230, 255, 250, 230],
        parameters: { depthTest: false },
      }),
    ]
  },
}
