import { useState } from 'react'
import { edge, parse, tradeCostN } from './lmsr.js'

// A question with several options, exactly one of which wins (price bands, which zone, import or export...).
// Props are the generated rows: q is a market_question with qtype 'choice' (camelCase fields), `positions` the player's
// market_position rows for it ({side, shares, spent}), round the market_round; onTrade('buy'|'sell', id, side, shares).
// Each option shows the room's price, what our model says (from forecasts made before the day) and the edge in
// points per share. The module settles the winning option at 1 point per share.
const SIZES = [10, 25, 50]
const pct = (p) => `${Math.round(p * 100)}%`
const pts = (v) => v.toFixed(1)
const hour = (h) => `${String(h).padStart(2, '0')}:00`

export default function ChoiceQuestion({ q, round, positions = [], points, busy, onTrade }) {
  const [size, setSize] = useState(25)
  const choices = parse(q.choicesJson, [])
  const prices = parse(q.pricesJson, {})
  const open = q.status === 'open' && round.status === 'running' && round.clockHour < q.targetHour
  const settled = q.status === 'settled'
  const held = Object.fromEntries(positions.map((p) => [p.side, p]))
  const spent = positions.reduce((a, p) => a + p.spent, 0)
  const payout = settled ? held[q.outcome]?.shares ?? 0 : 0
  const net = payout - spent
  const winner = choices.find((c) => c.id === q.outcome)

  return (
    <article className={`mk-card mk-q ${settled ? 'done' : ''}`}>
      <div className="mk-qtop">
        <span className="mk-tag">{settled ? 'Settled' : open ? `Closes ${hour(q.targetHour)}` : `Settles after ${hour(q.targetHour)}`}</span>
        {q.modelNote && <span className="mk-faint" title={q.modelNote}>ⓘ</span>}
      </div>
      <h3>{q.text}</h3>
      {open && (
        <div className="mk-sizes" role="group" aria-label="Number of shares">
          {SIZES.map((n) => <button key={n} className={n === size ? 'on' : ''} onClick={() => setSize(n)}>{n}</button>)}
          <span className="mk-faint">shares · each pays 1 point if that option wins</span>
        </div>
      )}
      <div className="ch-options">
        {choices.map((c) => {
          const price = prices[c.id] ?? 1 / Math.max(1, choices.length)
          const e = edge(c.p ?? price, price)
          const cost = open ? tradeCostN(q, c.id, size, round.b) : 0
          const mine = held[c.id]?.shares ?? 0
          return (
            <div key={c.id} className={`ch-opt ${settled && c.id === q.outcome ? 'won' : ''}`}>
              <div className="ch-top">
                <b>{c.label}</b>
                <span className="num">{pct(price)}</span>
              </div>
              <div className="mk-bar"><i style={{ width: pct(price) }} /></div>
              <div className="ch-meta">
                {c.p != null && <span>Our model {pct(c.p)}</span>}
                {c.p != null && open && (
                  <span className={e.expected >= 0 ? 'yes' : 'no'} title={`If our model is right a share is worth ${pct(c.p)} against a price of ${pct(price)}; you risk the whole price (${pts(e.risk)} pts) per share`}>
                    {e.expected >= 0 ? '+' : '−'}{pts(Math.abs(e.expected))} per share expected · risk {pts(e.risk)}
                  </span>
                )}
                {mine > 0 && <span className="mk-faint">you hold {mine}</span>}
              </div>
              {open && (
                <div className="ch-buttons">
                  <button className="mk-yes" disabled={busy || !(cost <= points)} onClick={() => onTrade('buy', q.id, c.id, size)}>Buy {size}<small>{pts(cost)} pts</small></button>
                  {mine > 0 && <button disabled={busy} onClick={() => onTrade('sell', q.id, c.id, Math.min(size, mine))}>Sell {Math.min(size, mine)}</button>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {settled && (
        <div className="mk-result">
          <b className="yes">{winner?.label ?? q.outcome}</b> won{q.unit ? ` (actual ${Number(q.actual).toFixed(1)} ${q.unit})` : ''}.
          {positions.length > 0 && <> You {net >= 0 ? 'made' : 'lost'} <b className={net >= 0 ? 'yes' : 'no'}>{pts(Math.abs(net))} pts</b> here.</>}
        </div>
      )}
      <style>{CSS}</style>
    </article>
  )
}

const CSS = `
.ch-options { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.ch-opt { border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; background: var(--card); }
.ch-opt.won { border-color: var(--accent); background: var(--accent-dim); }
.ch-top { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: 14px; }
.ch-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--text-2); margin-top: 6px; }
.ch-buttons { display: flex; gap: 8px; margin-top: 8px; }
.ch-buttons button { flex: 1; min-height: 40px; border-radius: 12px; }
`
