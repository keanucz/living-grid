import { useEffect, useState } from 'react'
import { area, line, curveMonotoneX } from 'd3-shape'
import { scaleLinear, scaleUtc } from 'd3-scale'
import { zoneSeries } from './series.js'
import Term from '../../ui/Term.jsx'

const W = 300
const H = 150
const PAD = { l: 34, r: 8, t: 10, b: 20 }

function ZoneChart({ ctx }) {
  const zone = ctx.ui.selectedZone
  const z = ctx.zoneById[zone]
  const [s, setS] = useState(null)
  useEffect(() => {
    let live = true
    setS(null)
    zoneSeries(zone).then((d) => live && setS(d ?? { actual: [], forecast: [] }))
    const id = setInterval(() => zoneSeries(zone).then((d) => live && d && setS(d)), 60_000)
    return () => ((live = false), clearInterval(id))
  }, [zone])
  if (!z) return null

  const now = Date.now()
  const x = scaleUtc().domain([now - 24 * 3600e3, now + 24 * 3600e3]).range([PAD.l, W - PAD.r])
  const inView = (r) => {
    const t = Date.parse(r.ts)
    return t >= x.domain()[0] && t <= x.domain()[1]
  }
  const act = (s?.actual ?? []).filter(inView)
  const fc = (s?.forecast ?? []).filter(inView)
  const vals = [...act.map((r) => r.value), ...fc.flatMap((r) => [r.p10, r.p90])]
  const y = scaleLinear()
    .domain(vals.length ? [Math.min(...vals) * 0.95, Math.max(...vals) * 1.05] : [0, 100])
    .nice(4)
    .range([H - PAD.b, PAD.t])
  const tx = (r) => x(Date.parse(r.ts))
  const band = area().x(tx).y0((r) => y(r.p10)).y1((r) => y(r.p90)).curve(curveMonotoneX)(fc)
  const med = line().x(tx).y((r) => y(r.p50)).curve(curveMonotoneX)(fc)
  const past = line().x(tx).y((r) => y(r.value)).curve(curveMonotoneX)(act.filter((r) => Date.parse(r.ts) <= now))
  const ahead = line().x(tx).y((r) => y(r.value)).curve(curveMonotoneX)(act.filter((r) => Date.parse(r.ts) >= now - 3600e3))
  const unit = act[0]?.unit?.startsWith('GBP') ? '£' : '€'
  const scrub = ctx.ui.at ? Date.parse(ctx.ui.at) : null

  return (
    <section className="panel zchart fade-in">
      <div className="panel-head">
        <span>{z.name} <span className="faint" style={{ fontWeight: 500 }}>· {unit}/MWh</span></span>
        <span className="tag">−24 h to +24 h</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${z.name} price, auction results and forecast band`}>
        {y.ticks(4).map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" className="ztick">{v}</text>
          </g>
        ))}
        {[-24, -12, 0, 12, 24].map((h) => (
          <text key={h} x={x(now + h * 3600e3)} y={H - 5} textAnchor="middle" className="ztick">{h === 0 ? 'now' : `${h > 0 ? '+' : ''}${h}h`}</text>
        ))}
        {band && <path d={band} fill="var(--accent)" opacity="0.16" />}
        {med && <path d={med} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="4 3" />}
        {ahead && <path d={ahead} fill="none" stroke="var(--text-2)" strokeWidth="1.4" strokeDasharray="1 3" strokeLinecap="round" />}
        {past && <path d={past} fill="none" stroke="var(--text)" strokeWidth="1.8" />}
        <line x1={x(now)} x2={x(now)} y1={PAD.t} y2={H - PAD.b} stroke="var(--text-3)" strokeDasharray="2 3" />
        {scrub && <line x1={x(scrub)} x2={x(scrub)} y1={PAD.t} y2={H - PAD.b} stroke="var(--hot)" strokeWidth="1.5" />}
      </svg>
      <div className="zlegend">
        <span><i style={{ background: 'var(--text)' }} /><Term id="day-ahead">Day-ahead price</Term></span>
        <span><i className="dot2" />Already auctioned</span>
        <span><i className="dash" /><Term id="best-guess">Best guess</Term> <span className="faint">P50</span></span>
        <span><i className="band" /><Term id="likely-range">Likely range</Term> <span className="faint">P10–P90</span></span>
        <p className="zghost">The faint block on the map is our forecast; the fainter it is, the less sure we are.</p>
        {!s && <span className="faint">loading…</span>}
        {s && !act.length && !fc.length && <span className="faint">No history yet</span>}
      </div>
      <style>{`
        .zchart { flex: none; }
        .zchart svg { display: block; padding: 0 10px; }
        .ztick { font-size: 9px; fill: var(--text-3); font-variant-numeric: tabular-nums; }
        .zlegend { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 4px 18px 14px; font-size: 11px; color: var(--text-2); }
        .zlegend i { display: inline-block; width: 10px; height: 2px; margin-right: 6px; vertical-align: middle; }
        .zlegend i.dot2 { border-top: 2px dotted var(--text-2); height: 0; }
        .zlegend i.dash { border-top: 2px dashed var(--accent); height: 0; }
        .zlegend i.band { background: var(--accent); opacity: 0.35; height: 8px; border-radius: 2px; }
        .zghost { flex-basis: 100%; margin: 4px 0 0; font-size: 12px; color: var(--text-2); line-height: 1.4; }
      `}</style>
    </section>
  )
}

export default { id: 'zoneChart', slot: 'left', order: 20, modes: ['overview'], Component: ZoneChart }
