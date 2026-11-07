import { useEffect, useState } from 'react'

// "Compared with the price cap you would save": GET /household/savings (#178). Hidden if the API has no answer,
// so the view never shows sample numbers as if they were live.
const TZ = 'Europe/London'
const t = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ })
const gbp = (v) => {
  const a = Math.abs(v)
  return `${v < 0 ? '−' : ''}£${a >= 10 ? Math.round(a) : a.toFixed(2)}`
}
const pence = (v) => `${Math.round(v)}p`

function load(region) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  return fetch(`/api/household/savings?region=${encodeURIComponent(region)}`, { signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer))
}

export default function Savings({ region }) {
  const [s, setS] = useState(undefined)
  const [off, setOff] = useState({})
  useEffect(() => {
    setS(undefined)
    load(region).then(setS)
  }, [region])
  if (!s) return null

  const devices = Object.fromEntries((s.devices ?? []).map((d) => [d.device, d]))
  const tonight = (s.tonight ?? []).filter((w) => !off[w.device])
  // Headline from the first device shown: price per kWh in the window, at 6 pm, and on the cap.
  const h = tonight[0]
  const hd = h && devices[h.device]
  const perKwh = (gbpVal) => (hd ? (gbpVal * 100) / hd.kwh_per_use : null)
  const months = (s.months ?? []).filter((m) => !m.partial)
  const maxM = Math.max(1, ...months.map((m) => m.saving_vs_6pm_gbp))
  const yr = s.annual?.saving_vs_6pm_gbp
  const yrCap = s.annual?.saving_vs_cap_today_gbp

  return (
    <section className="sv">
      <div className="sv-kicker">Compared with the price cap</div>
      {h && hd && (perKwh(h.cost_gbp.p50) <= s.cap.p_kwh ? (
        <h2 className="sv-head">
          {h.label} at {t(h.start)}: <b>{pence(perKwh(h.cost_gbp.p50))}</b> a kWh, against{' '}
          {pence(perKwh(h.cost_gbp.p50 + h.saving_vs_6pm_gbp.p50))} at the 6 pm peak and {pence(s.cap.p_kwh)} on the price cap.
        </h2>
      ) : (
        <h2 className="sv-head">
          Tonight Agile is dearer than the price cap: the cheapest slot is <b>{pence(perKwh(h.cost_gbp.p50))}</b> a kWh against{' '}
          {pence(s.cap.p_kwh)} on the cap. Shifting still beats the 6 pm peak ({pence(perKwh(h.cost_gbp.p50 + h.saving_vs_6pm_gbp.p50))}).
        </h2>
      ))}

      <div className="sv-toggles" role="group" aria-label="Devices">
        {(s.devices ?? []).map((d) => (
          <button key={d.device} className={off[d.device] ? '' : 'on'} aria-pressed={!off[d.device]}
            onClick={() => setOff((o) => ({ ...o, [d.device]: !o[d.device] }))}>
            {d.label}
          </button>
        ))}
      </div>

      {tonight.map((w) => (
        <div key={w.device} className="sv-row">
          <div className="sv-l">
            <b>{w.label}</b>
            <span>{day(w.start)} {t(w.start)}–{t(w.end)} · {w.kind === 'forecast' ? 'forecast' : 'published'}</span>
          </div>
          <div className="sv-n">
            <b className="num">{gbp(w.saving_vs_cap_gbp.p50)}</b>
            <span>{w.saving_vs_cap_gbp.p50 < 0 ? 'dearer than cap' : 'vs cap'} ({gbp(w.saving_vs_cap_gbp.p10)} to {gbp(w.saving_vs_cap_gbp.p90)})</span>
          </div>
          <div className="sv-n">
            <b className="num">{gbp(w.saving_vs_6pm_gbp.p50)}</b>
            <span>vs 6 pm peak</span>
          </div>
        </div>
      ))}

      {yr && (
        <div className="sv-year">
          <div>
            <span className="sv-k">Over a year, vs running at the 6 pm peak</span>
            <b className="num">{gbp(yr.low)}–{gbp(yr.high)}</b>
          </div>
          {yrCap && (
            <div>
              <span className="sv-k">vs today’s price cap</span>
              <b className="num">{gbp(yrCap.low)}–{gbp(yrCap.high)}</b>
            </div>
          )}
        </div>
      )}

      {months.length > 1 && (
        <div className="sv-months" role="img" aria-label="Saving each month against running at 6 pm">
          {months.map((m) => (
            <div key={m.month} className="sv-m">
              <i style={{ height: `${(m.saving_vs_6pm_gbp / maxM) * 100}%` }} title={`${m.month}: ${gbp(m.saving_vs_6pm_gbp)}`} />
              <span>{m.month.slice(5)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="sv-note">
        Cap: {s.cap.p_kwh.toFixed(2)}p/kWh, {s.cap.period}. Device figures: {(s.devices ?? []).map((d) => d.basis).join('; ')}.
        {s.annual ? ` Yearly range from ${s.annual.months_used} complete months of published Agile prices; excludes standing charges.` : ''}
      </p>
      <style>{CSS}</style>
    </section>
  )
}

const CSS = `
.sv { background: var(--panel-solid); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; margin-bottom: 12px; }
.sv-kicker, .sv-k { font: 500 10px var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--text-3); }
.sv-head { font-size: 19px; font-weight: 500; line-height: 1.35; letter-spacing: -0.01em; margin: 8px 0 12px; }
.sv-head b { font-weight: 700; }
.sv-toggles { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.sv-toggles button { padding: 7px 11px; border-radius: 999px; border: 1px solid var(--line-2); color: var(--text-3); font-size: 13px; }
.sv-toggles button.on { background: #fafafa; color: #0a0a0a; border-color: #fafafa; }
.sv-row { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
.sv-l { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sv-l span, .sv-n span { font-size: 11px; color: var(--text-3); }
.sv-n { display: flex; flex-direction: column; align-items: flex-end; }
.sv-n b { font-size: 18px; }
.sv-year { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--line); }
.sv-year > div { display: flex; flex-direction: column; gap: 4px; }
.sv-year b { font-size: 20px; }
.sv-months { display: flex; align-items: flex-end; gap: 4px; height: 80px; margin-top: 14px; }
.sv-m { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
.sv-m i { display: block; width: 100%; background: var(--text-2); border-radius: 2px 2px 0 0; min-height: 2px; }
.sv-m span { font: 9px var(--mono); color: var(--text-3); }
.sv-note { font-size: 11px; color: var(--text-3); line-height: 1.45; margin: 12px 0 0; }
`
