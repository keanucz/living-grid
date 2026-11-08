import { Icon } from '../../shell/icons.jsx'
import { fmt } from '../../styles/tokens.js'
import { useCountUp } from '../../ui/useCountUp.js'

// Deltas are compared in EUR so zones rank fairly, but each is shown in its own currency.
const zoneDelta = (zone, eur) => (zone === 'GB' ? `${fmt.signed(eur / 1.15)} £/MWh` : `${fmt.signed(eur)} €/MWh`)

function StatTiles({ ctx }) {
  const sc = ctx.scenario
  const gb = ctx.stateByZone.GB
  const ranAt = ctx.ui.scenario?.ranAt
  const gbDelta = sc ? (sc.price_delta_eur.GB * sc.scale) / 1.15 : 0
  const gbNow = useCountUp(gb ? gb.price + gbDelta : 0, { ms: 900, key: ranAt })
  const deltas = sc ? Object.entries(sc.price_delta_eur).map(([z, d]) => [z, d * sc.scale]) : []
  const worst = deltas.sort((a, b) => b[1] - a[1])[0]

  const items = [
    { label: 'GB price', value: gb ? `£${gbNow.toFixed(1)}` : '—', delta: sc ? gbDelta : null, note: 'per MWh now' },
    { label: 'Hardest hit', value: worst ? worst[0] : '—', note: worst ? zoneDelta(worst[0], worst[1]) : 'no event' },
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
        .impact .kgrid { grid-template-columns: repeat(3, 1fr); }
        .impact .panel-head > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      `}</style>
    </section>
  )
}

export default { id: 'statTiles', slot: 'bottomRight', order: 10, modes: ['simulate'], Component: StatTiles }
