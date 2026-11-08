import { useState } from 'react'
import { useCarbonCosts, perMwh, perYear, sym } from './costs.js'

// A four-step story under the carbon legend: what carbon adds to each MWh, the gap between the market price of carbon
// and the government's value, carbon that arrives through imports, and what it means for a home and a data centre.
// Every figure comes from GET /carbon/costs (#187) with its source named; costs are estimates.
const STEPS = [
  { id: 'cost', label: 'What it adds' },
  { id: 'gap', label: 'The gap' },
  { id: 'imports', label: 'Imports' },
  { id: 'share', label: 'Your share' },
]
const when = (p) => (p.basis.startsWith('monthly')
  ? `${new Date(p.as_of).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} average`
  : day(p.as_of))
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')

function Spark({ rows }) {
  if (!rows || rows.length < 2) return <span style={{ width: 64 }} />
  const lo = Math.min(...rows.map((r) => r.cost))
  const hi = Math.max(...rows.map((r) => r.cost))
  const pts = rows.map((r, i) => `${(i / (rows.length - 1)) * 62 + 1},${hi === lo ? 10 : 18 - ((r.cost - lo) / (hi - lo)) * 16}`).join(' ')
  return (
    <svg width="64" height="20" aria-label="Carbon cost over the last 24 hours" role="img">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  )
}

function Bar({ value, max, color }) {
  return <div style={{ height: 8, borderRadius: 4, background: 'var(--card)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} /></div>
}

export default function Story({ intensity }) {
  const { now, series, status } = useCarbonCosts()
  const [step, setStep] = useState('cost')
  const [zone, setZone] = useState('GB')
  if (status === 'missing' || (status !== 'loading' && !now)) {
    return <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Carbon costs appear here once the engine has today&apos;s carbon prices.</div>
  }
  if (!now) return <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Loading carbon costs…</div>
  const zones = now.zones
  const sel = zones.find((z) => z.zone === zone) ?? zones[0]
  const priced = zones.filter((z) => z.carbon_cost_per_mwh != null).sort((a, b) => b.carbon_cost_per_mwh - a.carbon_cost_per_mwh)
  const maxCost = Math.max(1, ...priced.map((z) => z.carbon_cost_per_mwh))
  const schemes = [...new Map(zones.filter((z) => z.carbon_price).map((z) => [z.carbon_price.scheme, z.carbon_price])).values()]

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>Carbon, in money</b>
        <span className="tag hot">Estimated</span>
        <div role="tablist" style={{ marginLeft: 'auto', display: 'flex', gap: 3, padding: 3, borderRadius: 999, background: 'var(--card)' }}>
          {STEPS.map((s) => (
            <button key={s.id} role="tab" aria-selected={step === s.id} onClick={() => setStep(s.id)}
              style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, color: step === s.id ? 'var(--text)' : 'var(--text-2)', background: step === s.id ? 'var(--card-2)' : 'transparent' }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {step === 'cost' && (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
            Carbon cost in every MWh a zone consumes: its carbon intensity times the price of a tonne under its scheme. Line: last 24 hours.
          </div>
          {priced.map((z) => (
            <button key={z.zone} onClick={() => { setZone(z.zone); setStep('gap') }} title="See the gap for this zone"
              style={{ display: 'grid', gridTemplateColumns: '92px 1fr 70px 64px', gap: 8, alignItems: 'center', width: '100%', marginTop: 6, textAlign: 'left', color: 'inherit' }}>
              <span style={{ fontSize: 13 }}>{z.name}</span>
              <Bar value={z.carbon_cost_per_mwh} max={maxCost} color="var(--accent)" />
              <span className="num" style={{ fontSize: 13 }}>{perMwh(z.carbon_cost_per_mwh, z.currency)}/MWh</span>
              <Spark rows={series[z.zone]} />
            </button>
          ))}
          {zones.filter((z) => z.carbon_cost_per_mwh == null).map((z) => (
            <div key={z.zone} className="faint" style={{ fontSize: 12, marginTop: 4 }}>{z.name}: no carbon price available, so no cost shown.</div>
          ))}
          <div className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>
            {schemes.map((p) => `${p.scheme}: ${sym(p.currency)}${p.value.toFixed(2)}/t (${p.basis}; ${when(p)}; ${p.source})`).join(' · ')}
          </div>
        </div>
      )}

      {step === 'gap' && sel && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {zones.map((z) => (
              <button key={z.zone} onClick={() => setZone(z.zone)} aria-pressed={sel.zone === z.zone}
                style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12, background: sel.zone === z.zone ? 'var(--card-2)' : 'var(--card)', color: sel.zone === z.zone ? 'var(--text)' : 'var(--text-2)' }}>{z.zone}</button>
            ))}
          </div>
          {sel.carbon_cost_per_mwh == null ? (
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>No carbon price for {sel.name} right now, so the gap cannot be shown.</div>
          ) : (
            <>
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '150px 1fr 70px', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <span>Priced by the market</span><Bar value={sel.carbon_cost_per_mwh} max={sel.appraisal_cost_per_mwh} color="var(--accent)" /><span className="num">{perMwh(sel.carbon_cost_per_mwh, sel.currency)}</span>
                <span>Valued by government</span><Bar value={sel.appraisal_cost_per_mwh} max={sel.appraisal_cost_per_mwh} color="var(--hot)" /><span className="num">{perMwh(sel.appraisal_cost_per_mwh, sel.currency)}</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
                Each MWh in {sel.name} carries about {perMwh(sel.carbon_cost_per_mwh, sel.currency)} of carbon cost in the market. The UK government values a tonne at £{now.appraisal.gbp_per_t} ({now.appraisal.price_base}), which would make it {perMwh(sel.appraisal_cost_per_mwh, sel.currency)}: <b>{perMwh(sel.unpriced_gap_per_mwh, sel.currency)}/MWh stays unpriced</b>.
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }} title={now.appraisal.source}>
                Government value: DESNZ appraisal guidance (Nov 2026), a social value rather than a market price.{sel.currency === 'EUR' ? ` Converted at a fixed £1 = €${now.eur_per_gbp}.` : ''}
              </div>
            </>
          )}
        </div>
      )}

      {step === 'imports' && (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
            Own generation versus what the zone really consumes once imports at the exporter&apos;s intensity are counted (g CO2/kWh, modelled). Imports are priced at the importer&apos;s own carbon price, a simplification.
          </div>
          {zones.map((z) => {
            const i = intensity?.[z.zone]
            const prod = i?.production ?? z.production_gco2_kwh
            const cons = i?.consumption ?? z.consumption_gco2_kwh
            const diff = cons - prod
            return (
              <div key={z.zone} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 90px', gap: 8, alignItems: 'center', marginTop: 6, fontSize: 13 }}>
                <span>{z.name}</span>
                <span className="num faint">{Math.round(prod)} → {Math.round(cons)} g/kWh</span>
                <span className="num" style={{ color: diff >= 25 ? '#ff8fb8' : 'var(--text-2)' }}>{diff >= 0 ? '+' : '−'}{Math.abs(Math.round(diff))} from imports</span>
              </div>
            )
          })}
        </div>
      )}

      {step === 'share' && sel && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {zones.map((z) => (
              <button key={z.zone} onClick={() => setZone(z.zone)} aria-pressed={sel.zone === z.zone}
                style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12, background: sel.zone === z.zone ? 'var(--card-2)' : 'var(--card)', color: sel.zone === z.zone ? 'var(--text)' : 'var(--text-2)' }}>{z.zone}</button>
            ))}
          </div>
          {sel.household_per_year == null ? (
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>No carbon price for {sel.name} right now.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <div style={{ background: 'var(--card)', borderRadius: 12, padding: 10 }}>
                <div className="muted" style={{ fontSize: 12 }}>A typical home ({now.household.kwh_per_year.toLocaleString('en-GB')} kWh a year)</div>
                <b className="num" style={{ fontSize: 20 }}>{perYear(sel.household_per_year, sel.currency)}</b>
                <div className="faint" style={{ fontSize: 11 }}>a year in carbon cost; {perYear(sel.household_unpriced_per_year, sel.currency)} more at the government&apos;s value</div>
              </div>
              <div style={{ background: 'var(--card)', borderRadius: 12, padding: 10 }}>
                <div className="muted" style={{ fontSize: 12 }}>A data centre ({now.data_centre.mw} MW, flat all year)</div>
                <b className="num" style={{ fontSize: 20 }}>{perYear(sel.data_centre_per_year, sel.currency)}</b>
                <div className="faint" style={{ fontSize: 11 }}>a year in carbon cost; {perYear(sel.data_centre_unpriced_per_year, sel.currency)} more at the government&apos;s value</div>
              </div>
            </div>
          )}
          <div className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>
            At this hour&apos;s intensity and price, not a bill. Home use: {now.household.source}. <a href="#/household" style={{ color: 'var(--accent)' }}>See tonight&apos;s cheapest power for your home</a>.
          </div>
        </div>
      )}

      <div className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>{now.note}</div>
    </div>
  )
}
