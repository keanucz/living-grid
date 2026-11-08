import { actions, setState, getState } from '../store/store.js'

// The main screen as five focused views. Each lists the panels it shows (by panel id, in any slot) and the
// layers it forces on or off; everything else on the map keeps the viewer's own toggles.
// Budget per section: the map, one primary panel, one KPI strip. Anything else goes in `more`, which the
// 'more' panel shows behind one button; a section with a `more` list must also list 'more' in `panels`.
export const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'globe', mode: 'overview', at: 'now',
    title: 'Europe’s power grid', blurb: 'Day-ahead prices and the electricity flowing between countries, right now',
    panels: ['zoneList', 'kpis'], layers: { ghost: false, ghostWind: false, carbon: false } },
  { id: 'forecast', label: 'Forecast', icon: 'chart', mode: 'overview', at: '+6',
    title: 'Where prices are heading', blurb: 'Our forecast for every zone, with honest uncertainty bands and the reasons behind it',
    panels: ['zoneChart', 'explain', 'scrubber'], layers: { ghost: true, ghostWind: false, carbon: false } },
  { id: 'unseen', label: 'Unseen', icon: 'wind', mode: 'overview', at: 'now',
    title: 'What normally stays hidden', blurb: 'Wind paid to switch off over Scotland, and carbon carried in through the interconnectors',
    panels: ['constraintBill', 'more'], more: ['carbonLegend', 'renewables'], layers: { ghost: false, ghostWind: true, carbon: true } },
  { id: 'simulate', label: 'Simulate', icon: 'sim', mode: 'simulate', at: 'now',
    panels: ['simDock', 'statTiles', 'more'], more: ['battery'], layers: {} },
  { id: 'scores', label: 'Scores', icon: 'battery', mode: 'overview', at: 'now',
    title: 'How right are we?', blurb: 'Every forecast logged before its outcome, scored against simple baselines',
    panels: ['scoreboard', 'more'], more: ['botLeague', 'compute', 'leaderboard'], layers: { ghost: false, ghostWind: false, carbon: false } },
]

export const sectionById = Object.fromEntries(SECTIONS.map((s) => [s.id, s]))

const hourIso = (offsetH) => {
  const d = new Date(Date.now() + offsetH * 3600e3)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString().replace('.000Z', 'Z')
}

export function openSection(id) {
  const s = sectionById[id]
  if (!s) return
  if (location.hash && location.hash !== '#/') location.hash = '#/'
  setState({ section: id, layers: { ...getState().layers, ...s.layers } })
  actions.setMode(s.mode)
  actions.setAt(s.at === 'now' ? null : hourIso(Number(s.at)))
}
