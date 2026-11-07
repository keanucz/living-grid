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

  return (
    <div className="tiles">
      <div className="tile big">
        <span className="tl">Cost to consumers <span className="tag" style={{ marginLeft: 6 }}>Modelled</span></span>
        <b className="num">{sc ? fmt.money(cost) : '—'}</b>
        <span className="faint">{sc ? `over ${sc.hours >= 168 ? `${Math.round(sc.hours / 168)} weeks` : `${sc.hours} h`}` : 'Run a scenario'}</span>
      </div>
      <div className="tile">
        <span className="tl">GB price</span>
        <b className="num">£{gbNow.toFixed(1)}<small>/MWh</small></b>
        <span className={`pill-delta ${gbDelta > 0 ? 'up' : 'down'}`}>{sc ? `${fmt.signed(gbDelta)} vs now` : 'now'}</span>
      </div>
      <div className="tile">
        <span className="tl">Hardest hit</span>
        <b className="num">{worst ? worst[0] : '—'}</b>
        <span className="faint">{worst ? `${fmt.signed(worst[1])} €/MWh` : 'no event'}</span>
      </div>
      <div className="tile">
        <span className="tl">Ghost wind</span>
        <b className="num">{sc?.ghost_wind_mwh ? `${(sc.ghost_wind_mwh * sc.scale / 1000).toFixed(1)}` : '0.0'}<small> GWh</small></b>
        <span className="faint">paid to switch off</span>
      </div>
      <style>{`
        .tiles { display: flex; gap: 10px; align-items: flex-end; margin-left: 180px; }
        .tile { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 24px; padding: 14px 20px; min-width: 150px; display: flex; flex-direction: column; gap: 4px; box-shadow: var(--shadow); }
        .tile.big { min-width: 210px; border-color: rgba(255,138,31,.35); }
        .tile .tl { color: var(--text-2); font-size: 13px; display: flex; align-items: center; white-space: nowrap; }
        .tile b { font-size: 30px; font-weight: 600; white-space: nowrap; }
        .tile.big b { color: var(--hot); }
        .tile b small { font-size: 13px; color: var(--text-3); font-weight: 500; margin-left: 2px; }
        .tile > span:last-child { font-size: 12px; }
        .tiles .go { width: 64px; height: 64px; margin-left: 8px; color: var(--hot); }
      `}</style>
    </div>
  )
}

export default { id: 'statTiles', slot: 'bottom', order: 10, modes: ['simulate'], Component: StatTiles }
