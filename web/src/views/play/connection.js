import { DbConnection } from '../../spacetime/index.ts'

// Beat the model connection: its own SpacetimeDB client, sharing the saved identity token with the lobby and the old
// room game so a phone stays the same player everywhere. Subscribes only to what a round needs.
const DB = 'living-grid'
const TOKEN_KEY = 'lg-game-token'
const TABLES = ['beat_game', 'beat_call', 'beat_player', 'beat_result']
const PM_TABLES = ['pm_game', 'pm_market', 'pm_price', 'pm_account', 'pm_position', 'pm_trade']
const EXTRA = ['meta_leaderboard', 'lobby'] // optional: the final rank, and the room's state

const tokenStore = {
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

// onState({ status, me, conn }) on every change; returns { start, answer, close }. `read` turns conn into rows.
export const connectBeat = (opts) => connectTables({ ...opts, tables: TABLES })
export const connectPm = (opts) => connectTables({ ...opts, tables: PM_TABLES })

function connectTables({ onState, withToken = true, tables }) {
  let identity = null
  let conn = null
  let timer = 0
  const emit = (status = 'live') => {
    clearTimeout(timer)
    timer = setTimeout(() => conn && onState({ status, me: identity, conn }), 60)
  }
  conn = DbConnection.builder()
    .withUri(uri())
    .withDatabaseName(DB)
    .withToken(withToken ? tokenStore.get() : undefined)
    .onConnect((c, id, token) => {
      identity = id
      if (withToken) tokenStore.set(token)
      const names = [...tables, ...EXTRA.filter((n) => c.db[n])]
      for (const n of names) {
        const t = c.db[n]
        t.onInsert(() => emit())
        t.onDelete(() => emit())
        t.onUpdate?.(() => emit())
      }
      c.subscriptionBuilder()
        .onApplied(() => emit())
        .onError(() => onState({ status: 'offline' }))
        .subscribe(tables.map((t) => `SELECT * FROM ${t}`))
      const extra = names.filter((n) => !tables.includes(n))
      if (extra.length) c.subscriptionBuilder().onApplied(() => emit()).onError(() => emit()).subscribe(extra.map((t) => `SELECT * FROM ${t}`))
    })
    .onConnectError(() => onState({ status: 'offline' }))
    .onDisconnect(() => onState({ status: 'offline' }))
    .build()
  const call = (name, args) => (conn.reducers[name] ? conn.reducers[name](args) : Promise.reject(new Error('This game is not available on this server yet.')))
  return {
    start: (name, avatar) => call('beatStart', { name, avatar }),
    answer: (gameId, idx, choice, confidence) => call('beatAnswer', { gameId, idx, choice, confidence }),
    pmStart: (name, avatar) => call('pmStart', { name, avatar }),
    pmBuy: (gameId, marketId, side, shares) => call('pmBuy', { gameId, marketId, side, shares }),
    pmSell: (gameId, marketId, side, shares) => call('pmSell', { gameId, marketId, side, shares }),
    pmLeave: (gameId) => call('pmLeave', { gameId }),
    close: () => {
      clearTimeout(timer)
      conn.disconnect()
    },
  }
}
