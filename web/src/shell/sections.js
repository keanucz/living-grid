import { actions, setState, getState } from '../store/store.js'

// Every section sets each layer the Hidden grid stories switch (ghostWind, carbon, boundaries, wind, solar), so none
// leaks into the next section (#312).
// Budget per section: the map, one primary panel, one KPI strip. Anything else goes in `more`, which the 'more' panel
// shows behind one button; a section with a `more` list must also list 'more' in `panels`.
// The six sections of the app. The same ids, labels and order drive the desktop tabs, the phone tabs and the
// welcome doors, so there is one navigation. A section is either a map state (mode, time, layer preset and the
// panels it shows, by panel id) or a stand-alone page (href). `pages` are stand-alone pages that belong to the
// section; they keep its tab lit and are linked from its headline.
export const SECTIONS = [
  { id: 'now', label: 'Now', question: "Is power cheap right now?", icon: 'globe', mode: 'overview', at: 'now',
    title: 'Current conditions', blurb: 'What power costs now in each country, and the electricity flowing between them',
    door: 'Current conditions: what power costs now, and the electricity moving between countries',
    panels: ['zoneList', 'kpis'], layers: { flows: true, ghost: false, ghostWind: false, carbon: false, boundaries: false, wind: false, solar: false } },
  { id: 'forecast', label: 'Forecast', question: "Where are prices going?", icon: 'chart', mode: 'overview', at: '+6',
    title: 'The outlook', blurb: 'Our forecast for every zone, with the odds in plain words and the reasons behind it',
    door: 'The outlook: where prices are heading, how sure we are, and the cheapest hours tonight',
    panels: ['zoneChart', 'explain', 'scrubber'], layers: { flows: true, ghost: true, ghostWind: false, carbon: false, boundaries: false, wind: false, solar: false },
    pages: [{ label: 'Plan around it: cheapest hours tonight', href: '#/household', paths: ['/household'] }] },
  { id: 'hidden', label: 'Hidden grid', question: "What’s normally hidden?", icon: 'wind', mode: 'overview', at: 'now',
    title: 'The radar: what you cannot see', blurb: 'Four things that normally stay hidden: wind paid to switch off, carbon carried in by cable, the grid’s bottlenecks and sunny-day negative prices',
    door: 'The radar: wind paid to switch off, carbon in imports, where the grid is full',
    panels: ['stories'], layers: { flows: true, ghost: false, ghostWind: true, carbon: false, boundaries: true, wind: false, solar: false },
    pages: [{ label: 'Where the grid is full', href: '#/infrastructure', paths: ['/infrastructure'] }] },
  { id: 'whatif', label: 'What if', question: "What if something breaks?", icon: 'sim', mode: 'simulate', at: 'now',
    title: 'Warnings: what if the world changes?', blurb: 'Close the Strait of Hormuz or trip a cable, and see prices, the bill in pounds and a battery’s response',
    door: 'Warnings: close the Strait of Hormuz, trip a cable, and see the cost across Europe',
    panels: ['simDock', 'statTiles', 'more'], more: ['battery', 'compute'], layers: { flows: true, ghost: false, ghostWind: false, carbon: false, boundaries: false, wind: false, solar: false } },
  { id: 'proof', label: 'Proof', question: "Can we trust the forecast?", icon: 'replay', mode: 'overview', at: 'now',
    title: 'Was the forecast right?', blurb: 'Scored daily against simple baselines, and sealed on Solana before the result',
    door: 'Was the forecast right? Daily scores, the 26 October storm replay, the Monday reveal',
    panels: ['scoreboard'], layers: { flows: true, ghost: false, ghostWind: false, carbon: false, boundaries: false, wind: false, solar: false },
    pages: [
      { label: 'Replay: 26 October storm', href: '#/replay', paths: ['/replay'] },
      { label: 'Day-ahead reveal', href: '#/reveal', paths: ['/reveal'] },
    ] },
  { id: 'play', label: 'Play', question: "Can you beat it?", icon: 'play', href: '#/play', paths: ['/play'],
    door: 'Beat the forecaster: call the grid on a real, hidden day, against our models' },
]

export const sectionById = Object.fromEntries(SECTIONS.map((s) => [s.id, s]))

// Which section owns a stand-alone page (a hash path such as '/household'); null when none does.
export function sectionOfPath(path) {
  const p = (path || '').replace(/^#/, '').split('?')[0]
  for (const s of SECTIONS) {
    const own = [...(s.paths ?? []), ...(s.pages ?? []).flatMap((x) => x.paths)]
    if (own.some((q) => p === q || p.startsWith(`${q}/`))) return s.id
  }
  return null
}

const hourIso = (offsetH) => {
  const d = new Date(Date.now() + offsetH * 3600e3)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString().replace('.000Z', 'Z')
}

export function openSection(id) {
  const s = sectionById[id]
  if (!s) return
  if (s.href) {
    location.hash = s.href
    return
  }
  if (location.hash && location.hash !== '#/') location.hash = '#/'
  setState({ section: id, layers: { ...getState().layers, ...s.layers } })
  actions.setMode(s.mode)
  actions.setAt(s.at === 'now' ? null : hourIso(Number(s.at)))
}
