import { callScore } from './score.js'

// Builds the UI model (model.js) from the Beat the model rows. This is the only file that knows the table layout:
// beat_game / beat_call / beat_player / beat_result (public) and profile / meta_leaderboard for the final rank.
// A player's own pick is private until the reveal (beat_pick), so `picks` holds what this device sent.
const hex = (id) => id?.toHexString?.() ?? String(id)
const ms = (t) => (t == null ? null : typeof t === 'number' ? t : Number(t.microsSinceUnixEpoch / 1000n))
const MODEL_BOT = 'Our model'

export function readBeat(conn, me, lobbyId = null) {
  const rows = (t) => (conn.db[t] ? [...conn.db[t].iter()] : [])
  const meHex = hex(me)
  const players = rows('beat_player')
  const mine = new Set(players.filter((p) => hex(p.identity) === meHex).map((p) => p.gameId))
  const games = rows('beat_game')
    .filter((g) => (lobbyId != null ? g.lobbyId === lobbyId : g.lobbyId === 0 && mine.has(g.id)))
    .sort((a, b) => b.id - a.id)
  const game = games[0] ?? null
  if (!game) return { me: meHex, game: null }
  const meta = rows('meta_leaderboard').find((r) => hex(r.identity) === meHex) ?? null
  return {
    me: meHex,
    game: { id: game.id, lobbyId: game.lobbyId, state: game.state, callNo: game.callNo, nCalls: game.nCalls, answerS: game.answerS, revealS: game.revealS, openedAt: ms(game.openedAt), dayRevealed: game.dayRevealed },
    calls: rows('beat_call').filter((c) => c.gameId === game.id).sort((a, b) => a.idx - b.idx),
    players: players.filter((p) => p.gameId === game.id).map((p) => ({ id: hex(p.identity), name: p.name, score: p.score, isBot: p.isBot })),
    results: rows('beat_result').filter((r) => r.gameId === game.id).map((r) => ({ id: hex(r.identity), idx: r.idx, choice: r.choice, confidence: r.confidence, correct: r.correct, score: r.score })),
    meta: meta && { rank: meta.rank, rating: meta.rating },
  }
}

const parseOptions = (c) => {
  try {
    return JSON.parse(c.optionsJson)
  } catch {
    return []
  }
}

// raw: readBeat() output; ctx: { picks: { '<gameId>|<idx>': {option, confidence} }, seenReveal: ms when this device first saw the reveal }
export function toModel(raw, ctx = {}) {
  const empty = { status: 'idle', nCalls: 5, callNo: 0, phase: 'answer', phaseUntil: null, call: null, mine: null, reveal: null, totals: [], history: [], end: null }
  if (!raw?.game) return empty
  const g = raw.game
  const byIdx = Object.fromEntries(raw.calls.map((c) => [c.idx, c]))
  const totals = [...raw.players].sort((a, b) => b.score - a.score).map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, isMe: p.id === raw.me, points: p.score }))
  const history = raw.results.filter((r) => r.id === raw.me).sort((a, b) => a.idx - b.idx).map((r) => ({ n: r.idx, right: r.choice === '' ? null : r.correct, points: r.score }))
  const base = { nCalls: g.nCalls, callNo: g.callNo, totals, history }
  const row = byIdx[g.callNo]
  const options = row ? parseOptions(row) : []
  const call = row ? { n: row.idx, kind: row.kind, text: row.text, options, unit: row.unit, hour: row.hour, context: null } : null

  const revealFor = (c) => {
    const opts = parseOptions(c)
    const res = raw.results.filter((r) => r.idx === c.idx)
    const mineRes = res.find((r) => r.id === raw.me)
    const botNames = new Map(raw.players.filter((p) => p.isBot).map((p) => [p.id, p.name]))
    const modelId = [...botNames].find(([, name]) => name === MODEL_BOT)?.[0]
    const modelRes = res.find((r) => r.id === modelId)
    return {
      correct: c.answer, actual: null, actualText: c.actualText,
      model: { option: c.modelChoice, confidence: Math.round(c.modelConfidence), reason: c.modelReason, points: modelRes ? modelRes.score : callScore(opts.length, c.modelConfidence, c.modelChoice === c.answer) },
      mine: mineRes && mineRes.choice !== '' ? { option: mineRes.choice, confidence: mineRes.confidence, points: mineRes.score } : null,
      bots: res.filter((r) => botNames.has(r.id) && r.id !== modelId).map((r) => ({ id: r.id, title: botNames.get(r.id), option: r.choice || null, confidence: r.confidence, points: r.score })),
    }
  }

  if (g.state === 'done') {
    const last = byIdx[g.nCalls - 1]
    const humans = raw.players.filter((p) => !p.isBot).length
    return { ...base, status: 'done', phase: 'reveal', phaseUntil: null, call: last ? { n: last.idx, kind: last.kind, text: last.text, options: parseOptions(last), unit: last.unit, hour: last.hour, context: null } : null,
      mine: null, reveal: last ? revealFor(last) : null,
      end: { day: g.dayRevealed, regime: '', rank: totals.findIndex((t) => t.isMe) + 1 || null, nPlayers: humans, meta: raw.meta ? { rank: raw.meta.rank, rating: raw.meta.rating, delta: null } : null } }
  }
  if (g.state === 'revealing' && row) {
    return { ...base, status: 'running', phase: 'reveal', phaseUntil: ctx.seenReveal ? ctx.seenReveal + g.revealS * 1000 : null, call, mine: null, reveal: revealFor(row), end: null }
  }
  return { ...base, status: 'running', phase: 'answer', phaseUntil: g.openedAt + g.answerS * 1000, call, mine: ctx.picks?.[`${g.id}|${g.callNo}`] ?? null, reveal: null, end: null }
}
