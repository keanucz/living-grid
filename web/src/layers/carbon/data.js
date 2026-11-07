import { api } from '../../api/client.js'

// Modelled consumption-based carbon from GET /unseen/carbon, shared by the layer and its legend panel.
// The map never waits for it: zone figures also come from /state (and its fixture), and /unseen/carbon
// refines whichever zones it returns.
let state = { zones: {}, source: null, at: null, fetchedAt: 0, loading: false }

export function getCarbon() {
  return state
}

export function load() {
  if (state.loading || Date.now() - state.fetchedAt < 10 * 60_000) return
  state = { ...state, loading: true, fetchedAt: Date.now() }
  api
    .carbon()
    .then(({ data }) => {
      const zones = Object.fromEntries((data?.zones ?? []).map((z) => [z.zone, z]))
      state = { zones, source: Object.keys(zones).length ? 'live' : null, at: data?.at ?? null, fetchedAt: Date.now(), loading: false }
    })
    .catch(() => {
      state = { ...state, loading: false }
    })
}

// A zone is flagged when its own generation looks clean but what it consumes is much dirtier because of imports.
export const FLAG = { ratio: 1.2, grams: 25 }

export function intensities(stateByZone, live) {
  const out = {}
  for (const [zone, s] of Object.entries(stateByZone ?? {})) {
    if (s.carbon?.consumption_gco2_kwh != null) {
      out[zone] = { production: s.carbon.production_gco2_kwh, consumption: s.carbon.consumption_gco2_kwh, source: 'state' }
    }
  }
  for (const [zone, z] of Object.entries(live ?? {})) {
    out[zone] = { production: z.production_gco2_kwh, consumption: z.consumption_gco2_kwh, importsShare: z.imports_share, source: 'live' }
  }
  for (const v of Object.values(out)) {
    v.flagged = v.consumption >= v.production * FLAG.ratio && v.consumption - v.production >= FLAG.grams
  }
  return out
}
