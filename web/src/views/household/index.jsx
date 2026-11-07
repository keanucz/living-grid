import { useEffect, useState } from 'react'
import { api } from '../../api/client.js'
import { Icon } from '../../shell/icons.jsx'
import Savings from './Savings.jsx'

const TZ = 'Europe/London'
const t = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ })
const ICON = { ev: 'plug', dishwasher: 'drop', washing: 'drop', laundry: 'drop' }

function load(region) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  return fetch(`/api/household?region=${encodeURIComponent(region)}`, { signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer))
}

function Strip({ prices, windows }) {
  if (!prices?.length) return null
  const max = Math.max(...prices.map((p) => p.p90 ?? p.p_kwh), 1)
  const inWin = (ts) => windows.some((w) => ts >= w.start && ts < w.end)
  return (
    <div className="hh-strip" role="img" aria-label="Price per kWh over the next 48 hours">
      {prices.map((p) => (
        <div key={p.ts} className={`hh-bar ${p.kind} ${inWin(p.ts) ? 'win' : ''}`} title={`${day(p.ts)} ${t(p.ts)}: ${p.p_kwh.toFixed(1)}p/kWh (${p.kind})`}>
          {p.p10 != null && <i className="band" style={{ bottom: `${(p.p10 / max) * 100}%`, height: `${((p.p90 - p.p10) / max) * 100}%` }} />}
          <i className="v" style={{ height: `${Math.max(2, (p.p_kwh / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  )
}

function Household() {
  const [regions, setRegions] = useState([])
  const [region, setRegion] = useState(() => {
    try {
      return localStorage.getItem('lg-region') || 'C'
    } catch {
      return 'C'
    }
  })
  const [d, setD] = useState(undefined)
  useEffect(() => {
    api.zones().then((r) => setRegions(r.data?.gb_regions ?? []))
  }, [])
  useEffect(() => {
    setD(undefined)
    try {
      localStorage.setItem('lg-region', region)
    } catch {
      /* private mode */
    }
    load(region).then(setD)
  }, [region])

  const first = d?.prices?.[0]?.ts
  const lastPublished = d?.prices?.filter((p) => p.kind !== 'forecast').at(-1)?.ts

  return (
    <div className="hh">
      <header className="hh-top">
        <a href="#/" className="hh-logo" aria-label="Back to the map"><Icon name="bolt" size={18} stroke={2.2} /></a>
        <div>
          <div className="hh-kicker">The Living Grid</div>
          <h1>Cheapest power tonight</h1>
        </div>
      </header>

      <label className="hh-region">
        <span>Your region</span>
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          {(regions.length ? regions : [{ region, name: region }]).map((r) => (
            <option key={r.region} value={r.region}>{r.name}</option>
          ))}
        </select>
      </label>

      {d === undefined && <p className="hh-muted">Working out the cheapest hours…</p>}
      {d === null && <p className="hh-muted">Couldn’t reach the forecast right now. Try again in a minute.</p>}

      <Savings region={region} />

      {d?.windows?.map((w) => (
        <article key={w.task} className="hh-card">
          <div className="hh-ic"><Icon name={ICON[w.task] ?? 'bolt'} size={20} /></div>
          <div className="hh-body">
            <div className="hh-label">{w.label}</div>
            <div className="hh-when">{day(w.start)} {t(w.start)}–{t(w.end)}</div>
            <div className="hh-meta">{w.avg_p_kwh.toFixed(1)}p/kWh average <span className={`hh-kind ${w.kind}`}>{w.kind === 'forecast' ? 'Forecast' : 'Published'}</span></div>
          </div>
          <div className="hh-save">
            <div className="hh-save-n">£{w.saving_gbp.p50.toFixed(2)}</div>
            <div className="hh-save-r">£{w.saving_gbp.p10.toFixed(2)}–£{w.saving_gbp.p90.toFixed(2)}</div>
            <div className="hh-save-l">saved vs now</div>
          </div>
        </article>
      ))}

      {d?.prices && (
        <section className="hh-chart">
          <div className="hh-chart-head"><span>Next 48 hours</span><span className="hh-muted">p/kWh</span></div>
          <Strip prices={d.prices} windows={d.windows ?? []} />
          <div className="hh-axis"><span>{first && `${day(first)} ${t(first)}`}</span><span>{lastPublished ? `Published to ${day(lastPublished)} ${t(lastPublished)}` : 'All forecast'}</span></div>
          <div className="hh-legend"><span><i className="pub" />Published</span><span><i className="fc" />Forecast</span><span><i className="win" />Best windows</span></div>
        </section>
      )}
      {d?.note && <p className="hh-note">{d.note}</p>}

      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
body { overflow: auto; }
.hh { max-width: 520px; margin: 0 auto; padding: 20px 16px 40px; min-height: 100%; }
.hh-top { display: flex; gap: 12px; align-items: center; margin-bottom: 18px; }
.hh-logo { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); flex: none; }
.hh-kicker { font-size: 12px; color: var(--text-3); }
.hh h1 { font-size: 22px; margin: 2px 0 0; letter-spacing: -0.02em; }
.hh-region { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; font-size: 12px; color: var(--text-2); }
.hh-region select { height: 46px; border-radius: 14px; background: var(--card); border: 1px solid var(--line-2); color: var(--text); padding: 0 12px; font: inherit; font-size: 15px; }
.hh-card { display: flex; gap: 12px; align-items: center; background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px; margin-bottom: 10px; }
.hh-ic { width: 44px; height: 44px; border-radius: 50%; background: var(--accent-dim); color: var(--accent); display: grid; place-items: center; flex: none; }
.hh-body { flex: 1; min-width: 0; }
.hh-label { font-weight: 600; }
.hh-when { font-size: 20px; font-weight: 600; margin: 2px 0; font-variant-numeric: tabular-nums; }
.hh-meta { font-size: 12px; color: var(--text-2); }
.hh-kind { margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-size: 11px; background: var(--card-2); }
.hh-kind.forecast { color: var(--accent); background: var(--accent-dim); }
.hh-save { text-align: right; }
.hh-save-n { font-size: 22px; font-weight: 700; color: var(--accent); }
.hh-save-r, .hh-save-l { font-size: 11px; color: var(--text-2); }
.hh-chart { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px; margin-top: 6px; }
.hh-chart-head { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 10px; }
.hh-strip { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
.hh-bar { flex: 1; height: 100%; position: relative; }
.hh-bar i { position: absolute; left: 0; right: 0; bottom: 0; border-radius: 2px; }
.hh-bar .v { background: var(--text-3); }
.hh-bar.forecast .v { background: rgba(197,240,107,.45); }
.hh-bar .band { background: rgba(197,240,107,.14); }
.hh-bar.win .v { background: var(--accent); }
.hh-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-3); margin-top: 6px; }
.hh-legend { display: flex; gap: 14px; font-size: 11px; color: var(--text-2); margin-top: 8px; }
.hh-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.hh-legend .pub { background: var(--text-3); } .hh-legend .fc { background: rgba(197,240,107,.45); } .hh-legend .win { background: var(--accent); }
.hh-note { font-size: 12px; color: var(--text-3); line-height: 1.5; margin-top: 14px; }
.hh-muted { color: var(--text-2); }
`

export default { path: '/household', title: 'Cheapest power tonight', Component: Household }
