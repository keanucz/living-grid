// Battery mode inside a lobby. The lobby view owns the connection; this reads the tables a battery round needs
// from it and sends decisions, so there is one SpacetimeDB connection per phone.

export const BATTERY_TABLES = ['battery_round', 'battery_player', 'battery_decision', 'battery_slot', 'battery_my_pending']

const hexOf = (id) => id?.toHexString?.() ?? String(id)

// Snapshot of one lobby's battery round from a connected `conn` (generated bindings) for the identity `me`.
export function readBattery(conn, lobbyId, me) {
  const rows = (t) => (conn.db[t] ? [...conn.db[t].iter()] : [])
  const mine = hexOf(me)
  const round = rows('battery_round').find((r) => r.lobby_id === lobbyId) ?? null
  const players = rows('battery_player')
    .filter((p) => p.lobby_id === lobbyId)
    .map((p) => ({ identity: hexOf(p.identity), name: p.name, soc: p.soc_mwh, pnl: p.pnl, isAgent: p.is_agent, kind: p.kind }))
  const slots = rows('battery_slot')
    .filter((s) => s.lobby_id === lobbyId)
    .sort((a, b) => a.slot - b.slot)
    .map((s) => ({ slot: s.slot, price: s.price }))
  const decisions = rows('battery_decision').filter((d) => d.lobby_id === lobbyId)
  const pending = Object.fromEntries(rows('battery_my_pending').filter((p) => p.lobby_id === lobbyId).map((p) => [p.slot, p.action]))
  const settled = Object.fromEntries(decisions.filter((d) => hexOf(d.identity) === mine).map((d) => [d.slot, d]))
  return { round, players, slots, mine, pending, settled, decisions }
}

export function decide(conn, slot, action) {
  return conn.reducers.batteryDecide({ slot, action })
}

// Local time of the day for a half-hour index of the round (start_slot is the half-hour of the day it starts at).
export function slotTime(round, slot) {
  const half = round.start_slot + slot
  return `${String(Math.floor(half / 2)).padStart(2, '0')}:${half % 2 ? '30' : '00'}`
}

export const money = (v) => `${v < 0 ? '−' : ''}£${Math.abs(v).toFixed(2)}`
