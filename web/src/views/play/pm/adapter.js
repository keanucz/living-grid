import { START_POINTS, fill, mark, points, quote } from './pmMath.js'

// Builds the UI model of a solo markets game from the pm_* rows (public tables: the day, outcomes and future prices stay
// private until each market closes). The UI reads only this shape:
//   { status: 'idle'|'running'|'done', game, me, markets, positions, standings, end }
const hex = (id) => id?.toHexString?.() ?? String(id)
const ms = (t) => (t == null ? null : typeof t === 'number' ? t : Number(t.microsSinceUnixEpoch / 1000n))

export function readPm(conn, me) {
  const rows = (t) => (conn.db[t] ? [...conn.db[t].iter()] : [])
  const meHex = hex(me)
  const games = rows('pm_game').filter((g) => hex(g.owner) === meHex).sort((a, b) => b.id - a.id)
  const g = games[0] ?? null
  if (!g) return { me: meHex, game: null }
  const mine = rows('meta_leaderboard').find((r) => hex(r.identity) === meHex) ?? null
  return {
    me: meHex,
    game: { id: g.id, state: g.state, clockHour: g.clockHour, startHour: g.startHour, endHour: g.endHour, secondsPerHour: g.secondsPerHour, openedAt: ms(g.openedAt), dayRevealed: g.dayRevealed },
    markets: rows('pm_market').filter((m) => m.gameId === g.id),
    prices: rows('pm_price').filter((p) => p.gameId === g.id),
    accounts: rows('pm_account').filter((a) => a.gameId === g.id).map((a) => ({ id: hex(a.identity), name: a.name, isBot: a.isBot, cash: a.points, equity: a.equity })),
    positions: rows('pm_position').filter((p) => p.gameId === g.id).map((p) => ({ id: hex(p.identity), marketId: p.marketId, side: p.side, shares: p.shares, cost: p.cost, settled: p.settled, payout: p.payout })),
    trades: rows('pm_trade').filter((t) => t.gameId === g.id).map((t) => ({ seq: t.seq, id: hex(t.identity), marketId: t.marketId, side: t.side, action: t.action, shares: t.shares, price: t.price, hour: t.hour })),
    meta: mine && { rank: mine.rank, rating: mine.rating },
  }
}

// Profit on one market for one player: cash from sells minus cash for buys, plus what the settled shares paid out.
export function marketPnl(trades, positions, id, marketId) {
  let cash = 0
  for (const t of trades) {
    if (t.id !== id || t.marketId !== marketId) continue
    cash += (t.action === 'sell' ? 1 : -1) * points(t.shares, t.price)
  }
  const payout = positions.filter((p) => p.id === id && p.marketId === marketId).reduce((a, p) => a + (p.settled ? p.payout : 0), 0)
  return Math.round((cash + payout) * 100) / 100
}

const BOT_ORDER = ['Yesterday', 'The Engineer', 'Our model', 'The Committee']

export function toPmModel(raw) {
  const empty = { status: 'idle', game: null, me: null, markets: [], positions: [], standings: [], end: null }
  if (!raw?.game) return empty
  const g = raw.game
  const meAcct = raw.accounts.find((a) => a.id === raw.me)
  const series = {}
  for (const p of raw.prices) (series[p.marketId] ??= []).push({ hour: p.hour, price: p.priceYes })
  for (const k of Object.keys(series)) series[k].sort((a, b) => a.hour - b.hour)
  const myPos = raw.positions.filter((p) => p.id === raw.me)

  const markets = raw.markets
    .map((m) => {
      const s = series[m.marketId] ?? [{ hour: g.startHour, price: m.priceYes }]
      const prev = s.length > 1 ? s[s.length - 2].price : null
      const held = { yes: { shares: 0, cost: 0 }, no: { shares: 0, cost: 0 } }
      for (const p of myPos) if (p.marketId === m.marketId && !p.settled) held[p.side] = { shares: p.shares, cost: p.cost }
      const closed = m.status === 'closed'
      const rev = closed && {
        outcome: m.outcome, actualText: m.actualText, reason: m.note || m.modelNote,
        me: marketPnl(raw.trades, raw.positions, raw.me, m.marketId),
        bots: raw.accounts.filter((a) => a.isBot).map((a) => ({ name: a.name, pnl: marketPnl(raw.trades, raw.positions, a.id, m.marketId) }))
          .sort((a, b) => BOT_ORDER.indexOf(a.name) - BOT_ORDER.indexOf(b.name)),
        iHeld: raw.trades.some((t) => t.id === raw.me && t.marketId === m.marketId),
      }
      return {
        id: m.marketId, text: m.text, kind: m.kind, unit: m.unit, closeHour: m.closeHour, closed, price: m.priceYes, prev, delta: prev == null ? 0 : m.priceYes - prev,
        note: m.note, modelNote: m.modelNote, outcome: m.outcome, actualText: m.actualText, series: s, quote: quote(m.priceYes), held, reveal: rev || null,
      }
    })
    .sort((a, b) => Number(a.closed) - Number(b.closed) || a.closeHour - b.closeHour || a.id.localeCompare(b.id))

  const byId = Object.fromEntries(markets.map((m) => [m.id, m]))
  const positions = myPos
    .filter((p) => p.shares > 1e-9 && !p.settled && byId[p.marketId])
    .map((p) => {
      const m = byId[p.marketId]
      const value = (p.shares * mark(m.price, p.side)) / 100
      const exit = points(p.shares, fill(m.price, p.side, 'sell'))
      return { marketId: p.marketId, text: m.text, side: p.side, shares: p.shares, cost: p.cost, value: Math.round(value * 100) / 100, pnl: Math.round((exit - p.cost) * 100) / 100, closeHour: m.closeHour }
    })
    .sort((a, b) => a.closeHour - b.closeHour)

  const standings = raw.accounts
    .map((a) => ({ id: a.id, name: a.name, isBot: a.isBot, isMe: a.id === raw.me, equity: a.equity, pnl: Math.round((a.equity - START_POINTS) * 100) / 100 }))
    .sort((a, b) => b.equity - a.equity)
  const me = meAcct ? { cash: meAcct.cash, equity: meAcct.equity, pnl: Math.round((meAcct.equity - START_POINTS) * 100) / 100 } : { cash: START_POINTS, equity: START_POINTS, pnl: 0 }
  const done = g.state === 'done'
  return {
    status: done ? 'done' : 'running',
    game: { id: g.id, clockHour: g.clockHour, startHour: g.startHour, endHour: g.endHour, secondsPerHour: g.secondsPerHour, nextTickAt: done || !g.openedAt ? null : g.openedAt + g.secondsPerHour * 1000, dayRevealed: g.dayRevealed },
    me, markets, positions, standings,
    end: done ? { day: g.dayRevealed, rank: standings.findIndex((s) => s.isMe) + 1, meta: raw.meta ? { rank: raw.meta.rank, rating: raw.meta.rating } : null } : null,
  }
}
