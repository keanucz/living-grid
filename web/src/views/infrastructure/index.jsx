import { useState } from 'react'
import { Icon } from '../../shell/icons.jsx'
import { actions, getState } from '../../store/store.js'
import { gaugeColor } from '../../layers/boundaries/index.js'
import { useInfra, utilisation, whatIf } from '../../layers/boundaries/data.js'

// Where the grid is full: each boundary and interconnector with a flow-against-capacity gauge, what it cost over the
// window, a story card on tap, and "build a power line": add capacity to a boundary and see the cost and wind that
// would no longer be wasted. Every number sits next to its source; the figures come from GET /infrastructure (#184)
// and are badged SAMPLE until that endpoint is live.
const money = (v) => (Math.abs(v) >= 1e6 ? `£${(v / 1e6).toFixed(1)}m` : `£${Math.round(v / 1e3)}k`)
const mw = (v) => `${Math.round(v).toLocaleString('en-GB')} MW`
const gwh = (v) => `${(v / 1000).toFixed(1)} GWh`
const pct = (v) => `${Math.round(v * 100)}%`

function Source({ s }) {
  if (!s) return null
  return <span className="inf-src">Source: {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}{s.date ? `, ${s.date}` : ''}</span>
}

function Gauge({ row, selected, onPick, days }) {
  const u = utilisation(row)
  const dir = row.flow_mw == null ? '' : row.flow_mw >= 0 ? `${row.from} to ${row.to}` : `${row.to} to ${row.from}`
  return (
    <button className={`inf-card ${selected ? 'on' : ''}`} onClick={onPick} aria-pressed={selected}>
      <div className="inf-top">
        <b>{row.name}</b>
        <span className="num" style={{ color: `rgb(${gaugeColor(u).slice(0, 3).join(',')})` }}>{pct(u)} full</span>
      </div>
      <div className="inf-bar" role="img" aria-label={`${pct(u)} of capacity in use`}>
        <i style={{ width: `${Math.min(100, u * 100)}%`, background: `rgb(${gaugeColor(u).slice(0, 3).join(',')})` }} />
      </div>
      <div className="inf-meta">
        <span>{mw(Math.abs(row.flow_mw ?? 0))} of {mw(row.capacity_mw)}{dir && ` · ${dir}`}</span>
        {row.cost_gbp_window != null && <span>{money(row.cost_gbp_window)} in {days} days</span>}
      </div>
      <Source s={row.source} />
    </button>
  )
}

function Story({ row, days }) {
  const u = utilisation(row)
  return (
    <section className="inf-panel">
      <div className="inf-h">{row.name}</div>
      <p>
        {row.name} was {pct(u)} full on average{row.flow_mw != null && row.capacity_mw != null ? `: ${mw(Math.abs(row.flow_mw))} against ${row.kind === 'boundary' ? 'a limit' : 'a capacity'} of ${mw(row.capacity_mw)}` : ''}.
        {row.over_share != null && ` NESO's day-ahead flow forecast was above the limit in ${pct(row.over_share)} of hours${row.overload_mwh ? `, ${gwh(row.overload_mwh)} more than it could carry` : ''}.`}
        {row.cost_gbp_window != null && ` Over the last ${days} days, managing the limit cost ${money(row.cost_gbp_window)}.`}
        {row.wind_curtailed_mwh_window != null && ` About ${gwh(row.wind_curtailed_mwh_window)} of wind was paid to switch off in Scotland over ${days} days (estimate from accepted bids, an upper bound).`}
      </p>
      <Source s={row.source} />
    </section>
  )
}

function Build({ row, days }) {
  const max = whatIf(row, 0)?.maxMw ?? 0
  const [add, setAdd] = useState(Math.min(2000, max))
  const r = whatIf(row, add)
  if (!r) return <section className="inf-panel"><div className="inf-h">Build a power line</div><p className="inf-muted">No counterfactual is published for {row.name} yet.</p></section>
  return (
    <section className="inf-panel">
      <div className="inf-h">Build a power line across {row.name}</div>
      <label className="inf-slider">
        <span>Add capacity: <b className="num">+{mw(r.addMw)}</b></span>
        <input type="range" min={0} max={max} step={max >= 1000 ? 250 : 50} value={r.addMw} onChange={(e) => setAdd(Number(e.target.value))} aria-label="Added capacity in megawatts" />
      </label>
      <div className="inf-result">
        <div><span>Cost avoided</span><b className="num yes">{money(r.costSaved)}</b>{row.cf?.cost_total_gbp != null && <small>over {row.cf.cost_days} days with NESO cost data, out of {money(row.cf.cost_total_gbp)} of GB thermal constraint costs</small>}</div>
        <div><span>Wind no longer wasted</span><b className="num yes">{gwh(r.windSaved)}</b>{row.cf?.wind_total_mwh != null && <small>out of {gwh(row.cf.wind_total_mwh)} switched off in Scotland in {days} days</small>}</div>
      </div>
      <p className="inf-muted">A counterfactual on the same {days} days, not a forecast: it assumes the extra capacity had been in place and everything else unchanged, so treat both figures as upper bounds (other Scottish boundaries would still bind). Values between the published points are interpolated; nothing beyond +{mw(max)} is shown.</p>
      <Source s={row.source} />
    </section>
  )
}

function Infrastructure() {
  const { data, source } = useInfra()
  const rows = [...(data.boundaries ?? []).map((b) => ({ ...b, kind: 'boundary' })), ...(data.interconnectors ?? []).map((l) => ({ ...l, kind: 'link' }))]
  const [pick, setPick] = useState(rows[0]?.id)
  const days = data.window_days ?? 7
  const sel = rows.find((r) => r.id === pick) ?? rows[0]
  const showOnMap = () => {
    if (!getState().layers.boundaries) actions.toggleLayer('boundaries')
    location.hash = '#/'
  }
  const sorted = [...rows].sort((a, b) => utilisation(b) - utilisation(a))

  return (
    <div className="inf">
      <header className="inf-head">
        <a href="#/" className="inf-back" aria-label="Back to the map"><Icon name="back" /></a>
        <div style={{ flex: 1 }}>
          <div className="inf-kicker">Infrastructure</div>
          <h1>Where the grid is full</h1>
          <p className="inf-muted">Britain has one wholesale price, but the cables between Scotland and England and to Europe fill up. When they do, wind is paid to switch off and the bill is paid by everyone.</p>
        </div>
        {source === 'sample' && <span className="inf-badge" title="The live figures are not available yet">SAMPLE</span>}
        <button className="inf-map" onClick={showOnMap}><Icon name="globe" size={16} /> Show on the map</button>
      </header>

      <div className="inf-grid">
        {sorted.map((r) => <Gauge key={r.id} row={r} days={days} selected={sel?.id === r.id} onPick={() => setPick(r.id)} />)}
      </div>

      {sel && <Story row={sel} days={days} />}
      {sel?.kind === 'boundary' && <Build row={sel} days={days} />}

      {(data.planned ?? []).length > 0 && (
        <section className="inf-panel">
          <div className="inf-h">Planned links</div>
          {data.planned.map((p) => (
            <div key={p.id} className="inf-plan">
              <b>{p.name}</b>
              <span>{mw(p.capacity_mw)}{p.expected_year ? ` · expected ${p.expected_year}` : ''}{p.status ? ` · ${p.status}` : ''}</span>
              <Source s={p.source} />
            </div>
          ))}
        </section>
      )}
      {(data.notes ?? []).map((n) => <p key={n} className="inf-muted">{n}</p>)}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
body { overflow: auto; }
.inf { max-width: 980px; margin: 0 auto; padding: 20px 16px 48px; }
.inf-head { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 16px; }
.inf-back { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--card); color: var(--text); flex: none; }
.inf-kicker { font-size: 12px; color: var(--text-3); }
.inf h1 { font-size: 24px; margin: 2px 0 4px; letter-spacing: -0.02em; }
.inf-muted { font-size: 13px; color: var(--text-2); line-height: 1.5; margin: 4px 0; }
.inf-badge { padding: 4px 10px; border-radius: 999px; background: var(--hot-dim); color: var(--hot); font-size: 12px; font-weight: 700; letter-spacing: .06em; }
.inf-map { display: inline-flex; gap: 6px; align-items: center; height: 40px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--card); color: var(--text); font: inherit; }
.inf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin-bottom: 14px; }
.inf-card { text-align: left; background: var(--panel-solid); border: 1px solid var(--line); border-radius: 18px; padding: 14px; color: var(--text); font: inherit; display: flex; flex-direction: column; gap: 8px; }
.inf-card.on { border-color: var(--accent); }
.inf-top { display: flex; justify-content: space-between; gap: 8px; }
.inf-bar { height: 10px; border-radius: 5px; background: var(--card); overflow: hidden; }
.inf-bar i { display: block; height: 100%; border-radius: 5px; }
.inf-meta { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--text-2); }
.inf-src { font-size: 11px; color: var(--text-3); }
.inf-src a { color: inherit; }
.inf-panel { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 16px; margin-bottom: 12px; }
.inf-panel p { margin: 6px 0; line-height: 1.5; }
.inf-h { font-weight: 600; margin-bottom: 6px; }
.inf-slider { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; font-size: 14px; }
.inf-slider input { width: 100%; }
.inf-result { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 10px 0; }
.inf-result > div { background: var(--card); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 2px; }
.inf-result span { font-size: 12px; color: var(--text-2); }
.inf-result b { font-size: 24px; }
.inf-result small { font-size: 11px; color: var(--text-3); }
.inf-plan { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; border-top: 1px solid var(--line); font-size: 14px; }
.inf-plan:first-of-type { border-top: 0; }
`

export default { path: '/infrastructure', title: 'Infrastructure', Component: Infrastructure }
