import { DbConnection } from '../../spacetime/index.ts'

// Mystery-day market connection. Shares the room game's token key, so a phone that joined the game is the same
// player here. Subscribes to the public market tables; outcomes live in private tables the client cannot read.
const DB = 'living-grid'
const TOKEN_KEY = 'lg-game-token'
const TABLES = ['player', 'market_round', 'market_question', 'market_account', 'market_position', 'market_feed', 'market_leaderboard']

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

// LMSR cost of moving the book from (y, n) to (y2, n2); same formula as the module (b is the liquidity).
const lse = (y, n, b) => {
  const m = Math.max(y, n)
  return m + b * Math.log(Math.exp((y - m) / b) + Math.exp((n - m) / b))
}
export function tradeCost(q, side, shares, b) {
  const y = q.qYes + (side === 'yes' ? shares : 0)
  const n = q.qNo + (side === 'no' ? shares : 0)
  return lse(y, n, b) - lse(q.qYes, q.qNo, b)
}

function read(conn, me) {
  const hex = me?.toHexString()
  const rows = (t) => [...conn.db[t].iter()]
  const positions = {}
  for (const p of rows('market_position')) if (p.identity.toHexString() === hex) positions[p.questionId] = p
  const account = rows('market_account').find((a) => a.identity.toHexString() === hex) ?? null
  const player = rows('player').find((p) => p.identity.toHexString() === hex) ?? null
  return {
    player,
    account,
    round: rows('market_round')[0] ?? null,
    questions: rows('market_question').sort((a, b) => a.targetHour - b.targetHour || a.id.localeCompare(b.id)),
    positions,
    feed: rows('market_feed').sort((a, b) => a.hour - b.hour),
    leaderboard: rows('market_leaderboard').sort((a, b) => a.rank - b.rank),
  }
}

// onState({ status, ...snapshot }); returns { join, buy, sell, close }.
export function connectMarket({ onState, withToken = true }) {
  let identity = null
  let timer = 0
  let conn = null
  const emit = (status = 'live') => {
    clearTimeout(timer)
    timer = setTimeout(() => conn && onState({ status, ...read(conn, identity) }), 100)
  }
  conn = DbConnection.builder()
    .withUri(uri())
    .withDatabaseName(DB)
    .withToken(withToken ? tokenStore.get() : undefined)
    .onConnect((c, id, token) => {
      identity = id
      if (withToken) tokenStore.set(token)
      for (const name of TABLES) {
        const t = c.db[name]
        t.onInsert(() => emit())
        t.onDelete(() => emit())
        t.onUpdate?.(() => emit())
      }
      c.subscriptionBuilder()
        .onApplied(() => emit())
        .onError(() => onState({ status: 'offline' }))
        .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`))
    })
    .onConnectError(() => onState({ status: 'offline' }))
    .onDisconnect(() => onState({ status: 'offline' }))
    .build()

  return {
    join: (name) => conn.reducers.join({ name }),
    buy: (questionId, side, shares) => conn.reducers.marketBuy({ questionId, side, shares }),
    sell: (questionId, side, shares) => conn.reducers.marketSell({ questionId, side, shares }),
    close: () => {
      clearTimeout(timer)
      conn.disconnect()
    },
  }
}
