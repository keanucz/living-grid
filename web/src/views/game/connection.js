import { DbConnection } from '../../spacetime/index.ts'

// Room game connection: its own SpacetimeDB client with a remembered token, so a phone keeps its player
// after a reload. Subscribes to the leaderboard view, players, zones and this player's decisions.
const DB = 'living-grid'
const TOKEN_KEY = 'lg-game-token'
export const SLOT_MS = 30 * 60e3

const store = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY) || undefined
    } catch {
      return undefined
    }
  },
  set: (t) => {
    try {
      localStorage.setItem(TOKEN_KEY, t)
    } catch {
      /* private window: a fresh identity next time */
    }
  },
}

export function uri() {
  const set = import.meta.env?.VITE_LG_STDB_URL
  if (set) return set
  return location.hostname === 'htb.stefvuck.dev' ? `wss://${location.host}` : 'wss://htb.stefvuck.dev'
}

const micros = (t) => Number(t.microsSinceUnixEpoch / 1000n)

function read(conn, me) {
  const hex = me?.toHexString()
  const players = [...conn.db.player.iter()].map((p) => ({ id: p.identity.toHexString(), name: p.name, zone: p.zone, score: p.score }))
  const decisions = [...conn.db.player_decision.iter()]
    .filter((d) => d.identity.toHexString() === hex)
    .map((d) => ({ slot: micros(d.slot), action: d.action, settled: d.settled, pnl: d.pnl, zone: d.zone }))
    .sort((a, b) => a.slot - b.slot)
  return {
    me: players.find((p) => p.id === hex) ?? null,
    zones: [...conn.db.zone.iter()].map((z) => ({ code: z.code, name: z.name, currency: z.currency })),
    leaderboard: [...conn.db.leaderboard.iter()].sort((a, b) => a.rank - b.rank),
    decisions,
  }
}

// onState({ status, me, zones, leaderboard, decisions }); returns { call, close }.
export function connectGame({ onState, uri: at = uri(), withToken = true, tables = ['player', 'player_decision', 'zone', 'leaderboard'] }) {
  let identity = null
  let timer = 0
  let conn = null
  const emit = (status) => {
    clearTimeout(timer)
    timer = setTimeout(() => conn && onState({ status, ...read(conn, identity) }), 120)
  }
  conn = DbConnection.builder()
    .withUri(at)
    .withDatabaseName(DB)
    .withToken(withToken ? store.get() : undefined)
    .onConnect((c, id, token) => {
      identity = id
      if (withToken) store.set(token)
      for (const name of tables) {
        const t = c.db[name]
        t.onInsert(() => emit('live'))
        t.onDelete(() => emit('live'))
        t.onUpdate?.(() => emit('live'))
      }
      c.subscriptionBuilder()
        .onApplied(() => emit('live'))
        .onError(() => onState({ status: 'offline' }))
        .subscribe(tables.map((t) => `SELECT * FROM ${t}`))
    })
    .onConnectError(() => onState({ status: 'offline' }))
    .onDisconnect(() => onState({ status: 'offline' }))
    .build()

  const reducer = (camel, snake) => conn.reducers[camel] ?? conn.reducers[snake]
  return {
    join: (name) => reducer('join', 'join')({ name }),
    claimZone: (zone) => reducer('claimZone', 'claim_zone')({ zone }),
    decide: (slotMs, action) => reducer('decide', 'decide')({ slotUs: BigInt(slotMs) * 1000n, action }),
    close: () => {
      clearTimeout(timer)
      conn.disconnect()
    },
  }
}

export function upcomingSlots(now = Date.now(), n = 6) {
  const first = Math.floor(now / SLOT_MS) * SLOT_MS + SLOT_MS
  return Array.from({ length: n }, (_, i) => first + i * SLOT_MS)
}
