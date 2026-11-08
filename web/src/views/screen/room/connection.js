import { DbConnection } from '../../../spacetime/index.ts'
import { uri } from '../../market/connection.js'

// Read-only connection for the big screen of a room: the lobby and its players, and the tables of the game the room
// plays. Beat the model rooms (mode 'beat') read beat_*; only public tables are subscribed, so what the screen shows
// is exactly what any phone could see (nobody's pick, and no answer, before a call's reveal).
const DB = 'living-grid'
const TABLES = ['lobby', 'lobby_player', 'beat_game', 'beat_call', 'beat_player', 'beat_result', 'meta_leaderboard']
const hex = (id) => id?.toHexString?.() ?? String(id ?? '')
const ms = (t) => (t?.microsSinceUnixEpoch != null ? Number(t.microsSinceUnixEpoch / 1000n) : null)

export function readRoom(conn, code) {
  const rows = (t) => (conn.db[t] ? [...conn.db[t].iter()] : [])
  const lobbies = rows('lobby')
  const lobby = code ? lobbies.find((l) => String(l.code).toUpperCase() === code) ?? null : null
  if (!lobby) return { lobby: null, members: [] }
  const members = rows('lobby_player')
    .filter((p) => String(p.lobbyId) === String(lobby.id))
    .map((p) => ({ id: hex(p.identity), name: p.name, avatar: p.avatar || '', ready: !!p.ready, at: ms(p.joinedAt) }))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  const out = {
    lobby: { id: lobby.id, code: lobby.code, mode: lobby.mode, state: lobby.state, countdownUntil: ms(lobby.countdownUntil), host: hex(lobby.host) },
    members,
  }
  if (lobby.mode === 'beat') {
    const g = rows('beat_game').filter((x) => String(x.lobbyId) === String(lobby.id)).sort((a, b) => b.id - a.id)[0] ?? null
    if (g) {
      out.beat = {
        game: { id: g.id, state: g.state, callNo: g.callNo, nCalls: g.nCalls, answerS: g.answerS, revealS: g.revealS, openedAt: ms(g.openedAt), dayRevealed: g.dayRevealed },
        calls: rows('beat_call').filter((c) => c.gameId === g.id).sort((a, b) => a.idx - b.idx),
        players: rows('beat_player').filter((p) => p.gameId === g.id).map((p) => ({ id: hex(p.identity), name: p.name, score: p.score, isBot: p.isBot })),
        results: rows('beat_result').filter((r) => r.gameId === g.id).map((r) => ({ id: hex(r.identity), idx: r.idx, choice: r.choice, confidence: r.confidence, correct: r.correct, score: r.score })),
      }
    }
  }
  return out
}

// onState({ status, ...readRoom }). Returns { close }.
export function connectRoom({ code, onState }) {
  let conn = null
  let timer = 0
  const emit = (status = 'live') => {
    clearTimeout(timer)
    timer = setTimeout(() => conn && onState({ status, ...readRoom(conn, code) }), 100)
  }
  conn = DbConnection.builder()
    .withUri(uri())
    .withDatabaseName(DB)
    .onConnect((c) => {
      const names = TABLES.filter((t) => c.db[t])
      for (const name of names) {
        const t = c.db[name]
        t.onInsert(() => emit())
        t.onDelete(() => emit())
        t.onUpdate?.(() => emit())
      }
      c.subscriptionBuilder()
        .onApplied(() => emit())
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
