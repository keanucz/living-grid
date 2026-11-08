import { useState } from 'react'
import Backtest from '../backtest/Backtest.jsx'
import Explain from '../../ui/Explain.jsx'
import Term from '../../ui/Term.jsx'
import Techniques from './Techniques.jsx'
import { pct, scoreboard } from './summary.js'
import { useScores } from './useScores.js'

const sharePct = (v) => `${(v * 100).toFixed(0)}%`
const whole = (v) => Math.round(Math.abs(v * 100))

// Proof, in plain words first: the two live numbers as sentences, the original tiles under "For experts".
function Scoreboard() {
  const { scores, source } = useScores()
  const [open, setOpen] = useState(false)
  if (!scores) return null
  const s = scoreboard(scores)
  const bad = s.error && s.error.value > 0

  const tiles = [
    {
      label: 'Error vs persistence',
      value: s.error ? pct(s.error.value) : '—',
      tone: s.error ? (bad ? 'bad' : 'good') : '',
      note: s.error ? `${bad ? 'worse' : 'smaller'} than "same as an hour ago"` : 'no scored outcomes yet',
      tag: s.error?.source,
    },
    {
      label: 'Inside the P10–P90 band',
      value: s.coverage ? sharePct(s.coverage.value) : '—',
      tone: s.coverage && s.coverage.value < 0.75 ? 'warn' : '',
      note: 'target 80%',
      tag: s.coverage?.source,
    },
    {
      label: 'Forecasts scored',
      value: s.scored.toLocaleString('en-GB'),
      tone: '',
      note: s.live ? `since ${s.since}, all logged before the outcome` : 'scoring starts as outcomes land',
      tag: s.live ? 'Live' : undefined,
    },
  ]
  if (s.battery.present) {
    const b = s.battery
    tiles.push({
      label: 'Battery share of perfect',
      value: sharePct(b.risk ?? b.median),
      tone: (b.risk ?? b.median) < 0 ? 'bad' : '',
      note: b.risk != null ? `risk-aware${b.median != null ? `, median-only ${sharePct(b.median)}` : ''}` : 'median-only',
    })
  }

  const answer = (
    <>
      {s.error && (
        <p>
          Our price forecasts are <b className="num">{whole(s.error.value)}%</b> {bad ? 'more' : 'less'} wrong than guessing the price stays where it is.
        </p>
      )}
      {s.coverage && (
        <p>
          {s.basis === 'live' ? 'Live so far, the' : 'The'} real price landed inside our <Term id="likely-range">likely range</Term> <b className="num">{whole(s.coverage.value)}%</b> of the time, against the 80% we aim for.{s.basis === 'live' && s.coverage.value < 70 ? ' Our live ranges are too narrow so far.' : ''}
        </p>
      )}
      {!s.error && !s.coverage && <p>Scores appear as soon as the first forecasts meet their outcomes.</p>}
      <Techniques />
      {(s.error || s.coverage) && (
        <p className="score-basis">
          {s.basis === 'live'
            ? <>From {s.basisN.toLocaleString('en-GB')} day-ahead hours scored live, each forecast logged before its outcome.</>
            : <>From the <Term id="backtest">backtest</Term>: {s.basisN.toLocaleString('en-GB')} hours of past weeks the model never saw, until enough live forecasts are scored.</>}
          {' '}Checked daily, sealed on Solana before the result.
        </p>
      )}
    </>
  )

  const experts = (
    <>
      <div className="score-grid" style={{ gridTemplateColumns: `repeat(${tiles.length}, 1fr)` }}>
        {tiles.map((t) => (
          <div key={t.label}>
            <div className="faint score-label">{t.label}{t.tag && <span className="tag" style={{ marginLeft: 6 }}>{t.tag}</span>}</div>
            <div className={`score-val num ${t.tone}`}>{t.value}</div>
            <div className="faint score-note">{t.note}</div>
          </div>
        ))}
      </div>
      <button type="button" className="score-more" onClick={() => setOpen(true)}>Backtest by zone ›</button>
    </>
  )

  return (
    <>
      <Explain
        className="score"
        question="Can we trust the forecast?"
        tag={source === 'fixture' ? 'Fixture' : source === 'cached' ? 'Last good' : s.basis === 'live' ? 'Live' : 'Backtest'}
        answer={answer}
        experts={experts}
      />
      <style>{`
        .score { width: 560px; }
        .ex-a .score-basis { font-size: 13px; font-weight: 400; color: var(--text-3); line-height: 1.45; }
        .score-grid { display: grid; gap: 18px; padding: 4px 0 10px; }
        .score-label { font-size: 13px; min-height: 32px; }
        .score-val { font-size: 40px; font-weight: 700; line-height: 1.05; margin: 6px 0; white-space: nowrap; color: var(--text); }
        .score-val.good { color: var(--down); }
        .score-val.bad { color: var(--up); }
        .score-val.warn { color: var(--hot); }
        .score-note { font-size: 13px; line-height: 1.35; }
        .score-more { all: unset; cursor: pointer; font-size: 13px; color: var(--accent); min-height: 32px; }
        .score-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        @media (max-width: 700px) { .score { width: 100%; } .score-grid { grid-template-columns: repeat(2, 1fr) !important; } .score-val { font-size: 30px; } }
      `}</style>
      {open && <Backtest rows={scores.backtest} source={source} onClose={() => setOpen(false)} />}
    </>
  )
}

export default { id: 'scoreboard', slot: 'bottomRight', order: 5, modes: ['overview'], Component: Scoreboard }
