import { GeoJsonLayer, ScatterplotLayer, PathLayer } from 'deck.gl'
import regions from './regions.json'
import farms from './farms.json'
import { getGhostWind, load, WINDOWS } from './data.js'

const TEAL = [94, 214, 196]
const Z = 7000 // above the glass slabs

// Spread each region's estimate over its mapped farms by capacity (an estimate, labelled as such).
function farmShares(d) {
  const byRegion = Object.fromEntries((d?.regions ?? []).map((r) => [r.region, (r.boalf_mwh ?? 0) + (r.weather_gap_mwh ?? 0) / 2]))
  const cap = {}
  for (const f of farms) cap[f.region] = (cap[f.region] ?? 0) + f.mw
  return farms.map((f) => ({ ...f, mwh: ((byRegion[f.region] ?? 0) * f.mw) / (cap[f.region] || 1) }))
}

const mwhText = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} GWh` : `${Math.round(v).toLocaleString('en-GB')} MWh`)

// Hover card for one farm (MapView shows any layer's `tooltip` prop). The farm's share is its region's estimate split by
// capacity, so it is labelled as an estimate.
function farmTooltip(f, windowKey) {
  const when = WINDOWS[windowKey]?.label ?? 'Last 24 h'
  const off = f.mwh > 0 ? `About ${mwhText(f.mwh)} switched off` : 'Nothing switched off'
  return `<b>${f.name}</b><br/>${f.mw.toLocaleString('en-GB')} MW capacity<br/>${off} · ${when}<br/><span style="opacity:.6">Estimated from its region's total</span>`
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
        data: fs.filter((f) => f.mwh > 0),
        getPosition: (f) => [...f.coord, Z],
        getRadius: (f) => 9000 + 38000 * Math.sqrt(f.mwh / fmax) * (0.85 + 0.3 * pulse),
        getFillColor: [...TEAL, 40 + 50 * pulse],
        stroked: true,
        getLineColor: [...TEAL, 120 + 100 * pulse],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.2,
        pickable: true,
        tooltip: (f) => farmTooltip(f, gw.window),
        updateTriggers: { getRadius: [time, d], getFillColor: [time, d], getLineColor: [time, d] },
        parameters: { depthTest: false },
      }),
      new ScatterplotLayer({
        id: 'ghostwind-core',
        data: fs,
        getPosition: (f) => [...f.coord, Z],
        // Farms with nothing switched off are only this small dot; a wider invisible hit area keeps them hoverable.
        getRadius: 3,
        radiusUnits: 'pixels',
        radiusMinPixels: 3,
        getFillColor: (f) => (f.mwh > 0 ? [230, 255, 250, 230] : [...TEAL, 200]),
        stroked: true,
        getLineColor: [0, 0, 0, 1],
        getLineWidth: 8,
        lineWidthUnits: 'pixels',
        pickable: true,
        tooltip: (f) => farmTooltip(f, gw.window),
        updateTriggers: { getFillColor: [d] },
        parameters: { depthTest: false },
      }),
    ]
  },
}
