import { useEffect, useRef, useState } from 'react'
import { area, curveMonotoneX } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import { load, useGhostWind, WINDOWS, constraintBill } from '../../layers/ghostWind/data.js'
import { fmt } from '../../styles/tokens.js'

function useCountUp(target, ms = 1400) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms)
      const cur = a + (target - a) * (1 - Math.pow(1 - t, 3))
      setV(cur)
      from.current = cur
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

function Hourly({ regions }) {
  const n = Math.max(0, ...regions.map((r) => r.series?.length ?? 0))
  if (n < 2) return null
  const rows = Array.from({ length: n }, (_, i) => regions.reduce((a, r) => a + (r.series?.[i]?.boalf_mw ?? 0), 0))
  if (!rows.some((v) => v > 0)) return null // nothing switched off: no empty chart block
  const x = scaleLinear().domain([0, n - 1]).range([0, 520])
  const y = scaleLinear().domain([0, Math.max(1, ...rows)]).range([54, 4])
  const d = area().x((_, i) => x(i)).y0(54).y1((v) => y(v)).curve(curveMonotoneX)(rows)
  return (
    <svg viewBox="0 0 520 56" width="100%" height="56" preserveAspectRatio="none" aria-label="Hourly wind switched off">
      <defs>
        <linearGradient id="gwfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--wind)" stopOpacity=".7" />
          <stop offset="1" stopColor="var(--wind)" stopOpacity=".05" />
        </linearGradient>
      </defs>
      <path d={d} fill="url(#gwfill)" stroke="var(--wind)" strokeWidth="1.5" />
    </svg>
  )
}

function ConstraintBill({ ctx }) {
  const gw = useGhostWind()
  const on = ctx.ui.layers.ghostWind
  useEffect(() => {
    if (on && !gw.window && !gw.loading) load('live')
  }, [on, gw.window, gw.loading])
  const d = gw.data
  const boalf = d?.total_boalf_mwh ?? 0
  const gap = d?.total_weather_gap_mwh ?? 0
  const gwh = useCountUp(on ? boalf / 1000 : 0)
  const bill = constraintBill(d, gw.window)
  const cost = bill.gbp
  const costUp = useCountUp(on ? cost : 0, 1800)
  if (!on) return null

  const limits = (d?.boundary_flows ?? []).filter((b) => b.limit_mw)
  const latest = Object.values(Object.fromEntries(limits.map((b) => [b.boundary, b])))

  return (
    <section className="panel kpis gwbill fade-in">
      <div className="panel-head">
        <span>Wind paid to switch off <span className="tag" style={{ marginLeft: 8, color: 'var(--wind)' }}>{gw.source === 'sample' ? 'Sample data' : 'Estimated'}</span></span>
        <div className="gwtabs">
          {Object.entries(WINDOWS).map(([k, w]) => (
            <button key={k} className={gw.window === k ? 'on' : ''} onClick={() => load(k)}>{w.label}</button>
          ))}
        </div>
      </div>
      {gw.auto && gw.window === 'storm' && <div className="gwnote">No curtailment in the last 24 hours, so this shows the 26 October storm.</div>}
      <div className="kgrid">
        <div>
          <div className="faint klabel">Switched off</div>
          <div className="kval num" style={{ color: 'var(--wind)' }}>{gw.loading ? '…' : `${gwh.toFixed(1)} GWh`}</div>
          <div className="faint knote">accepted bids (BOALF)</div>
        </div>
        <div>
          <div className="faint klabel">Constraint bill</div>
          <div className="kval num">{cost ? fmt.money(costUp) : '—'}</div>
          <div className="faint knote">{bill.note}</div>
        </div>
        <div>
          <div className="faint klabel">Weather gap</div>
          <div className="kval num">{gap ? `${(gap / 1000).toFixed(1)} GWh` : '—'}</div>
          <div className="faint knote">{gap ? 'implied minus metered' : 'no metered output for this window'}</div>
        </div>
        <div>
          <div className="faint klabel">Homes for a day</div>
          <div className="kval num">{boalf ? `${((boalf * 1000) / 7.4 / 1e6).toFixed(1)}m` : '—'}</div>
          <div className="faint knote">at 2,700 kWh/yr (Ofgem typical)</div>
        </div>
      </div>
      <div className="gwchart"><Hourly regions={d?.regions ?? []} /></div>
      {latest.length > 0 && (
        <div className="gwbounds">
          {latest.map((b) => (
            <div key={b.boundary}>
              <span>{b.boundary}</span>
              <div className="gwbar"><i style={{ width: `${Math.min(100, (b.flow_mw / b.limit_mw) * 100)}%` }} /></div>
              <span className="num faint">{(b.flow_mw / 1000).toFixed(1)} / {(b.limit_mw / 1000).toFixed(1)} GW</span>
            </div>
          ))}
        </div>
      )}
      <style>{`
        .gwbill { width: 560px; border-color: rgba(94,214,196,.28); }
        .kpis { width: 560px; }
        .kgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 4px 18px 18px; }
        .klabel { font-size: 12px; }
        .kval { font-size: 26px; font-weight: 600; margin: 6px 0 4px; white-space: nowrap; }
        .knote { font-size: 12px; }
        .gwtabs { display: flex; gap: 4px; padding: 3px; border-radius: 999px; background: var(--card); }
        .gwtabs button { padding: 5px 10px; border-radius: 999px; font-size: 12px; color: var(--text-2); font-weight: 500; }
        .gwtabs button.on { background: var(--card-2); color: var(--wind); }
        .gwnote { margin: -4px 18px 10px; font-size: 12px; color: var(--text-2); }
        .gwchart { padding: 0 18px 14px; margin-top: -6px; }
        .gwbounds { padding: 0 18px 16px; display: grid; gap: 6px; font-size: 12px; }
        .gwbounds > div { display: grid; grid-template-columns: 64px 1fr 96px; gap: 10px; align-items: center; white-space: nowrap; }
        .gwbar { height: 6px; border-radius: 3px; background: var(--card-2); overflow: hidden; }
        .gwbar i { display: block; height: 100%; background: var(--wind); }
      `}</style>
    </section>
  )
}

export default { id: 'constraintBill', slot: 'bottomRight', order: 5, modes: ['overview', 'simulate'], Component: ConstraintBill }
