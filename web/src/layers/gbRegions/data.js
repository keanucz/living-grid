import fixture from './regions.fixture.json'

// GET /regions: 14 GB regions with modelled carbon intensity, tonight's Agile price and Scottish ghost wind.
// The map never waits for it: the bundled snapshot (retail prices only, no carbon) shows until the API answers.
let state = { data: fixture, source: 'fixture', fetchedAt: 0, loading: false }

export function getRegions() {
  return state
}

export function load() {
  if (state.loading || Date.now() - state.fetchedAt < 10 * 60_000) return
  state = { ...state, loading: true, fetchedAt: Date.now() }
  fetch('/api/regions')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data) => {
      state = { data, source: 'live', fetchedAt: Date.now(), loading: false }
    })
    .catch(() => {
      state = { ...state, loading: false }
    })
}

export function openHousehold(region) {
  try {
    localStorage.setItem('lg-region', region)
  } catch {
    /* storage can be blocked; the household view then opens on its default region */
  }
  location.hash = '#/household'
}
