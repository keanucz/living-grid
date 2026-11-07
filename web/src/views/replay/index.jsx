import { useEffect, useMemo, useState } from 'react'
import { area, line, curveMonotoneX } from 'd3-shape'
import { scaleLinear, scaleUtc } from 'd3-scale'
import { Icon } from '../../shell/icons.jsx'
import { fmt } from '../../styles/tokens.js'

const EVENT = '2026-10-26'
const W = 900
const H = 340
const P = { l: 52, r: 16, t: 16, b: 30 }
const TARGET_LABEL = { gb_system_price: 'GB system price', price_da: 'Day-ahead price' }
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

function Replay() {
  const [d, setD] = useState(undefined)
  const [key, setKey] = useState('GB|price_da')
  const [i, setI] = useState(23)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 20000)
    fetch(`/api/replay?event=${EVENT}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(setD)
      .finally(() => clearTimeout(t))
  }, [])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setI((v) => (v >= 23 ? (setPlaying(false), 23) : v + 1)), 450)
    return () => clearInterval(id)
  }, [playing])

  const s = d?.series?.find((x) => `${x.zone}|${x.target}` === key) ?? d?.series?.[0]
  const pts = s?.points ?? []
  const cur = pts[Math.min(i, pts.length - 1)]
  const shown = pts.slice(0, i + 1)
  const unit = s?.unit?.startsWith('GBP') ? '£' : '€'

  const { x, y } = useMemo(() => {
    const vals = pts.flatMap((p) => [p.actual, p.p10, p.p90]).filter((v) => v != null)
    return {
      x: scaleUtc().domain([Date.parse(pts[0]?.ts ?? 0), Date.parse(pts.at(-1)?.ts ?? 1)]).range([P.l, W - P.r]),
      y: scaleLinear().domain(vals.length ? [Math.min(0, ...vals), Math.max(...vals) * 1.05] : [0, 100]).nice(5).range([H - P.b, P.t]),
    }
  }, [pts])
  const tx = (p) => x(Date.parse(p.ts))
  const band = area().x(tx).y0((p) => y(p.p10)).y1((p) => y(p.p90)).curve(curveMonotoneX)(pts)
  const med = line().x(tx).y((p) => y(p.p50)).curve(curveMonotoneX)(pts)
  const act = line().x(tx).y((p) => y(p.actual)).curve(curveMonotoneX)(shown.filter((p) => p.actual != null))
  const inBand = shown.filter((p) => p.actual != null && p.actual >= p.p10 && p.actual <= p.p90).length
  const lastExpl = [...shown].reverse().find((p) => p.explanation)?.explanation

  return (
    <div className="rp">
      <header className="rp-top">
        <a href="#/" className="rp-back" aria-label="Back to the map"><Icon name="back" /></a>
        <div>
          <div className="rp-kicker">Replay · out-of-sample</div>
          <h1>{d?.title ?? 'The 26 October storm'}</h1>
          <p>Would we have seen it coming? Forecasts from a model trained only on data before {d?.trained_before ?? EVENT}, made 12 hours ahead.</p>
        </div>
      </header>

      {d === undefined && <p className="rp-muted">Loading the replay…</p>}
      {d === null && <p className="rp-muted">The replay isn’t available right now.</p>}

      {s && (
        <>
          <div className="rp-controls">
            <div className="rp-tabs">
              {d.series.map((x) => {
                const k = `${x.zone}|${x.target}`
                return <button key={k} className={k === `${s.zone}|${s.target}` ? 'on' : ''} onClick={() => setKey(k)}>{x.zone} <span>{TARGET_LABEL[x.target] ?? x.target}</span></button>
              })}
            </div>
            <button className="rp-play" onClick={() => (i >= 23 && setI(0), setPlaying((p) => !p))}>
              {!playing && <Icon name="play" size={14} fill="currentColor" />} {playing ? 'Pause' : i >= 23 ? 'Play the day' : 'Resume'}
            </button>
          </div>

          <div className="rp-grid">
            <section className="rp-chart">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Actual price against forecast band through the day">
                {y.ticks(5).map((v) => (
                  <g key={v}>
                    <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                    <text x={P.l - 8} y={y(v) + 4} textAnchor="end" className="rp-tick">{unit}{v}</text>
                  </g>
                ))}
                {pts.filter((_, k) => k % 3 === 0).map((p) => <text key={p.ts} x={tx(p)} y={H - 8} textAnchor="middle" className="rp-tick">{hhmm(p.ts)}</text>)}
                <path d={band} fill="var(--accent)" opacity="0.14" />
                <path d={med} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" />
                {act && <path d={act} fill="none" stroke="var(--text)" strokeWidth="2.6" />}
                {cur && <line x1={tx(cur)} x2={tx(cur)} y1={P.t} y2={H - P.b} stroke="var(--hot)" strokeWidth="1.5" />}
                {cur?.actual != null && <circle cx={tx(cur)} cy={y(cur.actual)} r="5" fill="var(--text)" stroke="var(--bg)" strokeWidth="2" />}
              </svg>
              <input type="range" min={0} max={pts.length - 1} value={i} onChange={(e) => (setPlaying(false), setI(+e.target.value))} aria-label="Hour of the day" />
              <div className="rp-legend"><span><i style={{ background: 'var(--text)' }} />What happened</span><span><i style={{ background: 'var(--accent)' }} />Forecast P50, P10–P90 band</span></div>
            </section>

            <aside className="rp-side">
              <div className="rp-stat"><span>Hour</span><b className="num">{cur ? `${hhmm(cur.ts)} UTC` : '—'}</b></div>
              <div className="rp-stat"><span>Actual vs forecast</span><b className="num">{cur?.actual != null ? `${unit}${cur.actual.toFixed(0)}` : '—'} <small>vs {unit}{cur?.p50?.toFixed(0)}</small></b></div>
              <div className="rp-stat"><span>Inside the band so far</span><b className="num">{inBand} of {shown.filter((p) => p.actual != null).length}</b></div>
              <div className="rp-stat"><span>GB constraint bill that day</span><b className="num">{d.constraint_cost_gbp ? fmt.money(d.constraint_cost_gbp) : '—'}</b></div>
              {lastExpl && <div className="rp-why"><span>Why</span><p>{typeof lastExpl === 'string' ? lastExpl : lastExpl.sentence}</p></div>}
              <p className="rp-sum">{d.summary}</p>
            </aside>
          </div>
        </>
      )}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
body { overflow: auto; }
.rp { max-width: 1280px; margin: 0 auto; padding: 28px 24px 40px; }
.rp-top { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 20px; }
.rp-back { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--card); color: var(--text); flex: none; }
.rp-kicker { font-size: 12px; color: var(--accent); font-weight: 600; letter-spacing: .02em; }
.rp h1 { margin: 4px 0 6px; font-size: 30px; letter-spacing: -0.02em; }
.rp-top p { margin: 0; color: var(--text-2); max-width: 720px; }
.rp-controls { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 14px; }
.rp-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.rp-tabs button { padding: 8px 12px; border-radius: 999px; background: var(--card); color: var(--text-2); font-weight: 600; font-size: 13px; }
.rp-tabs button span { font-weight: 400; color: var(--text-3); margin-left: 4px; }
.rp-tabs button.on { background: var(--accent-dim); color: var(--accent); }
.rp-play { height: 42px; padding: 0 18px; border-radius: 999px; background: var(--hot); color: #1b0d00; font-weight: 700; display: inline-flex; gap: 8px; align-items: center; }
.rp-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; }
@media (max-width: 900px) { .rp-grid { grid-template-columns: 1fr; } }
.rp-chart, .rp-side { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 16px; }
.rp-chart input { width: 100%; margin-top: 8px; accent-color: var(--hot); }
.rp-tick { font-size: 12px; fill: var(--text-3); font-variant-numeric: tabular-nums; }
.rp-legend { display: flex; gap: 16px; font-size: 12px; color: var(--text-2); margin-top: 6px; }
.rp-legend i { display: inline-block; width: 12px; height: 3px; margin-right: 6px; vertical-align: middle; }
.rp-side { display: flex; flex-direction: column; gap: 14px; }
.rp-stat span, .rp-why span { font-size: 12px; color: var(--text-3); }
.rp-stat b { display: block; font-size: 24px; font-weight: 600; margin-top: 2px; }
.rp-stat small { font-size: 13px; color: var(--accent); font-weight: 500; }
.rp-why p { margin: 4px 0 0; line-height: 1.45; }
.rp-sum { font-size: 12px; color: var(--text-3); line-height: 1.5; margin: 0; }
.rp-muted { color: var(--text-2); }
`

export default { path: '/replay', title: 'Replay: 26 October storm', Component: Replay }
