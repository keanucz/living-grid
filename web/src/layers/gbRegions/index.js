import { GeoJsonLayer, ScatterplotLayer, TextLayer } from 'deck.gl'
import geo from './regions.json'
import { getRegions, load, openHousehold } from './data.js'
import { carbonColor } from '../carbon/index.js'

const Z = 7200
const TEAL = [94, 214, 196]
const NEUTRAL = [150, 160, 175]
const NOTE = 'One GB wholesale price. Regions differ in carbon (modelled) and retail charges.'

export default {
  id: 'gbRegions',
  label: 'GB regions',
  swatch: '#7aa2f7',
  order: 35,
  modes: ['overview'],
  defaultOn: false,
  build({ time }) {
    load()
    const { data, source } = getRegions()
    const rows = Object.fromEntries((data?.regions ?? []).map((r) => [r.region, r]))
    const colour = (region, alpha) => {
      const g = rows[region]?.carbon_gco2_kwh
      return g == null ? [...NEUTRAL, Math.round(alpha * 0.45)] : carbonColor(g, alpha)
    }
    const ghostMax = Math.max(1, ...Object.values(rows).map((r) => r.ghost_wind_mwh_24h ?? 0))
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2)
    const labels = (data?.regions ?? [])
      .filter((r) => r.centroid)
      .map((r) => {
        const carbon = r.carbon_gco2_kwh != null ? `${Math.round(r.carbon_gco2_kwh)} g` : 'carbon n/a'
        const agile = r.agile_tonight_min_p_kwh != null ? `${r.agile_tonight_min_p_kwh.toFixed(0)}p tonight` : 'Agile n/a'
        return { ...r, text: `${r.name}\n${carbon} · ${agile}` }
      })
    const ghost = (data?.regions ?? []).filter((r) => r.ghost_wind_mwh_24h > 0 && r.centroid)
    const hint = `${NOTE}${source === 'fixture' ? ' Sample snapshot: live regional data not loaded.' : ''}`

    return [
      new GeoJsonLayer({
        id: 'gbregions-fill',
        data: geo,
        filled: true,
        stroked: true,
        getFillColor: (f) => colour(f.properties.region, 96),
        getLineColor: (f) => colour(f.properties.region, 230),
        getLineWidth: 1.4,
        lineWidthUnits: 'pixels',
        pickable: true,
        onClick: (info) => {
          if (!info.object) return false
          openHousehold(info.object.properties.region)
          return true
        },
        updateTriggers: { getFillColor: [data], getLineColor: [data] },
        parameters: { depthTest: false },
      }),
      new ScatterplotLayer({
        id: 'gbregions-ghost-wind',
        data: ghost,
        getPosition: (d) => [...d.centroid, Z],
        getRadius: (d) => 12000 + 26000 * Math.sqrt(d.ghost_wind_mwh_24h / ghostMax) * (0.9 + 0.1 * pulse),
        getFillColor: [...TEAL, 50],
        stroked: true,
        getLineColor: [...TEAL, 220],
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        updateTriggers: { getRadius: [data, time] },
        parameters: { depthTest: false },
      }),
      new TextLayer({
        id: 'gbregions-labels',
        data: labels,
        getPosition: (d) => [...d.centroid, Z],
        getText: (d) => d.text,
        getSize: 11,
        sizeUnits: 'pixels',
        getColor: [244, 244, 240, 240],
        background: true,
        getBackgroundColor: [18, 18, 18, 205],
        backgroundPadding: [5, 3],
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 600,
        lineHeight: 1.2,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        pickable: true,
        onClick: (info) => {
          if (!info.object) return false
          openHousehold(info.object.region)
          return true
        },
        updateTriggers: { getText: [data] },
        parameters: { depthTest: false },
      }),
      new TextLayer({
        id: 'gbregions-note',
        data: [{ text: hint }],
        getPosition: [2.2, 59.6, Z],
        getText: (d) => d.text,
        getSize: 12,
        sizeUnits: 'pixels',
        getColor: [200, 205, 215, 235],
        maxWidth: 260,
        wordBreak: 'break-word',
        background: true,
        getBackgroundColor: [18, 18, 18, 180],
        backgroundPadding: [6, 4],
        fontFamily: 'Inter, system-ui, sans-serif',
        getTextAnchor: 'start',
        parameters: { depthTest: false },
        updateTriggers: { getText: [source] },
      }),
    ]
  },
}
