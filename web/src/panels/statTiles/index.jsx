import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../shell/icons.jsx'
import { fmt } from '../../styles/tokens.js'

function useCountUp(target, ms = 1400, key) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms)
      const e = 1 - Math.pow(1 - t, 3)
      const cur = a + (target - a) * e
      setV(cur)
      from.current = cur
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, key])
  return v
}

function StatTiles({ ctx }) {
  const sc = ctx.scenario
  const gb = ctx.stateByZone.GB
  const ranAt = ctx.ui.scenario?.ranAt
  const cost = useCountUp(sc ? sc.cost_gbp * sc.scale : 0, 1600, ranAt)
  const gbDelta = sc ? (sc.price_delta_eur.GB * sc.scale) / 1.15 : 0
  const gbNow = useCountUp(gb ? gb.price + gbDelta : 0, 900, ranAt)
  const deltas = sc ? Object.entries(sc.price_delta_eur).map(([z, d]) => [z, d * sc.scale]) : []
  const worst = deltas.sort((a, b) => b[1] - a[1])[0]

  const items = [
    { label: 'Cost to consumers', value: sc ? fmt.money(cost) : '—', note: sc ? `over ${sc.hours >= 168 ? `${Math.round(sc.hours / 168)} weeks` : `${sc.hours} h`}` : 'Run a scenario', hot: true },
    { label: 'GB price', value: gb ? `£${gbNow.toFixed(1)}` : '—', delta: sc ? gbDelta : null, note: 'per MWh now' },
    { label: 'Hardest hit', value: worst ? worst[0] : '—', note: worst ? `${fmt.signed(worst[1])} €/MWh` : 'no event' },
    { label: 'Ghost wind', value: `${sc?.ghost_wind_mwh ? ((sc.ghost_wind_mwh * sc.scale) / 1000).toFixed(1) : '0.0'} GWh`, note: 'paid to switch off' },
  ]
  return (
    <section className="panel kpis impact fade-in">
      <div className="panel-head">
        <span>{sc ? sc.label : 'Scenario impact'} <span className="tag hot" style={{ marginLeft: 8 }}>Modelled</span></span>
        <button className="square-btn" title="Open details"><Icon name="arrowUpRight" size={15} /></button>
      </div>
      <div className="kgrid">
        {items.map((it) => (
          <div key={it.label}>
            <div className="faint klabel">{it.label}</div>
            <div className="kval num" style={it.hot && sc ? { color: 'var(--hot)' } : undefined}>{it.value}</div>
            {it.delta != null ? (
              <div className={`pill-delta ${it.delta >= 0 ? 'up' : 'down'}`}>{it.delta >= 0 ? '▲' : '▼'} {Math.abs(it.delta).toFixed(1)} vs now</div>
            ) : (
              <div className="faint knote">{it.note}</div>
            )}
          </div>
        ))}
      </div>
      <style>{`
        .kpis { width: 560px; }
        .kgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 4px 18px 18px; }
        .klabel { font-size: 12px; }
        .kval { font-size: 26px; font-weight: 600; margin: 6px 0 4px; white-space: nowrap; }
        .knote { font-size: 12px; }
        .impact .panel-head > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      `}</style>
    </section>
  )
}

export default { id: 'statTiles', slot: 'bottomRight', order: 10, modes: ['simulate'], Component: StatTiles }
