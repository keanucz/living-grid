import { useEffect, useRef, useState } from 'react'
import { fmt } from '../../styles/tokens.js'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Counts from 0 to `target` (ease-out) each time `runKey` changes, so the figure visibly builds up.
export function useCountUp(target, runKey, ms = 1400) {
  const [v, setV] = useState(reduced() ? target : 0)
  const raf = useRef(0)
  useEffect(() => {
    if (reduced()) return setV(target)
    const t0 = performance.now()
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms)
      setV(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, runKey, ms])
  return v
}

export const duration = (h) => (h >= 168 ? `${Math.round(h / 168)} wk` : h >= 48 ? `${Math.round(h / 24)} days` : `${h} h`)

const sym = (c) => (c === 'GBP' ? '£' : '€')

// Result of POST /intervene (engine InterventionResult) or, when the API is unavailable, a pre-computed scenario.
export function ResultCard({ result, scenario, runKey }) {
  const live = !!result
  const p = live ? result.cost_total_gbp : { p10: scenario.cost_band_gbp?.p10, p50: scenario.cost_gbp, p90: scenario.cost_band_gbp?.p90 }
  const shown = useCountUp(p.p50 ?? 0, runKey)
  const sentence = live ? result.explanation.sentence : scenario.explanation
  const winners = live ? result.winners : scenario.winners.map((who) => ({ who }))
  const losers = live ? result.losers : scenario.losers.map((who) => ({ who }))
  const zones = live ? [...result.zones].sort((a, b) => Math.abs(b.avg_delta) - Math.abs(a.avg_delta)) : []
  const hours = live ? result.applied_hours : scenario.hours
  const battery = live ? result.battery?.[0] : null
  const money = (g) => (g == null ? '' : ` ${fmt.money(g)}`)

  return (
    <section className="sim-card fade-in" key={runKey} aria-live="polite">
      <div className="sim-row">
        <span className="sim-title">{live ? result.title : scenario.label}</span>
        <span style={{ flex: 1 }} />
        <span className="tag">{live ? 'Modelled' : 'Pre-computed'}</span>
      </div>
      <div className="cost-label faint">{result?.cost_basis === 'consumer' ? 'Cost to consumers' : 'Extra wholesale cost'} over {duration(hours)}</div>
      <div className="cost num" data-testid="cost">{fmt.money(shown)}</div>
      {p.p10 != null && p.p90 != null && (
        <div className="faint cost-range">Likely range {fmt.money(p.p10)} to {fmt.money(p.p90)}</div>
      )}
      <div className="faint cost-basis">What the wholesale market pays if every MWh trades at the new price. Household bills follow later, through suppliers’ hedging and the quarterly price cap.</div>
      <p className="why">{sentence}</p>
      {zones.length > 0 && (
        <div className="zdeltas">
          {zones.map((z) => (
            <div key={z.zone}>
              <span className="faint">{z.zone}</span>
              <b className={`num ${z.avg_delta >= 0 ? 'up' : 'down'}`}>{z.avg_delta >= 0 ? '+' : '−'}{sym(z.currency)}{Math.abs(z.avg_delta).toFixed(2)}</b>
            </div>
          ))}
          <span className="faint zunit">average change per MWh</span>
        </div>
      )}
      <div className="wl">
        <div><span className="faint">Winners</span>{winners.map((w) => <span key={w.who} className="tag accent">{w.who}{money(w.gbp)}</span>)}</div>
        <div><span className="faint">Losers</span>{losers.map((w) => <span key={w.who} className="tag hot">{w.who}{money(w.gbp)}</span>)}</div>
      </div>
      {battery && (
        <div className="faint note">Battery in {battery.zone}: {battery.note}</div>
      )}
      {live && result.ghost_wind && (
        <div className="faint note">Ghost wind: {Math.round(result.ghost_wind.delta_mwh)} MWh, constraint cost {fmt.money(result.ghost_wind.delta_constraint_cost_gbp)} (estimated).</div>
      )}
      {live && result.clamped && (
        <div className="note clamp">Magnitude was clamped to {result.applied_magnitude} to stay within what the model has seen.</div>
      )}
      <div className="faint note">{live ? result.method_note : 'Pre-computed result: the live model could not be reached.'}</div>
    </section>
  )
}

export const RESULT_CSS = `
.cost-label { font-size: 12px; margin-top: 12px; }
.cost { font-size: 44px; font-weight: 700; line-height: 1.1; color: var(--hot); font-variant-numeric: tabular-nums; }
.cost-range { font-size: 12px; margin-bottom: 4px; }
.zdeltas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 10px 0; }
.zdeltas > div { background: var(--card); border-radius: 12px; padding: 6px 10px; display: flex; justify-content: space-between; font-size: 13px; }
.zdeltas .up { color: var(--hot); } .zdeltas .down { color: var(--accent); }
.zunit { grid-column: 1 / -1; font-size: 11px; }
.note { font-size: 11px; margin-top: 8px; }
.note.clamp { color: var(--hot); }
`
