import { useEffect, useRef, useState } from 'react'
import { toPmModel } from './adapter.js'
import { START_POINTS, fill, mark, points } from './pmMath.js'

// Rehearsal (#/play?demo=1): a scripted day of INVENTED markets, prices and results, played with the module's own
// pricing rules, so the screens can be tried and shown without the game module. It produces the same rows as the module
// and goes through the same adapter. Labelled on screen; never touches the database.
export const DEMO_BANNER = 'Rehearsal: these markets, prices and results are invented to show how the game works. Not real data.'
const START = 12
const END = 19
export const DEMO_TICK_S = 4

const MARKETS = [
  { id: 'gb-price-18', kind: 'price', unit: 'GBP/MWh', close: 18, text: "Will Britain's day-ahead price at 18:00 be above £150/MWh?", modelNote: 'Our forecast made 12 hours ahead: median £146, 80% range £98 to £201.',
    path: [52, 55, 61, 66, 72, 78], why: { 12: 'Opening price from our as-of forecast.', 14: 'Britain at 13:00 came in £11 above our forecast, so the odds moved up.', 16: 'Wind is falling faster than forecast, so the evening peak looks dearer.' },
    outcome: 'yes', actual: 'The 18:00 price was £163/MWh.', beliefs: { bot_yesterday: 0.41, bot_engineer: 0.66, lgbm_q: 0.52, bot_committee: 0.58 } },
  { id: 'gb-wind-off', kind: 'wind_off', unit: 'GWh', close: 16, text: 'Will Britain pay wind farms to switch off more than 5 GWh before 16:00?', modelNote: 'History only: 18 of the last 30 days passed this line.',
    path: [40, 44, 53, 64], why: { 12: 'Opening price from the last 30 days.', 14: 'Switch-offs so far are running ahead of a normal day.' },
    outcome: 'yes', actual: '8.4 GWh switched off, mostly in Scotland.', beliefs: { bot_yesterday: 0.35, bot_engineer: 0.55, lgbm_q: 0.4, bot_committee: 0.5 } },
  { id: 'de-negative', kind: 'negative_price', unit: 'EUR/MWh', close: 19, text: 'Will Germany have a negative price in any hour before 19:00?', modelNote: 'Our forecast: lowest hour €38/MWh, 80% range €-4 to €71.',
    path: [18, 15, 12, 9, 7, 6, 5], why: { 12: 'Opening price from our as-of forecast.', 15: 'Prices so far stayed well above zero, so the odds fell.' },
    outcome: 'no', actual: 'The lowest hour was €31/MWh.', beliefs: { bot_yesterday: 0.1, bot_engineer: 0.2, lgbm_q: 0.17, bot_committee: 0.14 } },
  { id: 'wx-gust', kind: 'weather_gust', unit: 'mph', close: 17, text: 'Will gusts reach 50 mph in Scotland before 17:00?', modelNote: 'gusts of 46 mph at Aberdeen at 15:00 and 55 mph on the Hebrides at 16:00 in the latest ensemble.',
    path: [34, 38, 45, 58, 71], why: { 12: 'Opening price from the weather ensemble.', 15: 'The latest forecast run raised the peak gust.' },
    outcome: 'yes', actual: 'A gust of 58 mph on the Hebrides at 16:00.', beliefs: { bot_yesterday: 0.3, bot_engineer: 0.45, lgbm_q: 0.38, bot_committee: 0.42 } },
  { id: 'wx-london-cold', kind: 'weather_temp', unit: '°C', close: 19, text: 'Will London fall below 2°C before 19:00?', modelNote: 'forecast low 3.1°C at 18:00, ensemble spread ±1.4°C.',
    path: [44, 43, 41, 37, 30, 25, 21], why: { 12: 'Opening price from the weather ensemble.', 16: 'Cloud cover is holding the temperature up.' },
    outcome: 'no', actual: 'The low was 3.4°C at 18:00.', beliefs: { bot_yesterday: 0.5, bot_engineer: 0.4, lgbm_q: 0.38, bot_committee: 0.4 } },
]
const BOTS = [['bot_yesterday', 'Yesterday'], ['bot_engineer', 'The Engineer'], ['lgbm_q', 'Our model'], ['bot_committee', 'The Committee']]
const key = (id, m, side) => `${id}|${m}|${side}`

function fresh() {
  const s = {
    clock: START, openedAt: Date.now(), cash: { me: START_POINTS }, pos: {}, trades: [], closed: {}, prices: [], seq: 0, done: false,
  }
  for (const [bid] of BOTS) s.cash[bid] = START_POINTS
  for (const m of MARKETS) s.prices.push({ marketId: m.id, hour: START, priceYes: m.path[0] })
  for (const [bid] of BOTS) {
    for (const m of MARKETS) {
      const p = m.path[0]
      const yesEdge = m.beliefs[bid] - fill(p, 'yes', 'buy') / 100
      const noEdge = 1 - m.beliefs[bid] - fill(p, 'no', 'buy') / 100
      const side = yesEdge >= noEdge ? 'yes' : 'no'
      const edge = Math.max(yesEdge, noEdge)
      if (edge < 0.03) continue
      const shares = Math.min(300, Math.floor((s.cash[bid] * Math.min(0.2, 1.5 * edge) * 100) / fill(p, side, 'buy')))
      if (shares > 0) applyTrade(s, bid, m.id, side, 'buy', shares)
    }
  }
  return s
}

const priceOf = (s, mid) => [...s.prices].reverse().find((p) => p.marketId === mid).priceYes

function applyTrade(s, who, mid, side, action, shares) {
  const cents = fill(priceOf(s, mid), side, action)
  const amount = points(shares, cents)
  const k = key(who, mid, side)
  const pos = s.pos[k] ?? { shares: 0, cost: 0, settled: false, payout: 0 }
  if (action === 'buy') {
    if (amount > s.cash[who] + 1e-9) throw new Error('not enough points')
    s.cash[who] = Math.round((s.cash[who] - amount) * 100) / 100
    s.pos[k] = { ...pos, shares: pos.shares + shares, cost: Math.round((pos.cost + amount) * 100) / 100 }
  } else {
    if (shares > pos.shares + 1e-9) throw new Error('you do not hold that many')
    const keep = (pos.shares - shares) / pos.shares
    s.cash[who] = Math.round((s.cash[who] + amount) * 100) / 100
    s.pos[k] = { ...pos, shares: pos.shares - shares, cost: Math.round(pos.cost * keep * 100) / 100 }
  }
  s.trades.push({ seq: ++s.seq, id: who, marketId: mid, side, action, shares, price: cents, hour: s.clock })
}

function tick(s) {
  const clock = s.clock + 1
  for (const m of MARKETS) {
    if (s.closed[m.id]) continue
    if (m.close <= clock) {
      s.closed[m.id] = true
      for (const [k, p] of Object.entries(s.pos)) {
        const [who, mid, side] = k.split('|')
        if (mid !== m.id || p.settled) continue
        const win = side === m.outcome ? p.shares : 0
        s.cash[who] = Math.round((s.cash[who] + win) * 100) / 100
        s.pos[k] = { ...p, settled: true, payout: win }
      }
    } else {
      s.prices.push({ marketId: m.id, hour: clock, priceYes: m.path[clock - START] })
    }
  }
  s.clock = clock
  s.openedAt = Date.now()
  s.done = MARKETS.every((m) => s.closed[m.id])
}

const equityOf = (s, who) => {
  let v = s.cash[who]
  for (const [k, p] of Object.entries(s.pos)) {
    const [w, mid, side] = k.split('|')
    if (w !== who || p.settled || s.closed[mid]) continue
    v += (p.shares * mark(priceOf(s, mid), side)) / 100
  }
  return Math.round(v * 100) / 100
}

// The rows the module would have, for the adapter.
export function demoRaw(s) {
  const dummy = 'me'
  const last = {}
  for (const p of s.prices) last[p.marketId] = p
  return {
    me: dummy,
    game: { id: 1, state: s.done ? 'done' : 'running', clockHour: s.clock, startHour: START, endHour: END, secondsPerHour: DEMO_TICK_S, openedAt: s.openedAt, dayRevealed: s.done ? 'an invented Tuesday' : '' },
    markets: MARKETS.map((m) => {
      const hr = s.clock
      const closed = !!s.closed[m.id]
      return { marketId: m.id, text: m.text, kind: m.kind, unit: m.unit, closeHour: m.close, modelNote: m.modelNote, status: closed ? 'closed' : 'open', priceYes: last[m.id].priceYes,
        note: m.why[Math.max(START, ...Object.keys(m.why).map(Number).filter((h) => h <= hr))] ?? '',
        outcome: closed ? m.outcome : '', actualText: closed ? m.actual : '' }
    }),
    prices: s.prices,
    accounts: [{ id: 'me', name: 'You', isBot: false, cash: s.cash.me, equity: equityOf(s, 'me') }, ...BOTS.map(([bid, name]) => ({ id: bid, name, isBot: true, cash: s.cash[bid], equity: equityOf(s, bid) }))],
    positions: Object.entries(s.pos).map(([k, p]) => { const [id, marketId, side] = k.split('|'); return { id, marketId, side, shares: p.shares, cost: p.cost, settled: p.settled, payout: p.payout } }),
    trades: s.trades,
    meta: null,
  }
}

export function usePmDemo() {
  const ref = useRef(fresh())
  const [, bump] = useState(0)
  const rerender = () => bump((n) => n + 1)
  useEffect(() => {
    const t = setInterval(() => {
      if (ref.current.done) return
      if (Date.now() - ref.current.openedAt >= DEMO_TICK_S * 1000) {
        tick(ref.current)
        rerender()
      }
    }, 250)
    return () => clearInterval(t)
  }, [])
  return {
    model: toPmModel(demoRaw(ref.current)),
    trade: async (action, marketId, side, shares) => {
      if (ref.current.done) throw new Error('this game is over')
      if (ref.current.closed[marketId]) throw new Error('that market has closed')
      applyTrade(ref.current, 'me', marketId, side, action, shares)
      rerender()
    },
    again: () => {
      ref.current = fresh()
      rerender()
    },
  }
}
