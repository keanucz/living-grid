import { useEffect, useState } from 'react'
import zonesFixture from '../fixtures/zones.json'
import stateFixture from '../fixtures/state.json'
import scenariosFixture from '../fixtures/scenarios.json'
import assetsFixture from '../fixtures/assets.json'
import { normaliseScenarios, normaliseState, normaliseZones } from './normalise.js'

// Every GET in the CLAUDE.md HTTP contract, served by FastAPI behind the /api proxy (Vite in dev,
// Caddy on htb.stefvuck.dev). Live responses are normalised to the UI's shapes; if the API is
// unreachable, slow, or returns something we cannot read, we fall back to bundled fixtures
// (already in UI shape) so the page always renders.
const OFFLINE = import.meta.env.VITE_LG_OFFLINE === '1'
const TIMEOUT_MS = { '/state': 9000, default: 8000 }

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
  scores: () => raw('/scores'),
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
