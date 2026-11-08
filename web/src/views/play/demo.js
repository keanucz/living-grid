import { useEffect, useRef, useState } from 'react'
import { clampConf, rankOf } from './model.js'
import { callScore } from './score.js'

// Rehearsal mode (#/play?demo=1): a scripted round with INVENTED calls, bot answers and results, so the screens can be
// played and shown without the game module. It is labelled on screen and never touches the database.
export const DEMO_BANNER = 'Rehearsal: these calls, answers and results are invented to show how the game works. Not real data.'
const ANSWER_S = 15
const REVEAL_S = 6

const CALLS = [
  { kind: 'price_band', text: 'What will Britain\'s day-ahead price be at 18:00?', unit: '£/MWh', hour: 18, context: 'Yesterday at 18:00 it was £142.',
    options: [{ id: 'a', label: 'Under £100' }, { id: 'b', label: '£100 to £140' }, { id: 'c', label: '£140 to £180' }, { id: 'd', label: '£180 to £220' }, { id: 'e', label: 'Over £220' }],
    correct: 'c', actual: 'A rainy evening peak: £163/MWh.', modelAns: ['c', 72], reason: 'Wind is forecast to fall by a third by evening while demand peaks, which usually lifts the price.',
    bots: [['Yesterday', 'b', 60], ['The Engineer', 'c', 80], ['The Committee', 'c', 65]] },
  { kind: 'battery', text: 'A 1 MW battery is half full. What should it do from 03:00 to 04:00?', hour: 3,
    options: [{ id: 'charge', label: 'Charge' }, { id: 'hold', label: 'Hold' }, { id: 'sell', label: 'Sell' }],
    correct: 'charge', actual: 'Prices were £48 at 03:00 and £121 at 08:00, so charging early paid.', modelAns: ['charge', 85], reason: 'Overnight wind is strong and demand is low, so power is at its cheapest of the day.',
    bots: [['Yesterday', 'charge', 55], ['The Engineer', 'hold', 60], ['The Committee', 'charge', 75]] },
  { kind: 'import_export', text: 'Over 12:00 to 13:00, will Britain import or export power?', hour: 12,
    options: [{ id: 'import', label: 'Import' }, { id: 'export', label: 'Export' }],
    correct: 'import', actual: 'Net import of 3.1 GW across the interconnectors.', modelAns: ['import', 66], reason: 'Britain\'s price is above France\'s and Norway\'s, so power flows in.',
    bots: [['Yesterday', 'import', 70], ['The Engineer', 'import', 60], ['The Committee', 'export', 55]] },
  { kind: 'dearest_zone', text: 'At 18:00, which zone has the highest price?', hour: 18,
    options: [{ id: 'GB', label: 'Britain' }, { id: 'DE-LU', label: 'Germany' }, { id: 'FR', label: 'France' }, { id: 'NL', label: 'Netherlands' }, { id: 'NO2', label: 'S. Norway' }],
    correct: 'DE-LU', actual: 'Germany at €171/MWh, Britain €163, France €150.', modelAns: ['GB', 50], reason: 'Britain and Germany are close; gas sets the price in both and it is a coin flip.',
    bots: [['Yesterday', 'GB', 60], ['The Engineer', 'DE-LU', 70], ['The Committee', 'DE-LU', 55]] },
  { kind: 'wind_off', text: 'Will Britain pay wind farms to switch off more than 5 GWh before midday?', hour: 12,
    options: [{ id: 'over', label: 'Over 5 GWh' }, { id: 'under', label: 'Under 5 GWh' }],
    correct: 'over', actual: '8.4 GWh switched off, mostly in Scotland.', modelAns: ['over', 78], reason: 'A strong westerly over Scotland meets a cable that is already at its limit.',
    bots: [['Yesterday', 'under', 55], ['The Engineer', 'over', 65], ['The Committee', 'over', 70]] },
]

// The module's scoring (score.js): 100 for a certain right call, 0 for a guess, negative for a confident miss.
export const brierPoints = (right, conf, n) => callScore(n, conf, right)

function totalsOf(state) {
  const rows = [{ id: 'me', name: 'You', isBot: false, isMe: true, points: state.me }, { id: 'model', name: 'The model', isBot: true, isMe: false, points: state.model },
    ...CALLS[0].bots.map(([name]) => ({ id: name, name, isBot: true, isMe: false, points: state.bots[name] ?? 0 }))]
  return rows.sort((a, b) => b.points - a.points)
}

// The UI model for the demo's current state (see model.js).
export function demoModel(st) {
  const base = { rehearsal: true, nCalls: CALLS.length, callNo: st.n, totals: totalsOf(st), history: st.history }
  const lastReveal = () => demoModel({ ...st, done: false, phase: 'reveal', n: CALLS.length - 1 })
  if (st.done) {
    const totals = totalsOf(st)
    const last = lastReveal()
    return { ...base, status: 'done', phase: 'reveal', phaseUntil: null, call: last.call, mine: null, reveal: last.reveal,
      end: { day: 'an invented Tuesday', regime: 'windy', rank: rankOf(totals), nPlayers: 1, meta: null } }
  }
  const c = CALLS[st.n]
  const call = { n: st.n, kind: c.kind, text: c.text, options: c.options, unit: c.unit, hour: c.hour, context: c.context }
  if (st.phase === 'answer') return { ...base, status: 'running', phase: 'answer', phaseUntil: st.until, call, mine: st.mine, reveal: null, end: null }
  const botRows = c.bots.map(([name, opt, conf]) => ({ id: name, title: name, option: opt, confidence: conf, points: brierPoints(opt === c.correct, conf, c.options.length) }))
  return { ...base, status: 'running', phase: 'reveal', phaseUntil: st.until, call, mine: st.mine, end: null,
    reveal: { correct: c.correct, actual: null, actualText: c.actual,
      model: { option: c.modelAns[0], confidence: c.modelAns[1], reason: c.reason, points: brierPoints(c.modelAns[0] === c.correct, c.modelAns[1], c.options.length) },
      mine: st.mine ? { ...st.mine, points: brierPoints(st.mine.option === c.correct, st.mine.confidence, c.options.length) } : null, bots: botRows } }
}

const fresh = () => ({ n: 0, phase: 'answer', until: Date.now() + ANSWER_S * 1000, mine: null, me: 0, model: 0, bots: {}, history: [], done: false })

export function useDemo(enabled) {
  const [st, setSt] = useState(fresh)
  const ref = useRef(st)
  ref.current = st

  const toReveal = (s) => {
    const c = CALLS[s.n]
    const right = s.mine ? s.mine.option === c.correct : null
    const pts = s.mine ? brierPoints(right, s.mine.confidence, c.options.length) : 0
    const bots = { ...s.bots }
    for (const [name, opt, conf] of c.bots) bots[name] = (bots[name] ?? 0) + brierPoints(opt === c.correct, conf, c.options.length)
    return { ...s, done: s.n + 1 >= CALLS.length, phase: 'reveal', until: Date.now() + REVEAL_S * 1000, me: s.me + pts, model: s.model + brierPoints(c.modelAns[0] === c.correct, c.modelAns[1], c.options.length),
      bots, history: [...s.history, { n: s.n, right, points: pts }] }
  }
  const next = (s) => (s.n + 1 >= CALLS.length ? { ...s, done: true } : { ...fresh(), n: s.n + 1, me: s.me, model: s.model, bots: s.bots, history: s.history })

  useEffect(() => {
    if (!enabled || st.done) return undefined
    const wait = Math.max(0, st.until - Date.now())
    const t = setTimeout(() => setSt((s) => (s.phase === 'answer' ? toReveal(s) : next(s))), wait + 30)
    return () => clearTimeout(t)
  }, [enabled, st.phase, st.n, st.until, st.done]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    model: enabled ? demoModel(st) : null,
    answer: (option, confidence) => setSt((s) => (s.phase === 'answer' && !s.mine ? toReveal({ ...s, mine: { option, confidence: clampConf(confidence) } }) : s)),
    again: () => setSt(fresh()),
  }
}
