import { actions, getState, setState } from '../../store/store.js'
import { openSection } from '../sections.js'

// Three lenses, one per kind of visitor. Each view reuses a section from sections.js and narrows its panels and
// layers to what that question needs; a view with href opens a stand-alone page instead.
export const LENSES = [
  {
    id: 'analyst', icon: 'wind', door: 'See the hidden grid',
    line: 'How something you can’t see (a French outage, wind paid to switch off, carbon in imports) shows up across Europe',
    views: [
      { id: 'ripple', label: 'Ripple', section: 'overview', panels: ['zoneList', 'explain'],
        layers: { flows: true, ghost: false, ghostWind: false, carbon: false },
        title: 'How a price move spreads', blurb: 'Pick a zone: its price, why it moved, and the power flowing to its neighbours' },
      { id: 'wind', label: 'Hidden wind', section: 'unseen', panels: ['constraintBill'],
        layers: { ghostWind: true, carbon: false },
        title: 'Wind paid to switch off', blurb: 'Scottish wind turned down because the grid can’t carry it south, and what that costs' },
      { id: 'carbon', label: 'Carbon', section: 'unseen', panels: ['carbonLegend', 'zoneList'],
        layers: { ghostWind: false, carbon: true },
        title: 'Carbon hiding in imports', blurb: 'Each zone’s own carbon against what it consumes once imports count (standard emission factors)' },
    ],
    hints: [
      { view: 'ripple', text: 'Tap France on the map to see its price and the reasons behind it.' },
      { view: 'wind', text: 'The glow over Scotland is wind paid to switch off. The card shows the bill.' },
      { view: 'carbon', text: 'Find a zone that looks clean but imports dirty power.' },
    ],
  },
  {
    id: 'trader', icon: 'chart', door: 'Make a call on the market',
    line: 'Turn a view on the world into price changes, run a battery on the forecast, and check whether to trust it',
    views: [
      { id: 'scenario', label: 'Scenario', section: 'simulate' },
      { id: 'battery', label: 'Battery', section: 'forecast', panels: ['battery', 'zoneChart'],
        title: 'A battery on our forecast', blurb: 'Risk-aware against median-only, a naive rule and perfect foresight, on scored hours only' },
      { id: 'compute', label: 'Compute', section: 'scores', panels: ['compute'],
        title: 'When and where to run a job', blurb: 'The cheapest start time and zone for a compute job, with the saving and its range' },
      { id: 'proof', label: 'Proof', section: 'scores', panels: ['scoreboard', 'botLeague', 'leaderboard'] },
    ],
    hints: [
      { view: 'scenario', text: 'Close the Strait of Hormuz and read the price change in pounds.' },
      { view: 'battery', text: 'Compare the risk-aware battery with the median-only one.' },
      { view: 'proof', text: 'See how we scored: every forecast was logged before its outcome.' },
    ],
  },
  {
    id: 'household', icon: 'phone', door: 'Save on my bill',
    line: 'When to charge the car or run the dishwasher tonight, and how much you’d save',
    views: [
      { id: 'tonight', label: 'Tonight', href: '#/household' },
      { id: 'region', label: 'My region', section: 'overview', panels: ['zoneList', 'carbonLegend'],
        layers: { carbon: true, gbRegions: true, ghost: false, ghostWind: false }, zone: 'GB',
        title: 'How clean is my power?', blurb: 'GB carbon intensity once imports count; regional detail is modelled by the Carbon Intensity API' },
    ],
    hints: [
      { view: 'tonight', text: 'Pick your region to see tonight’s cheapest hours and the saving.' },
      { view: 'region', text: 'My region shows how clean the power is right now.' },
    ],
  },
]

export const lensById = Object.fromEntries(LENSES.map((l) => [l.id, l]))

export function viewOf(ui) {
  const lens = lensById[ui.lens]
  return lens?.views.find((v) => v.id === ui.lensView) ?? null
}

// The lens view that governs the map right now: only while the map is still on that view's section.
export function activeMapView(ui) {
  const v = viewOf(ui)
  return v && !v.href && v.section === ui.section ? v : null
}

export function openLensView(lensId, viewId) {
  const lens = lensById[lensId]
  const v = lens?.views.find((x) => x.id === viewId) ?? lens?.views[0]
  if (!v) return
  store('lg-lens', lensId)
  if (v.href) {
    if (getState().lens !== lensId) actions.setMode('overview')
    setState({ lens: lensId, lensView: v.id })
    location.hash = v.href
    return
  }
  const wasSim = getState().mode === 'simulate' && getState().lens === lensId
  openSection(v.section)
  setState((s) => ({ lens: lensId, lensView: v.id, layers: { ...s.layers, ...(v.layers ?? {}) } }))
  if (v.zone) actions.selectZone(v.zone)
  // Simulate stays on within a lens: the view keeps its panels and the event dock joins them.
  if (wasSim && v.section !== 'simulate') actions.setMode('simulate')
}

export function leaveLens() {
  store('lg-lens', '')
  setState({ lens: null, lensView: null })
}

export function load(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function store(key, value) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* private mode */
  }
}

// First visit to the map asks the welcome question; a returning visitor gets their lens back. Stand-alone pages
// (the QR code opens #/household) never show the welcome.
export function initLens(onMap) {
  const saved = lensById[load('lg-lens')] ? load('lg-lens') : null
  setState({ welcome: onMap && !load('lg-welcomed') })
  if (saved && onMap) openLensView(saved)
  else if (saved) setState({ lens: saved })
}
