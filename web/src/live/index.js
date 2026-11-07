import { actions, getState, setState } from '../store/store.js'
import { groupMix } from '../api/normalise.js'
import { applyOverlay, buildOverlay } from './overlay.js'
import { connect } from './connection.js'

// Live shared state from SpacetimeDB (database living-grid). Offline or unreachable: nothing changes and the
// map keeps using the API or bundled fixtures. Store keys written: live { status, version, rows, since }.
const OFFLINE = import.meta.env.VITE_LG_OFFLINE === '1'
const FRESH_INTERVENTION_MS = 15 * 60e3

let rows = null
let seenSeq = null
let started = false

function uri() {
  const set = import.meta.env.VITE_LG_STDB_URL
  if (set) return set
  return location.hostname === 'htb.stefvuck.dev' ? `wss://${location.host}` : 'wss://htb.stefvuck.dev'
}

const overlayFor = (at) => (rows ? buildOverlay(rows, at) : null)

// Used by the API client: the shown state with prices, load, mix, carbon and forecasts taken from the tables.
export function withLive(state, at, gbpEur) {
  const overlay = getState().live?.status === 'live' ? overlayFor(at) : null
  return overlay ? applyOverlay(state, overlay, { gbpEur, groupMix }) : state
}

export function liveRows() {
  return rows
}

// An intervention triggered on another device (or by the API) appears on this screen as the same scenario run.
export function showIntervention(row) {
  if (!row || row.seq === seenSeq) return
  seenSeq = row.seq
  let result = null
  try {
    result = JSON.parse(row.result_json)
  } catch {
    result = null
  }
  actions.runScenario(row.type, row.magnitude)
  if (result) actions.setLiveResult(row.type, result)
}

function onIntervention(row, applied) {
  // After the first snapshot every new or updated row is news; in the snapshot only recent ones are.
  const fresh = applied || (row.triggered_at && Date.now() - row.triggered_at / 1000 < FRESH_INTERVENTION_MS)
  if (fresh && row.type) showIntervention(row)
}

// The version bump makes the map re-read its state; at most one every few seconds however fast rows arrive.
const BUMP_MS = 5000
let lastBump = 0
let bumpTimer = 0
function bump(next) {
  const run = () => {
    lastBump = Date.now()
    bumpTimer = 0
    setState((s) => ({ live: { ...s.live, version: (s.live?.version ?? 0) + 1, counts: Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v.length])) } }))
  }
  if (bumpTimer) return
  const wait = lastBump + BUMP_MS - Date.now()
  if (wait <= 0) run()
  else bumpTimer = setTimeout(run, wait)
}

export function startLive() {
  if (started || OFFLINE || typeof WebSocket === 'undefined') return
  started = true
  setState({ live: { status: 'connecting', version: 0, since: null } })
  connect({
    uri: uri(),
    onStatus: (status) => setState((s) => ({ live: { ...s.live, status, since: status === 'live' ? Date.now() : s.live?.since ?? null } })),
    onRows: (next) => {
      rows = next
      bump(next)
    },
    onIntervention,
  })
}
