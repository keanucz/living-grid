import { useEffect, useState } from 'react'
import zonesFixture from '../fixtures/zones.json'
import stateFixture from '../fixtures/state.json'
import scenariosFixture from '../fixtures/scenarios.json'
import assetsFixture from '../fixtures/assets.json'
import { normaliseScenarios, normaliseState, normaliseZones } from './normalise.js'
import { withLive } from '../live/index.js'

// Every GET in the CLAUDE.md HTTP contract, served by FastAPI behind the /api proxy (Vite in dev,
// Caddy on htb.stefvuck.dev). Live responses are normalised to the UI's shapes; if the API is
// unreachable, slow, or returns something we cannot read, we fall back to bundled fixtures
// (already in UI shape) so the page always renders.
const OFFLINE = import.meta.env.VITE_LG_OFFLINE === '1'
const TIMEOUT_MS = { '/state': 9000, '/scores': 30000, default: 8000 }

async function fetchLive(path, params = {}) {
  if (OFFLINE) return null
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS[path] ?? TIMEOUT_MS.default)
  try {
    const res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, { signal: ctrl.signal })
    return res.ok ? await res.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function liveOr(fixture, path, load) {
  try {
    const data = await load()
    if (data) return { data, source: 'live' }
  } catch (err) {
    console.warn(`[api] could not read live ${path}, using fixture`, err)
  }
  return { data: fixture, source: 'fixture' }
}

const currentHour = () => {
  const d = new Date()
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString().replace('.000Z', 'Z')
}

let zonesPromise = null
function zones() {
  zonesPromise ??= liveOr(zonesFixture, '/zones', async () => {
    const raw = await fetchLive('/zones')
    const z = raw && normaliseZones(raw)
    return z?.zones.length ? z : null
  })
  return zonesPromise
}

async function state(at) {
  const res = await stateFromApi(at)
  // Prices, load, mix, carbon and forecasts come from SpacetimeDB when it is connected, else as the API gave them.
  return { ...res, data: withLive(res.data, at ?? currentHour(), GBP_EUR) }
}

// Re-apply the live overlay to an already-fetched state (no network), for SpacetimeDB updates.
export function overlayState(res, at) {
  if (!res?.data) return res
  const data = withLive(res.data, at ?? currentHour(), GBP_EUR)
  if (data === res.data) return res
  const live = data.source === 'live'
  return { ...res, data: live ? { ...data, at: at ?? currentHour() } : data, source: live ? 'live' : res.source }
}

export { currentHour }

async function stateFromApi(at) {
  return liveOr(stateFixture, '/state', async () => {
    const [raw, z] = await Promise.all([fetchLive('/state', { at: at ?? currentHour() }), zones()])
    if (!raw) return null
    const s = normaliseState(raw, z.data)
    return s.zones.length ? s : null
  })
}

async function scenarios() {
  return liveOr(scenariosFixture, '/scenarios', async () => {
    const raw = await fetchLive('/scenarios')
    const s = raw && normaliseScenarios(raw)
    return s && Object.keys(s).length ? s : null
  })
}

async function raw(path, params) {
  const data = await fetchLive(path, params)
  if (data == null) throw new Error(`no API response for ${path}`)
  return { data, source: 'live' }
}

// Keep the newest good response per path (in memory and in this browser) so a slow or failed refresh shows
// the last real numbers, labelled 'cached', instead of a bundled sample.
function lastGood(path) {
  const key = `lg-last-good:${path}`
  let memory = null
  return async (params) => {
    try {
      const res = await raw(path, params)
      memory = res.data
      try {
        localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: res.data }))
      } catch {
        /* storage full or blocked: memory still holds it */
      }
      return res
    } catch (err) {
      if (memory) return { data: memory, source: 'cached' }
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (saved?.data) return { data: saved.data, source: 'cached' }
      } catch {
        /* unreadable: fall through */
      }
      throw err
    }
  }
}

export async function post(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return res.json()
}

export const api = {
  zones,
  state,
  scenarios,
  explain: (zone, ts) => raw('/explain', { zone, ts }),
  ghostWind: (from, to) => raw('/unseen/ghost-wind', { from, to }),
  carbon: (at) => raw('/unseen/carbon', { at }),
  scores: lastGood('/scores'),
  household: (region) => raw('/household', { region }),
  replay: (event) => raw('/replay', { event }),
  reveal: () => raw('/reveal'),
  // Not in the engine contract: approximate plant locations for the simulation view, bundled only.
  assets: async () => ({ data: assetsFixture, source: 'fixture' }),
  intervene: (body) => post('/intervene', body),
}

export function useApi(fn, deps = []) {
  const [res, setRes] = useState({ data: null, source: null, error: null })
  useEffect(() => {
    let live = true
    fn()
      .then((r) => live && setRes({ ...r, error: null }))
      .catch((error) => live && setRes({ data: null, source: null, error }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return res
}

export const GBP_EUR = 1.15
