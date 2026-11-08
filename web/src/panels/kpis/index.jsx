import { fmt } from '../../styles/tokens.js'
import { GBP_EUR } from '../../api/client.js'
import { fmtPence } from '../../lib/wholesale.js'
import Explain from '../../ui/Explain.jsx'
import Term from '../../ui/Term.jsx'

const whole = (v) => Math.round(v).toLocaleString('en-GB')

// The section headline asks 'Is power cheap right now?' (shell/sections.js); this card is its answer.
// The answer line from live prices, each zone in its own currency. France and Germany usually clear at the same price
// (market coupling); when they do not, each gets its own figure.
export function answerParts(zs) {
  const by = Object.fromEntries((zs ?? []).map((z) => [z.zone, z]))
  const gb = by.GB?.price
  const fr = by.FR?.price
  const de = by['DE-LU']?.price
  return {
    gb: gb != null ? { mwh: `£${whole(gb)}`, p: fmtPence(gb) } : null,
    eu: fr != null && de != null
      ? (whole(fr) === whole(de) ? { both: `€${whole(fr)}` } : { fr: `€${whole(fr)}`, de: `€${whole(de)}` })
      : null,
  }
}

function Answer({ zs }) {
  const { gb, eu } = answerParts(zs)
  return (
    <>
      {gb && <>Britain {gb.mwh}/MWh <Term id="wholesale">wholesale</Term>, about {gb.p} per kWh.</>}
      {eu && ' '}
      {eu?.both && <>France and Germany {eu.both}/MWh.</>}
      {eu?.fr && <>France {eu.fr}/MWh and Germany {eu.de}/MWh.</>}
    </>
  )
}

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
  const carbon = wavg((z) => z.carbon?.consumption_gco2_kwh)
  const carbonZones = zs.filter((z) => z.carbon?.consumption_gco2_kwh != null).length
  const flowing = (ctx.data.state.flows ?? []).reduce((a, f) => a + Math.abs(f.mw), 0)

  const items = [
    { label: 'Average price', value: avg != null ? `€${avg.toFixed(1)}` : '—', delta: avgChange, note: 'per MWh' },
    { label: 'Cheapest', value: `${cheapest.zone} €${cheapest.price_eur.toFixed(0)}`, note: ctx.zoneById[cheapest.zone]?.name ?? '' },
    { label: 'Crossing borders', value: fmt.gw(flowing), note: 'all interconnectors' },
    { label: 'Europe carbon', value: carbon != null ? `${carbon.toFixed(0)} g` : '—', note: carbonZones < zs.length ? `per kWh consumed, ${carbonZones} of ${zs.length} zones` : 'per kWh consumed, average' },
  ]
  const experts = (
    <>
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
      <p className="knote kconv">Average and cheapest are in euros per MWh; Britain’s price is converted at £1 = €{GBP_EUR}.</p>
    </>
  )
  return (
    <div className="kpis">
      <Explain
        question={null}
        tag={ctx.source === 'live' ? 'Live' : 'Fixture'}
        answer={<Answer zs={zs} />}
        experts={experts}
      />
      <style>{`
        .kpis { width: 560px; max-width: 100%; }
        .kgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 4px 0 8px; }
        .klabel { font-size: 12px; }
        .kval { font-size: 22px; font-weight: 600; margin: 6px 0 4px; white-space: nowrap; color: var(--text); }
        .knote { font-size: 12px; }
        .kconv { margin: 4px 0 0; color: var(--text-3); }
        @media (max-width: 700px) { .kgrid { grid-template-columns: repeat(2, 1fr); } }
      `}</style>
    </div>
  )
}

export default { id: 'kpis', slot: 'bottomRight', order: 10, modes: ['overview'], Component: Kpis }
