import { useState } from 'react'
import Backtest from '../backtest/Backtest.jsx'
import { pct, scoreboard } from './summary.js'
import { useScores } from './useScores.js'

const sharePct = (v) => `${(v * 100).toFixed(0)}%`

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

  return (
    <>
      <section className="panel score fade-in" onClick={() => setOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}>
        <div className="panel-head">
          <span>
            How right are we? <span className="tag" style={{ marginLeft: 8 }}>{source === 'live' ? 'Live' : source === 'cached' ? 'Last good' : 'Fixture'}</span>
          </span>
          <span className="muted score-hint">Tap for backtest by zone ›</span>
        </div>
        <div className="score-grid" style={{ gridTemplateColumns: `repeat(${tiles.length}, 1fr)` }}>
          {tiles.map((t) => (
            <div key={t.label}>
              <div className="faint score-label">{t.label}{t.tag && <span className="tag" style={{ marginLeft: 6 }}>{t.tag}</span>}</div>
              <div className={`score-val num ${t.tone}`}>{t.value}</div>
              <div className="faint score-note">{t.note}</div>
            </div>
          ))}
        </div>
        <style>{`
          .score { width: 560px; cursor: pointer; }
          .score:hover { border-color: var(--line-2); }
          .score-hint { font-size: 13px; }
          .score-grid { display: grid; gap: 18px; padding: 4px 18px 18px; }
          .score-label { font-size: 13px; min-height: 32px; }
          .score-val { font-size: 46px; font-weight: 700; line-height: 1.05; margin: 6px 0; white-space: nowrap; }
          .score-val.good { color: var(--down); }
          .score-val.bad { color: var(--up); }
          .score-val.warn { color: var(--hot); }
          .score-note { font-size: 13px; line-height: 1.35; }
        `}</style>
      </section>
      {open && <Backtest rows={scores.backtest} source={source} onClose={() => setOpen(false)} />}
    </>
  )
}

export default { id: 'scoreboard', slot: 'bottomRight', order: 5, modes: ['overview'], Component: Scoreboard }
