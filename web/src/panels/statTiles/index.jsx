import { fmtPence, pencePerKwh } from '../../lib/wholesale.js'
import Term from '../../ui/Term.jsx'
import { useCountUp } from '../../ui/useCountUp.js'

// What if impact, in plain words: Britain's wholesale price per kWh with the change, the country hit hardest and its
// change, and the extra wind paid to switch off. Deltas are compared in EUR so zones rank fairly, but each is shown in
// its own currency: pence per kWh for Britain (lib/wholesale.js), euros per MWh elsewhere.
const GBP_EUR = 1.15

function change(zone, eur) {
  if (zone === 'GB') return `${eur >= 0 ? '+' : '−'}${fmtPence(eur / GBP_EUR)} per kWh`
  return `${eur >= 0 ? '+' : '−'}€${Math.abs(eur).toFixed(1)} per MWh`
}

function StatTiles({ ctx }) {
  const sc = ctx.scenario
  const gb = ctx.stateByZone.GB
  const ranAt = ctx.ui.scenario?.ranAt
  const gbDelta = sc ? (sc.price_delta_eur.GB * sc.scale) / GBP_EUR : 0
  const gbNow = useCountUp(gb ? gb.price + gbDelta : 0, { ms: 900, key: ranAt })
  const deltas = sc ? Object.entries(sc.price_delta_eur).map(([z, d]) => [z, d * sc.scale]) : []
  const worst = deltas.sort((a, b) => b[1] - a[1])[0]
  const name = (z) => ctx.zoneById[z]?.name ?? z
  const wind = sc?.ghost_wind_mwh ? (sc.ghost_wind_mwh * sc.scale) / 1000 : 0

  const items = [
    { label: <>Britain, <Term id="wholesale">wholesale</Term></>, value: gb ? `${pencePerKwh(gbNow).toFixed(1)}p` : '…', note: 'per kWh',
      delta: sc ? gbDelta : null },
    { label: 'Hit hardest', value: worst ? name(worst[0]) : 'None yet', note: worst ? change(worst[0], worst[1]) : 'no event yet' },
    { label: 'Wind paid to switch off', value: `${wind.toFixed(1)} GWh`, note: 'extra, estimated' },
  ]
  return (
    <section className="panel kpis impact fade-in">
      <div className="panel-head">
        <span>{sc ? sc.label : 'What it would change'} <span className="tag hot" style={{ marginLeft: 8 }}>Modelled</span></span>
      </div>
      <div className="kgrid">
        {items.map((it, i) => (
          <div key={i}>
            <div className="faint klabel">{it.label}</div>
            <div className="kval num">{it.value}</div>
            {it.delta != null ? (
              <div className={`pill-delta ${it.delta >= 0 ? 'up' : 'down'}`}>{it.delta >= 0 ? '▲' : '▼'} {fmtPence(it.delta)} per kWh vs now</div>
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
        .kval { font-size: 26px; font-weight: 600; margin: 6px 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .knote { font-size: 12px; }
        .impact .kgrid { grid-template-columns: repeat(3, 1fr); }
        .impact .panel-head > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      `}</style>
    </section>
  )
}

export default { id: 'statTiles', slot: 'bottomRight', order: 10, modes: ['simulate'], Component: StatTiles }
