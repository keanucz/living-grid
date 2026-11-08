import { GeoJsonLayer } from 'deck.gl'
import geo from './regions.json'
import { getRegions, load } from './data.js'
import { priceColor } from '../../styles/tokens.js'

// The 14 GB distribution regions as a plain coloured map: filled on the main price scale (one GB wholesale price, so the
// same colour as Britain on the price map) with thin borders. No on-map text; the name and numbers appear on hover or tap.
const FALLBACK_EUR = 120
const p = (v) => (v == null ? 'n/a' : `${v.toFixed(1)}p/kWh`)

export default {
  id: 'gbRegions',
  label: 'GB regions',
  swatch: '#7aa2f7',
  order: 35,
  modes: ['overview'],
  defaultOn: false,
  build({ stateByZone }) {
    load()
    const { data, source } = getRegions()
    const rows = Object.fromEntries((data?.regions ?? []).map((r) => [r.region, r]))
    const eur = stateByZone?.GB?.price_eur ?? FALLBACK_EUR
    const tooltip = (f) => {
      const r = rows[f.properties.region]
      const name = r?.name ?? f.properties.name ?? `Region ${f.properties.region}`
      if (!r) return `<b>${name}</b>`
      return `<b>${name}</b><br/>Agile now ${p(r.agile_now_p_kwh)}<br/>Tonight, cheapest ${p(r.agile_tonight_min_p_kwh)}<br/><span style="opacity:.6">Retail${source === 'fixture' ? ' · sample' : ''}; one GB wholesale price</span>`
    }
    return [
      new GeoJsonLayer({
        id: 'gbregions-fill',
        data: geo,
        filled: true,
        stroked: true,
        getFillColor: priceColor(eur, 150),
        getLineColor: [255, 255, 255, 90],
        getLineWidth: 0.8,
        lineWidthUnits: 'pixels',
        pickable: true,
        tooltip,
        updateTriggers: { getFillColor: [eur] },
        parameters: { depthTest: false },
      }),
    ]
  },
}
