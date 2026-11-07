// Battery mode inside a lobby. The lobby view owns the connection; this reads the tables a battery round needs
// from it and sends decisions, so there is one SpacetimeDB connection per phone.

export const BATTERY_TABLES = ['battery_round', 'battery_player', 'battery_decision', 'battery_slot', 'battery_my_pending']

const hexOf = (id) => id?.toHexString?.() ?? String(id)

// Snapshot of one lobby's battery round from a connected `conn` (generated bindings) for the identity `me`.
export function readBattery(conn, lobbyId, me) {
  // The generated row types use camelCase fields; the round and players are handed to BatteryRound with the key names it reads.
  const rows = (t) => (conn.db[t] ? [...conn.db[t].iter()] : [])
  const mine = hexOf(me)
  const r = rows('battery_round').find((x) => x.lobbyId === lobbyId)
  const round = r && {
    lobby_id: r.lobbyId, status: r.status, slot: r.slot, n_slots: r.nSlots, start_slot: r.startSlot,
    seconds_per_slot: r.secondsPerSlot, day_revealed: r.dayRevealed,
  }
  const players = rows('battery_player')
    .filter((p) => p.lobbyId === lobbyId)
    .map((p) => ({ identity: hexOf(p.identity), name: p.name, soc: p.socMwh, pnl: p.pnl, isAgent: p.isAgent, kind: p.kind }))
  const slots = rows('battery_slot')
    .filter((x) => x.lobbyId === lobbyId)
    .sort((a, b) => a.slot - b.slot)
    .map((x) => ({ slot: x.slot, price: x.price }))
  const decisions = rows('battery_decision').filter((d) => d.lobbyId === lobbyId)
  const pending = Object.fromEntries(rows('battery_my_pending').filter((x) => x.lobbyId === lobbyId && hexOf(x.identity) === mine).map((x) => [x.slot, x.action]))
  const settled = Object.fromEntries(decisions.filter((d) => hexOf(d.identity) === mine).map((d) => [d.slot, { slot: d.slot, action: d.action, price: d.price, pnl: d.pnl, soc: d.socMwh }]))
  return { round: round ?? null, players, slots, mine, pending, settled, decisions }
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
