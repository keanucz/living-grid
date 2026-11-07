import { DbConnection } from '../../spacetime/index.ts'
import { BATTERY_TABLES, readBattery } from '../game/battery.js'

// Mystery-day market connection. Shares the room game's token key, so a phone that joined the game is the same
// player here. Subscribes to the public market tables; outcomes live in private tables the client cannot read.
const DB = 'living-grid'
const TOKEN_KEY = 'lg-game-token'
const TABLES = ['player', 'market_round', 'market_question', 'market_account', 'market_position', 'market_feed', 'market_leaderboard', 'market_bot', 'market_bot_p']
// Lobby tables exist once the lobby module (#165) is published and the bindings regenerated; skipped before that.
const LOBBY_TABLES = ['lobby', 'lobby_player', 'reaction', ...BATTERY_TABLES]

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

const ms = (t) => (t == null ? null : typeof t === 'number' ? t : Number(t.microsSinceUnixEpoch / 1000n))

function read(conn, me, lobbyId = null) {
  const hex = me?.toHexString()
  // With a lobby id, only that room's rows; without, everything (the original single-room /market view).
  const rows = (t) => (conn.db[t] ? [...conn.db[t].iter()] : []).filter((r) => lobbyId == null || r.lobbyId == null || r.lobbyId === lobbyId)
  const positions = {}
  for (const p of rows('market_position')) if (p.identity.toHexString() === hex) positions[p.questionId] = p
  const account = rows('market_account').find((a) => a.identity.toHexString() === hex) ?? null
  const player = rows('player').find((p) => p.identity.toHexString() === hex) ?? null
  const accounts = new Map(rows('market_account').map((a) => [a.identity.toHexString(), a.points]))
  const bots = rows('market_bot')
    .map((b) => ({ name: b.name, title: b.title, method: b.method, kelly: b.kelly, brier: b.n ? b.brier : null, n: b.n, points: accounts.get(b.identity.toHexString()) ?? null }))
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  const botP = {}
  for (const p of rows('market_bot_p')) (botP[p.questionId] ??= {})[p.bot] = { p: p.p, note: p.note, hour: p.updatedHour }
  const lobbies = (conn.db.lobby ? [...conn.db.lobby.iter()] : []).map((l) => ({
    id: l.id, code: l.code, host: l.host.toHexString(), mode: l.mode, state: l.state, secondsPerHour: l.secondsPerHour,
    nQuestions: l.nQuestions, botsOn: l.bots ?? l.botsOn, createdAt: ms(l.createdAt), stateSince: ms(l.stateSince),
    // The server stamps when the state began; the 5 s countdown ends 5 s after that.
    countdownS: l.countdownS ?? 5, kind: l.kind ?? 'private', roundNo: l.roundNo ?? 0,
    // The module stamps when the countdown ends (countdown_until); older modules only gave state_since.
    countdownEnd: l.countdownUntil != null ? ms(l.countdownUntil) : l.state === 'countdown' ? ms(l.stateSince) + (l.countdownS ?? 5) * 1000 : null,
  }))
  const identities = {}
  const lobbyPlayers = (conn.db.lobby_player ? [...conn.db.lobby_player.iter()] : []).map((p) => {
    identities[p.identity.toHexString()] = p.identity
    return { lobbyId: p.lobbyId, id: p.identity.toHexString(), name: p.name, avatar: p.avatar, ready: p.ready, points: p.points }
  })
  return {
    me: hex ?? null,
    battery: lobbyId != null && conn.db.battery_round ? readBattery(conn, lobbyId, me) : null,
    lobbies,
    lobbyPlayers,
    identities,
    player,
    account,
    bots,
    botP,
    // market_round.id is the lobby id
    round: (conn.db.market_round ? [...conn.db.market_round.iter()] : []).find((r) => lobbyId == null || r.id === lobbyId) ?? null,
    questions: rows('market_question').sort((a, b) => a.targetHour - b.targetHour || a.id.localeCompare(b.id)),
    positions,
    feed: rows('market_feed').sort((a, b) => a.hour - b.hour),
    leaderboard: rows('market_leaderboard').sort((a, b) => a.rank - b.rank),
  }
}

// onState({ status, ...snapshot }); returns { join, buy, sell, close }.
export function connectMarket({ onState, withToken = true, lobbyId = null }) {
  let identity = null
  let timer = 0
  let conn = null
  const emit = (status = 'live') => {
    clearTimeout(timer)
    timer = setTimeout(() => conn && onState({ status, ...read(conn, identity, lobbyId) }), 100)
  }
  conn = DbConnection.builder()
    .withUri(uri())
    .withDatabaseName(DB)
    .withToken(withToken ? tokenStore.get() : undefined)
    .onConnect((c, id, token) => {
      identity = id
      if (withToken) tokenStore.set(token)
      const names = [...TABLES, ...LOBBY_TABLES.filter((n) => c.db[n])]
      for (const name of names) {
        const t = c.db[name]
        t.onInsert(() => emit())
        t.onDelete(() => emit())
        t.onUpdate?.(() => emit())
      }
      // Two subscriptions: the market tables every module has, and the lobby / battery tables that only a newer module
      // has. A server without the second set (the module not republished yet) must not take the first set down.
      c.subscriptionBuilder()
        .onApplied(() => emit())
        .onError(() => onState({ status: 'offline' }))
        .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`))
      const extra = names.filter((n) => !TABLES.includes(n))
      if (extra.length) {
        c.subscriptionBuilder()
          .onApplied(() => emit())
          .onError(() => emit())
          .subscribe(extra.map((t) => `SELECT * FROM ${t}`))
      }
    })
    .onConnectError(() => onState({ status: 'offline' }))
    .onDisconnect(() => onState({ status: 'offline' }))
    .build()

  const call = (name, args) => {
    const fn = conn.reducers[name]
    if (!fn) return Promise.reject(new Error('The lobby is not available on this server yet.'))
    return fn(args)
  }
  return {
    // Reducers of the lobby module (#165). The host joins their own room when it is created.
    lobbyCreate: (o) => call('lobbyCreate', { name: o.name, avatar: o.avatar, mode: o.mode ?? 'market' }),
    lobbyJoin: (code, name, avatar) => call('lobbyJoin', { code, name, avatar }),
    lobbyReady: (ready) => call('lobbyReady', { ready }),
    lobbyLeave: () => call('lobbyLeave', {}),
    lobbyKick: (identityHex) => call('lobbyKick', { identityHex }),
    lobbySettings: (o) => call('lobbySettings', { secondsPerHour: o.secondsPerHour, nQuestions: o.nQuestions, bots: o.botsOn, mode: o.mode ?? 'market' }),
    batteryDecide: (slot, action) => call('batteryDecide', { slot, action }),
    lobbyStart: () => call('lobbyStart', {}),
    // Optional, present once the module has them (quick play, #176): the capability check hides the buttons until then.
    can: (reducer) => !!conn.reducers[reducer],
    quickPlay: (name, avatar) => call('quickPlay', { name, avatar }),
    react: (emoji) => call('react', { emoji }), // present once the module has reactions
    lobbyVote: (choice) => call('lobbyVote', { choice }), // 'start' | 'wait'
    lobbyRematch: () => call('lobbyRematch', {}),
    join: (name) => conn.reducers.join({ name }),
    buy: (questionId, side, shares) => conn.reducers.marketBuy({ questionId, side, shares }),
    sell: (questionId, side, shares) => conn.reducers.marketSell({ questionId, side, shares }),
    close: () => {
      clearTimeout(timer)
      conn.disconnect()
    },
  }
}
