import { Icon } from '../../shell/icons.jsx'
import { fmt } from '../../styles/tokens.js'

function Kpis({ ctx }) {
  const zs = ctx.data.state?.zones
  if (!zs) return null
  // Demand-weighted where load is known, plain mean otherwise.
  const w = (z) => (z.demand_mw > 0 ? z.demand_mw : 1)
  const wavg = (get) => {
    const rows = zs.filter((z) => get(z) != null)
    const tw = rows.reduce((a, z) => a + w(z), 0)
    return tw ? rows.reduce((a, z) => a + get(z) * w(z), 0) / tw : null
  }
  const avg = wavg((z) => z.price_eur)
  const avgChange = wavg((z) => z.change_24h_eur)
  const cheapest = [...zs].sort((a, b) => a.price_eur - b.price_eur)[0]
  const gb = zs.find((z) => z.zone === 'GB')
  const carbon = wavg((z) => z.carbon?.consumption_gco2_kwh)
  const flowing = (ctx.data.state.flows ?? []).reduce((a, f) => a + Math.abs(f.mw), 0)

  const items = [
    { label: 'Average price', value: avg != null ? `€${avg.toFixed(1)}` : '—', delta: avgChange, note: 'per MWh' },
    { label: 'Cheapest', value: `${cheapest.zone} €${cheapest.price_eur.toFixed(0)}`, note: ctx.zoneById[cheapest.zone]?.name ?? '' },
    { label: (gb?.net_import_mw ?? 0) >= 0 ? 'GB importing' : 'GB exporting', value: gb?.net_import_mw != null ? fmt.gw(Math.abs(gb.net_import_mw)) : '—', note: `${fmt.gw(flowing)} crossing borders` },
    { label: 'Carbon', value: carbon != null ? `${carbon.toFixed(0)} g` : '—', note: 'per kWh consumed' },
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
