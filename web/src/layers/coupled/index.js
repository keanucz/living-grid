import { GeoJsonLayer, TextLayer } from 'deck.gl'
import { priceColor } from '../../styles/tokens.js'
import { setState } from '../../store/store.js'

// "Coupled market": today's day-ahead price in the bidding zones around the six main ones (GET /coupled, Nord Pool),
// on the same colour scale at lower opacity. Prices only, never a forecast; the shapes are rough boxes cut from the
// country outlines (scripts/make_coupled_geo.py). Off by default; nothing here runs until it is turned on.
const fixtures = import.meta.glob('../../fixtures/coupled.json', { import: 'default' })
const NARROW = typeof innerWidth !== 'undefined' && innerWidth < 700
const Z = 1200

let state = { geo: null, body: null, loading: false, fetchedAt: 0 }

const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
const fixture = () => (Object.values(fixtures)[0]?.() ?? Promise.reject(new Error('no fixture')))

function load() {
  if (state.loading || Date.now() - state.fetchedAt < 10 * 60_000) return
  state = { ...state, loading: true, fetchedAt: Date.now() }
  Promise.all([
    state.geo ? state.geo : getJson('/geo/coupled.json').catch(() => null),
    getJson('/api/coupled').then((b) => (Array.isArray(b?.zones) ? b : Promise.reject(new Error('shape')))).catch(fixture).catch(() => null),
  ]).then(([geo, body]) => {
    state = { ...state, geo, body: body ?? state.body, loading: false }
    // The map only rebuilds on a store change or a clock tick (none with ?still): nudge it once the data is in.
    setState({ coupledLoadedAt: Date.now() })
  })
}

const eur = (v) => `€${Math.round(v)}`

function tooltip(z) {
  const now = z.price != null ? `${eur(z.price)}/MWh this hour` : 'No price for this hour'
  const day = z.day_min != null ? `<br/>Today ${eur(z.day_min)} to ${eur(z.day_max)}, average ${eur(z.day_avg)}` : ''
  return `<b>${z.name}</b><br/><span style="font-size:16px;font-weight:600">${now}</span>${day}<br/><span style="opacity:.6">Price only, not forecast. Zone border approximate. Source: Nord Pool.</span>`
}

export default {
  id: 'coupled',
  label: 'Coupled market (prices only)',
  swatch: '#8a8a86',
  order: 12,
  modes: ['overview'],
  defaultOn: false,
  build() {
    load()
    const { geo, body } = state
    if (!geo || !body) return []
    const by = Object.fromEntries(body.zones.map((z) => [z.zone, z]))
    const feats = geo.features.filter((f) => by[f.properties.zone])
    const shown = (z) => z.price ?? z.day_avg
    return [
      new GeoJsonLayer({
        id: 'coupled-zones',
        data: feats,
        filled: true,
        stroked: true,
        getFillColor: (f) => (shown(by[f.properties.zone]) != null ? priceColor(shown(by[f.properties.zone]), 110) : [60, 60, 58, 60]),
        getLineColor: [255, 255, 255, 40],
        lineWidthMinPixels: 1,
        pickable: true,
        tooltip: (f) => tooltip(by[f.properties.zone]),
        updateTriggers: { getFillColor: [body] },
      }),
      new TextLayer({
        id: 'coupled-labels',
        data: feats.filter((f) => shown(by[f.properties.zone]) != null),
        getPosition: (f) => [...f.properties.label_at, Z],
        getText: (f) => {
          const z = by[f.properties.zone]
          return NARROW ? `${f.properties.zone} ${eur(shown(z))}` : `${z.name} ${eur(shown(z))}`
        },
        getSize: NARROW ? 9 : 11,
        sizeUnits: 'pixels',
        getColor: [244, 244, 240, 220],
        background: true,
        getBackgroundColor: [20, 20, 19, 170],
        backgroundPadding: [5, 2],
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 500,
        characterSet: 'auto',
        parameters: { depthTest: false },
        updateTriggers: { getText: [body] },
      }),
    ]
  },
}
