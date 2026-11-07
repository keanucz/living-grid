import { useMemo, useState } from 'react'
import { backtestSummary, backtestTable, pct } from '../scoreboard/summary.js'

const TARGETS = [
  ['price_da', 'Day-ahead price'],
  ['load', 'Load'],
  ['wind', 'Wind'],
]
const UNIT = { price_da: '€/MWh', load: 'MW', wind: 'MW' }

const num = (v, t) => (v == null ? '—' : v >= 100 ? v.toFixed(0) : v.toFixed(1))

function Verdict({ r }) {
  if (!r.losses.length) return <span className="bt-v win">Beats both</span>
  return <span className="bt-v loss">Loses to {r.losses.join(' and ')}</span>
}

export default function Backtest({ rows, source, onClose }) {
  const [target, setTarget] = useState('price_da')
  const table = useMemo(() => backtestTable(rows), [rows])
  const shown = table.filter((r) => r.target === target)
  const all = backtestSummary(table)
  const here = backtestSummary(shown)
  return (
    <div className="bt-scrim" onClick={onClose}>
      <section className="panel bt" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span>
            Walk-forward backtest by zone <span className="tag" style={{ marginLeft: 8 }}>{source === 'live' ? 'Live API' : 'Fixture'}</span>
            <span className="tag hot" style={{ marginLeft: 8 }}>Out of sample</span>
          </span>
          <button className="square-btn" onClick={onClose} title="Close">✕</button>
        </div>
        <p className="bt-lede">
          Each forecast is scored on weeks the model never saw. <b>{all.wins} of {all.total}</b> zone-and-target pairs beat both baselines;{' '}
          <b className={all.lossP || all.lossY ? 'bt-bad' : ''}>{all.lossP} lose to persistence and {all.lossY} to yesterday</b>.
        </p>
        <div className="bt-tabs">
          {TARGETS.map(([k, label]) => (
            <button key={k} className={target === k ? 'on' : ''} onClick={() => setTarget(k)}>{label}</button>
          ))}
        </div>
        <table className="bt-table num">
          <thead>
            <tr>
              <th>Zone</th>
              <th>Model error</th>
              <th>Persistence</th>
              <th>Yesterday</th>
              <th>vs persistence</th>
              <th>vs yesterday</th>
              <th>Inside P10–P90</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.zone} className={r.losses.length ? 'loss' : ''}>
                <td className="z">{r.zone}</td>
                <td>{num(r.model, r.target)}</td>
                <td>{num(r.persistence, r.target)}</td>
                <td>{num(r.yesterday, r.target)}</td>
                <td className={r.vsPersistence > 0 ? 'bad' : 'good'}>{pct(r.vsPersistence)}</td>
                <td className={r.vsYesterday > 0 ? 'bad' : 'good'}>{r.vsYesterday == null ? '—' : pct(r.vsYesterday)}</td>
                <td className={r.coverage != null && r.coverage < 0.75 ? 'warn' : ''}>{r.coverage == null ? '—' : `${(r.coverage * 100).toFixed(0)}%`}</td>
                <td><Verdict r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="bt-foot">
          Error is mean absolute error in {UNIT[target]}; negative percentages mean a smaller error than the baseline, positive means we lose.
          The P10–P90 band is meant to hold the outcome 80% of the time{here.coverage != null ? `; here it holds ${(here.coverage * 100).toFixed(0)}%` : ''}.
          Backtest uses a fixed 12-hour lead.
        </p>
      </section>
      <style>{`
        .bt-scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(8,8,8,.72); backdrop-filter: blur(4px); }
        .bt { width: min(1180px, 94vw); max-height: 92vh; overflow: auto; background: var(--panel-solid); padding-bottom: 18px; }
        .bt .panel-head { font-size: 22px; }
        .bt-lede { margin: 0; padding: 0 18px 12px; font-size: 20px; color: var(--text-2); line-height: 1.4; }
        .bt-lede b { color: var(--text); }
        .bt-lede .bt-bad { color: var(--up); }
        .bt-tabs { display: flex; gap: 8px; padding: 0 18px 14px; }
        .bt-tabs button { padding: 10px 20px; border-radius: 999px; font-size: 18px; font-weight: 500; color: var(--text-2); background: var(--card); }
        .bt-tabs button.on { background: var(--accent-dim); color: var(--accent); }
        .bt-table { width: calc(100% - 36px); margin: 0 18px; border-collapse: collapse; font-size: 22px; }
        .bt-table th { text-align: right; font-size: 14px; font-weight: 500; color: var(--text-3); padding: 8px 12px; }
        .bt-table td { text-align: right; padding: 12px; border-top: 1px solid var(--line); }
        .bt-table th:first-child, .bt-table td:first-child, .bt-table th:last-child, .bt-table td:last-child { text-align: left; }
        .bt-table td.z { font-weight: 700; font-size: 24px; }
        .bt-table tr.loss { background: rgba(240,121,107,.10); }
        .bt-table .good { color: var(--down); font-weight: 600; }
        .bt-table .bad { color: var(--up); font-weight: 700; }
        .bt-table .warn { color: var(--hot); }
        .bt-v { font-size: 16px; font-weight: 600; padding: 5px 12px; border-radius: 999px; white-space: nowrap; }
        .bt-v.win { background: rgba(143,209,106,.15); color: var(--down); }
        .bt-v.loss { background: rgba(240,121,107,.2); color: var(--up); }
        .bt-foot { margin: 14px 18px 0; font-size: 14px; color: var(--text-3); line-height: 1.5; }
      `}</style>
    </div>
  )
}
