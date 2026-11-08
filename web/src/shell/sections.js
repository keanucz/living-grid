import { actions, setState, getState } from '../store/store.js'

// Budget per section: the map, one primary panel, one KPI strip. Anything else goes in `more`, which the 'more' panel
// shows behind one button; a section with a `more` list must also list 'more' in `panels`.
// The six sections of the app. The same ids, labels and order drive the desktop tabs, the phone tabs and the
// welcome doors, so there is one navigation. A section is either a map state (mode, time, layer preset and the
// panels it shows, by panel id) or a stand-alone page (href). `pages` are stand-alone pages that belong to the
// section; they keep its tab lit and are linked from its headline.
export const SECTIONS = [
  { id: 'now', label: 'Now', question: "Is power cheap right now?", icon: 'globe', mode: 'overview', at: 'now',
    title: 'Is power cheap right now?', blurb: 'Day-ahead prices and the electricity flowing between countries, right now',
    door: 'Europe’s grid right now: prices, and the power flowing between countries',
    panels: ['zoneList', 'kpis'], layers: { flows: true, ghost: false, ghostWind: false, carbon: false } },
  { id: 'forecast', label: 'Forecast', question: "Where are prices going?", icon: 'chart', mode: 'overview', at: '+6',
    title: 'Where are prices going?', blurb: 'Our forecast for every zone, with honest uncertainty bands and the reasons behind it',
    door: 'Where prices are heading, with honest bands, and the cheapest hours tonight',
    panels: ['zoneChart', 'explain', 'scrubber'], layers: { flows: true, ghost: true, ghostWind: false, carbon: false },
    pages: [{ label: 'Tonight: cheapest hours', href: '#/household', paths: ['/household'] }] },
  { id: 'hidden', label: 'Hidden grid', question: "What’s normally hidden?", icon: 'wind', mode: 'overview', at: 'now',
    title: 'What normally stays hidden', blurb: 'Four things that normally stay hidden: wind paid to switch off, carbon carried in by cable, the grid’s bottlenecks and sunny-day negative prices',
    door: 'What normally stays hidden: wind paid to switch off, carbon in imports, where the grid is full',
    panels: ['stories'], layers: { flows: true, ghost: false, ghostWind: true, carbon: false, boundaries: true, wind: false, solar: false },
    pages: [{ label: 'Where the grid is full', href: '#/infrastructure', paths: ['/infrastructure'] }] },
  { id: 'whatif', label: 'What if', question: "What if something breaks?", icon: 'sim', mode: 'simulate', at: 'now',
    title: 'What if the world changes?', blurb: 'Close the Strait of Hormuz or trip a cable, and see prices, the bill in pounds and a battery’s response',
    door: 'Close the Strait of Hormuz, trip a cable, and see the cost across Europe',
    panels: ['simDock', 'statTiles', 'more'], more: ['battery', 'compute'], layers: { flows: true, ghost: false, ghostWind: false, carbon: false } },
  { id: 'proof', label: 'Proof', question: "Can we trust the forecast?", icon: 'replay', mode: 'overview', at: 'now',
    title: 'How right are we?', blurb: 'Every forecast logged before its outcome, scored against simple baselines',
    door: 'How right are we: scores against baselines, the 26 October replay, the Monday reveal',
    panels: ['scoreboard', 'more'], more: ['botLeague', 'leaderboard'], layers: { flows: true, ghost: false, ghostWind: false, carbon: false },
    pages: [
      { label: 'Replay: 26 October storm', href: '#/replay', paths: ['/replay'] },
      { label: 'Day-ahead reveal', href: '#/reveal', paths: ['/reveal'] },
    ] },
  { id: 'play', label: 'Play', question: "Can you beat it?", icon: 'play', href: '#/play', paths: ['/play'],
    door: 'Beat the model: call the grid on a real, hidden day, against our forecasters' },
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
