import { DbConnection } from '../../spacetime/index.ts'
import { uri } from '../market/connection.js'

// Read-only connection for the big screen: every market table plus the room's players, and the lobby tables once
// the module has them (#165). Trades and settles are reported as events so the screen can show reaction bursts.
const DB = 'living-grid'
const TABLES = ['player', 'market_round', 'market_question', 'market_account', 'market_position', 'market_feed', 'market_leaderboard', 'market_bot', 'market_bot_p']
const LOBBY_TABLES = ['lobby', 'lobby_player']
const micros = (t) => (t?.microsSinceUnixEpoch != null ? Number(t.microsSinceUnixEpoch / 1000n) : null)
const hex = (id) => id?.toHexString?.() ?? String(id ?? '')

function lobbyRows(conn, code) {
  if (!conn.db.lobby) return { lobby: null, members: null }
  const lobbies = [...conn.db.lobby.iter()]
  const lobby = (code ? lobbies.find((l) => String(l.code).toUpperCase() === code) : null) ?? (code ? null : lobbies.at(-1) ?? null)
  if (!lobby) return { lobby: null, members: [] }
  const members = [...conn.db.lobby_player.iter()]
    .filter((p) => String(p.lobbyId) === String(lobby.id))
    .map((p) => ({ id: hex(p.identity), name: p.name, avatar: p.avatar || '', ready: !!p.ready, at: micros(p.joinedAt) }))
  return { lobby: { code: lobby.code, state: lobby.state, id: lobby.id }, members }
}

export function read(conn, code) {
  const rows = (t) => [...conn.db[t].iter()]
  const names = new Map(rows('market_account').map((a) => [hex(a.identity), a]))
  const bots = rows('market_bot')
    .map((b) => ({ name: b.name, title: b.title, method: b.method, kelly: b.kelly, brier: b.n ? b.brier : null, n: b.n, points: names.get(hex(b.identity))?.points ?? null }))
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  const botP = {}
  for (const p of rows('market_bot_p')) (botP[p.questionId] ??= {})[p.bot] = p.p
  const { lobby, members } = lobbyRows(conn, code)
  // Without lobbies, the room is everyone who joined in the last three hours or holds a market account.
  const since = Date.now() - 3 * 3600e3
  const players =
    members ??
    rows('player')
      .filter((p) => (micros(p.joinedAt) ?? 0) > since || names.has(hex(p.identity)))
      .map((p) => ({ id: hex(p.identity), name: p.name, avatar: '', ready: true, at: micros(p.joinedAt) }))
  return {
    lobby,
    players: players.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)),
    bots,
    botP,
    round: rows('market_round')[0] ?? null,
    questions: rows('market_question').sort((a, b) => a.targetHour - b.targetHour || a.id.localeCompare(b.id)),
    feed: rows('market_feed').sort((a, b) => a.hour - b.hour),
    leaderboard: rows('market_leaderboard').sort((a, b) => a.rank - b.rank),
  }
}

// onState(snapshot), onEvent({ kind: 'trade' | 'settle', ... }). Returns { close }.
export function connectScreen({ code, onState, onEvent }) {
  let conn = null
  let timer = 0
  let applied = false
  const emit = (status = 'live') => {
    clearTimeout(timer)
    timer = setTimeout(() => conn && onState({ status, ...read(conn, code) }), 120)
  }
  const accountName = (id) => conn.db.market_account.identity?.find?.(id)?.name ?? null
  const question = (qid) => conn.db.market_question.id?.find?.(qid) ?? null
  const trade = (prev, row) => {
    if (!applied) return
    const dy = row.yes - (prev?.yes ?? 0)
    const dn = row.no - (prev?.no ?? 0)
    if (Math.abs(dy) < 1e-9 && Math.abs(dn) < 1e-9) return
    const side = Math.abs(dy) >= Math.abs(dn) ? 'yes' : 'no'
    const shares = side === 'yes' ? dy : dn
    onEvent?.({ kind: 'trade', who: accountName(row.identity) ?? 'Someone', side, shares, question: question(row.questionId)?.text ?? '' })
  }
  conn = DbConnection.builder()
    .withUri(uri())
    .withDatabaseName(DB)
    .onConnect((c) => {
      const names = [...TABLES, ...LOBBY_TABLES.filter((t) => c.db[t])]
      for (const name of names) {
        const t = c.db[name]
        t.onInsert(() => emit())
        t.onDelete(() => emit())
        t.onUpdate?.(() => emit())
      }
      c.db.market_position.onInsert((_, row) => trade(null, row))
      c.db.market_position.onUpdate?.((_, prev, row) => trade(prev, row))
      c.db.market_question.onUpdate?.((_, prev, row) => {
        if (applied && prev.status !== 'settled' && row.status === 'settled') onEvent?.({ kind: 'settle', outcome: row.outcome, question: row.text })
      })
      c.subscriptionBuilder()
        .onApplied(() => {
          applied = true
          emit()
        })
        .onError(() => onState({ status: 'offline' }))
        .subscribe(names.map((t) => `SELECT * FROM ${t}`))
    })
    .onConnectError(() => onState({ status: 'offline' }))
    .onDisconnect(() => onState({ status: 'offline' }))
    .build()
  return {
    close: () => {
      clearTimeout(timer)
      conn.disconnect()
    },
  }
}
