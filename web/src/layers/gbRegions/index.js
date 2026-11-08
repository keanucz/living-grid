import { GeoJsonLayer } from 'deck.gl'
import geo from './regions.json'
import { getRegions, load } from './data.js'
import { regionColour, regionExtent } from './scale.js'

// The 14 GB distribution regions as a plain coloured map: each filled by its household price now (Octopus Agile, p/kWh)
// on its own sequential scale (legend.jsx), thin borders. No on-map text; the name and numbers appear on hover or tap.
const hhmm = (iso) => (iso ? `${iso.slice(11, 16)} UTC` : '')
const p = (v) => (v == null ? 'n/a' : `${v.toFixed(1)}p/kWh`)

export default {
  id: 'gbRegions',
  label: 'GB regions',
  swatch: '#7aa2f7',
  order: 35,
  modes: ['overview'],
  defaultOn: false,
  build() {
    load()
    const { data, source } = getRegions()
    const rows = Object.fromEntries((data?.regions ?? []).map((r) => [r.region, r]))
    const extent = regionExtent(data)
    const tooltip = (f) => {
      const r = rows[f.properties.region]
      const name = r?.name ?? f.properties.name ?? `Region ${f.properties.region}`
      if (!r) return `<b>${name}</b>`
      return `<b>${name}</b><br/>Household price now ${p(r.agile_now_p_kwh)}<br/>Cheapest tonight ${p(r.agile_tonight_min_p_kwh)}${r.agile_tonight_min_at ? ` at ${hhmm(r.agile_tonight_min_at)}` : ''}<br/><span style="opacity:.6">Octopus Agile, retail${source === 'fixture' ? ' · sample data' : ''}</span>`
    }
    return [
      new GeoJsonLayer({
        id: 'gbregions-fill',
        data: geo,
        filled: true,
        stroked: true,
        getFillColor: (f) => regionColour(rows[f.properties.region]?.agile_now_p_kwh, extent),
        getLineColor: [255, 255, 255, 90],
        getLineWidth: 0.8,
        lineWidthUnits: 'pixels',
        pickable: true,
        tooltip,
        updateTriggers: { getFillColor: [data] },
        parameters: { depthTest: false },
      }),
    ]
  },
}
