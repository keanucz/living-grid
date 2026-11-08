import { useSyncExternalStore } from 'react'

const initial = {
  mode: 'overview', // 'overview' | 'simulate'
  section: 'now', // see shell/sections.js
  at: null, // ISO hour shown on the map; null = latest
  selectedZone: 'GB',
  layers: {}, // id -> boolean, filled from the layer registry defaults
  scenario: null, // { id, magnitude } once a world event has been run
  scenarioArmed: 'hormuz',
  forcePanels: [], // panel ids the debug page forces visible, even when no section lists them
}

let state = initial
const listeners = new Set()

export function getState() {
  return state
}

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export const actions = {
  setMode: (mode) => setState({ mode }),
  selectZone: (selectedZone) => setState({ selectedZone }),
  toggleLayer: (id) => setState((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
  armScenario: (scenarioArmed) => setState({ scenarioArmed }),
  runScenario: (id, magnitude) => setState({ scenario: { id, magnitude, ranAt: Date.now() } }),
  clearScenario: () => setState({ scenario: null, liveResult: null }),
  setLiveResult: (id, result) => setState({ liveResult: result ? { id, result } : null }),
  setAt: (at) => setState({ at }),
}
