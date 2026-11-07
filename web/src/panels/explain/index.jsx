import { useEffect, useState } from 'react'
import { api } from '../../api/client.js'
import sample from './sample.json'

const LABEL = { wind: 'Wind', solar: 'Solar', demand: 'Demand', gas: 'Gas', carbon: 'Carbon', imports: 'Imports', time_of_day: 'Time of day' }
const sym = (unit) => (unit?.startsWith('GBP') ? '£' : '€')
const signed = (v, s) => `${v >= 0 ? '+' : '−'}${s}${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}`

// Why the model's price forecast for the selected zone and hour is what it is (GET /explain).
// If the API is unreachable the bundled sample is shown and labelled as such.
function Explain({ ctx }) {
  const zone = ctx.ui.selectedZone
  const at = ctx.ui.at
  const [res, setRes] = useState(null)
  useEffect(() => {
    let live = true
    setRes(null)
    api.explain(zone, at ?? undefined)
      .then((r) => live && setRes({ body: r.data, sample: false }))
      .catch(() => live && setRes({ body: sample, sample: true }))
    return () => { live = false }
  }, [zone, at])
  if (!res) return null

  const { body } = res
  const s = sym(body.unit)
  const rows = [...body.contributions].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)))
  const name = ctx.zoneById[body.zone]?.name ?? body.zone
  const shown = ctx.stateByZone[body.zone]
  const differs = shown?.price != null && Math.abs(shown.price - body.prediction) >= 1
  const when = new Date(body.ts).toISOString().slice(5, 16).replace('T', ' ')

  return (
    <section className="panel xplain fade-in">
      <div className="panel-head">
        <span>Why this price <span className="faint" style={{ fontWeight: 500 }}>· {name}</span></span>
        <span className="tag">{res.sample ? 'Sample' : 'Model explanation'}</span>
      </div>
      <p className="xsent">{body.sentence}</p>
      <div className="xbars" role="img" aria-label="Contribution of each driver to the price change">
        {rows.map((r) => (
          <div key={r.group} className="xrow">
            <span className="xname">{LABEL[r.group] ?? r.group}</span>
            <span className="xtrack">
              <span className={`xbar ${r.value >= 0 ? 'up' : 'down'}`} style={{ width: `${(Math.abs(r.value) / max) * 50}%`, [r.value >= 0 ? 'left' : 'right']: '50%' }} />
            </span>
            <span className="xval num">{signed(r.value, s)}</span>
          </div>
        ))}
      </div>
      <div className="faint xnote">
        {when} UTC · forecast {s}{body.prediction.toFixed(1)}/MWh, {signed(body.delta, s)} against the reference.{differs ? ` The map shows ${s}${Math.round(shown.price)} for this hour (published result); the bars explain the forecast.` : ''}
        {res.sample ? ' Sample figures shown because the API could not be reached.' : ' Attribution of the model’s own number, not a proven cause.'}
      </div>
      <style>{`
        .xplain { padding-bottom: 14px; }
        .xsent { margin: 0 18px 10px; line-height: 1.45; }
        .xbars { padding: 0 18px; display: flex; flex-direction: column; gap: 5px; }
        .xrow { display: grid; grid-template-columns: 74px 1fr 46px; align-items: center; gap: 8px; font-size: 12px; }
        .xname { color: var(--text-2); }
        .xtrack { position: relative; height: 8px; background: var(--card); border-radius: 4px; }
        .xtrack::after { content: ''; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: var(--line); }
        .xbar { position: absolute; top: 0; bottom: 0; border-radius: 4px; }
        .xbar.up { background: var(--hot); }
        .xbar.down { background: var(--accent); }
        .xval { text-align: right; }
        .xnote { font-size: 11px; padding: 10px 18px 0; line-height: 1.4; }
      `}</style>
    </section>
  )
}

export default { id: 'explain', slot: 'left', order: 30, modes: ['overview'], Component: Explain }
