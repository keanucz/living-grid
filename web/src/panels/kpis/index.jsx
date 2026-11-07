import { Icon } from '../../shell/icons.jsx'
import { fmt } from '../../styles/tokens.js'

function Kpis({ ctx }) {
  const zs = ctx.data.state?.zones
  if (!zs) return null
  const totalDemand = zs.reduce((a, z) => a + z.demand_mw, 0)
  const avg = zs.reduce((a, z) => a + z.price_eur * z.demand_mw, 0) / totalDemand
  const avgChange = zs.reduce((a, z) => a + z.change_24h_eur * z.demand_mw, 0) / totalDemand
  const cheapest = [...zs].sort((a, b) => a.price_eur - b.price_eur)[0]
  const gb = zs.find((z) => z.zone === 'GB')
  const carbon = zs.reduce((a, z) => a + z.carbon.consumption_gco2_kwh * z.demand_mw, 0) / totalDemand
  const flowing = (ctx.data.state.flows ?? []).reduce((a, f) => a + Math.abs(f.mw), 0)

  const items = [
    { label: 'Average price', value: `€${avg.toFixed(1)}`, delta: avgChange, unit: '/MWh' },
    { label: 'Cheapest', value: `${cheapest.zone} €${cheapest.price_eur.toFixed(0)}`, note: ctx.zoneById[cheapest.zone]?.name ?? '' },
    { label: 'GB importing', value: fmt.gw(gb?.net_import_mw ?? 0), note: `${fmt.gw(flowing)} crossing borders` },
    { label: 'Carbon', value: `${carbon.toFixed(0)} g`, note: 'per kWh consumed' },
  ]
  return (
    <section className="panel kpis fade-in">
      <div className="panel-head">
        <span>Europe right now <span className="tag" style={{ marginLeft: 8 }}>{ctx.source === 'live' ? 'Live' : 'Fixture'}</span></span>
        <button className="square-btn" title="Open scoreboard"><Icon name="arrowUpRight" size={15} /></button>
      </div>
      <div className="kgrid">
        {items.map((it) => (
          <div key={it.label}>
            <div className="faint klabel">{it.label}</div>
            <div className="kval num">{it.value}</div>
            {it.delta != null ? (
              <div className={`pill-delta ${it.delta >= 0 ? 'up' : 'down'}`}>{it.delta >= 0 ? '▲' : '▼'} {Math.abs(it.delta).toFixed(1)} vs yesterday</div>
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
      `}</style>
    </section>
  )
}

export default { id: 'kpis', slot: 'bottomRight', order: 10, modes: ['overview'], Component: Kpis }
