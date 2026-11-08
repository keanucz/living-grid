import { api, useApi } from '../../api/client.js'
import { headline, significance, techniqueSummary } from './techniques.js'

const pct = (v) => `${(v * 100).toFixed(1)}%`
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

// Proof: every technique on the same walk-forward weeks, day-ahead price, with how often the real price landed in
// its likely range. All numbers come from /scores/techniques; nothing here is typed.
export default function Techniques() {
  const { data } = useApi(() => api.techniques(), [])
  const zones = useApi(() => api.zones(), [])
  const s = techniqueSummary(data)
  if (!s) return null
  const names = Object.fromEntries((zones.data?.zones ?? []).map((z) => [z.id, z.name]))
  const where = (codes) => list(codes.map((c) => names[c] ?? c))
  const { dmP, dmY } = s
  const bound = dmP && significance(dmP.max_p)
  return (
    <div className="tq" aria-label="Forecasting techniques compared">
      <h3>{headline(s)}</h3>
      <div className="tq-head faint"><span /><span>Average miss, per MWh</span><span>Range hit</span></div>
      {s.models.map((m) => (
        <div key={m.name} className={`tq-row ${m.ours ? 'ours' : ''}`}>
          <span className="tq-n">{m.title}</span>
          <div className="tq-bar"><i style={{ width: `${(m.mae / s.worst) * 100}%` }} /><b className="num">{m.mae.toFixed(1)}</b></div>
          <span className="tq-c num">{m.coverage_p10_p90 == null ? 'n/a' : pct(m.coverage_p10_p90)}</span>
        </div>
      ))}
      {dmP && dmP.better > 0 && (
        <p className="tq-dm">
          Better than persistence by a statistically significant margin in {dmP.better} of {dmP.zones} zones (Diebold-Mariano{bound ? `, p < ${bound}` : ''})
          {dmP.not_significant.length > 0 && <>; {where(dmP.not_significant)} {dmP.not_significant.length > 1 ? 'are ties' : 'is a tie'}</>}.
          {dmY && <> Against Yesterday, the strongest simple rival, it is significant in {dmY.better} of {dmY.zones}.</>}
        </p>
      )}
      <p className="tq-fn faint">
        Day-ahead price, {s.hours.toLocaleString('en-GB')} hours in {s.zones} zones, same weeks for every technique. Pooled across zones in £ and € per MWh. Range hit: how often the real price landed inside the likely range (aim 80%).
      </p>
      <style>{`
        .tq { margin: 12px 0 4px; padding-top: 10px; border-top: 1px solid var(--line); font-weight: 400; }
        .tq h3 { margin: 0 0 8px; font-size: 15px; line-height: 1.3; font-weight: 600; }
        .tq-head, .tq-row { display: grid; grid-template-columns: 104px 1fr 54px; gap: 8px; align-items: center; font-size: 12px; }
        .tq-head { font-size: 11px; padding-bottom: 2px; }
        .tq-row { padding: 2px 0; }
        .tq-n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); }
        .tq-row.ours .tq-n, .tq-row.ours .tq-c { color: var(--accent); font-weight: 600; }
        .tq-bar { position: relative; height: 18px; background: var(--card); border-radius: 4px; overflow: hidden; }
        .tq-bar i { position: absolute; inset: 0 auto 0 0; background: var(--hydro); opacity: .55; border-radius: 4px; }
        .tq-row.ours .tq-bar i { background: var(--accent); opacity: 1; }
        .tq-row.ours .tq-bar b { color: #0a0a0a; font-weight: 700; }
        .tq-bar b { position: relative; padding-left: 6px; line-height: 18px; font-size: 12px; color: var(--text); }
        .tq-c { text-align: right; color: var(--text-2); }
        .tq-dm { margin: 10px 0 0; font-size: 13px; line-height: 1.45; color: var(--text); }
        .tq-fn { margin: 6px 0 0; font-size: 11px; line-height: 1.4; }
      `}</style>
    </div>
  )
}
