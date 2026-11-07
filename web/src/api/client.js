import { useEffect, useState } from 'react'
import zones from '../fixtures/zones.json'
import state from '../fixtures/state.json'
import scenarios from '../fixtures/scenarios.json'
import assets from '../fixtures/assets.json'

// Every GET in the CLAUDE.md HTTP contract, served by FastAPI behind the Vite /api proxy.
// When the API is unreachable (or VITE_LG_OFFLINE=1) we fall back to bundled fixtures.
const FIXTURES = {
  '/zones': zones,
  '/state': state,
  '/scenarios': scenarios,
  '/assets': assets,
}

const OFFLINE = import.meta.env.VITE_LG_OFFLINE === '1'
const TIMEOUT_MS = 1500

export async function get(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString()
  if (!OFFLINE) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, { signal: ctrl.signal })
      if (res.ok) return { data: await res.json(), source: 'live' }
    } catch {
      // network down or API not running: fall through to the fixture
    } finally {
      clearTimeout(timer)
    }
  }
  if (path in FIXTURES) return { data: FIXTURES[path], source: 'fixture' }
  throw new Error(`no API and no fixture for ${path}`)
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
  zones: () => get('/zones'),
  state: (at) => get('/state', { at }),
  explain: (zone, ts) => get('/explain', { zone, ts }),
  ghostWind: (from, to) => get('/unseen/ghost-wind', { from, to }),
  carbon: (at) => get('/unseen/carbon', { at }),
  scenarios: () => get('/scenarios'),
  scores: () => get('/scores'),
  household: (region) => get('/household', { region }),
  replay: (event) => get('/replay', { event }),
  reveal: () => get('/reveal'),
  assets: () => get('/assets'),
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
