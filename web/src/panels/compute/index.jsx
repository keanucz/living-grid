import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../shell/icons.jsx'

// Cost of running AI at our day-ahead prices, from GET /compute (wholesale energy only).
const PRESETS = [
  { id: 'h100', label: 'H100 GPU', kw: 0.91, note: '700 W × PUE 1.3' },
  { id: 'srv8', label: '8-GPU server', kw: 13.3, note: '10.2 kW × PUE 1.3' },
  { id: 'dc', label: '100 MW data centre', kw: 100_000, note: 'continuous load' },
  { id: 'pc', label: 'Home RTX 4090 PC', kw: 0.6, note: 'PC at full load' },
]
const HOURS = 6
const HOURS_PER_YEAR = 8760
const SYM = { GBP: '£', EUR: '€' }

function money(v, sym) {
  const a = Math.abs(v)
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(0)}k` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : a >= 100 ? a.toFixed(0) : a >= 1 ? a.toFixed(2) : a >= 0.1 ? a.toFixed(2) : a.toFixed(3)
  return `${v < 0 ? '−' : ''}${sym}${s}`
}
const hhmm = (iso) => new Date(iso).toISOString().slice(11, 16)

async function load(kw, signal) {
  const deadline = new Date(Math.floor(Date.now() / 3.6e6) * 3.6e6 + 48 * 3.6e6).toISOString()
  const r = await fetch(`/api/compute?kw=${kw}&hours=${HOURS}&deadline=${deadline}`, { signal })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

function Compute({ ctx }) {
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState('dc')
  const [d, setD] = useState(undefined)
  const [zone, setZone] = useState(null)
  const p = PRESETS.find((x) => x.id === preset)

  useEffect(() => {
    if (!open && d !== undefined) return
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    setD((prev) => (prev ? { ...prev, stale: true } : undefined))
    load(p.kw, ctrl.signal).then(setD).catch(() => setD(null)).finally(() => clearTimeout(t))
    return () => ctrl.abort()
  }, [p.kw, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!d?.zones) return []
    const eur = (z, v) => (z.currency === 'GBP' ? v * d.eur_per_gbp : v)
    const out = d.zones.map((z) => {
      const ps = z.prices.map((x) => x.p50)
      const mean = ps.reduce((a, b) => a + b, 0) / Math.max(1, ps.length)
      return { z, yearEur: (eur(z, mean) * p.kw * HOURS_PER_YEAR) / 1000, nowEur: (z.cost_now.p50 / HOURS) * (z.currency === 'GBP' ? d.eur_per_gbp : 1) }
    })
    const min = Math.min(...out.map((r) => r.yearEur))
    return out.map((r) => ({ ...r, gapEur: r.yearEur - min })).sort((a, b) => a.yearEur - b.yearEur)
  }, [d, p.kw])

  const sel = d?.zones?.find((z) => z.zone === (zone ?? ctx?.ui?.selectedZone)) ?? d?.zones?.[0]
  const sym = SYM[sel?.currency] ?? '€'
  const perNow = sel ? sel.cost_now.p50 / HOURS : null
  const perBest = sel ? sel.cost.p50 / HOURS : null
  const pct = sel && sel.cost_now.p50 > 0 ? Math.round((sel.saving.p50 / sel.cost_now.p50) * 100) : 0
  const maxGap = Math.max(1, ...rows.map((r) => r.gapEur))

  return (
    <section className="panel cmp fade-in">
      <button className="panel-head cmp-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span><Icon name="chart" size={16} /> Cost of running AI <span className="tag" style={{ marginLeft: 6 }}>Wholesale energy</span></span>
        <span className="cmp-sum num">
          {d === undefined && 'Loading…'}
          {d === null && 'Not reachable'}
          {rows.length > 0 && !open && `${p.label}: ${money(rows.at(-1).gapEur, '€')}/yr between ${rows[0].z.zone} and ${rows.at(-1).z.zone}`}
          <span className="cmp-chev">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <div className="cmp-body">
          <div className="cmp-presets" role="tablist" aria-label="What is running">
            {PRESETS.map((x) => (
              <button key={x.id} role="tab" aria-selected={x.id === preset} className={x.id === preset ? 'on' : ''} onClick={() => setPreset(x.id)} title={x.note}>{x.label}</button>
            ))}
          </div>

          {d === null && <p className="faint">The compute endpoint is not reachable right now.</p>}
          {sel && (
            <>
              <div className="cmp-zones">
                {d.zones.map((z) => (
                  <button key={z.zone} className={z.zone === sel.zone ? 'on' : ''} onClick={() => setZone(z.zone)}>{z.zone}</button>
                ))}
              </div>
              <div className={`cmp-hero ${d.stale ? 'stale' : ''}`}>
                <div>
                  <span className="cmp-l">Per hour, starting now</span>
                  <b className="num">{money(perNow, sym)}</b>
                </div>
                <div className="cmp-arrow" aria-hidden>→</div>
                <div>
                  <span className="cmp-l">Per hour, best {HOURS} h window ({hhmm(sel.start)}–{hhmm(sel.end)} UTC)</span>
                  <b className="num acc">{money(perBest, sym)}</b>
                </div>
                <div className="cmp-save">
                  {sel.saving.p50 > 0 ? <>Waiting saves <b className="num">{pct}%</b> ({money(sel.saving.p50, sym)} over {HOURS} h)</> : <>Starting now is already the cheapest window.</>}
                  {sel.cost.p10 !== sel.cost.p90 && <span className="faint"> · P10–P90 {money(sel.cost.p10 / HOURS, sym)}–{money(sel.cost.p90 / HOURS, sym)}/h</span>}
                </div>
              </div>

              <div className="cmp-sub">Yearly cost if it ran continuously at the next 48 h average price</div>
              {rows.map((r) => (
                <div key={r.z.zone} className="cmp-row">
                  <span className="cmp-z">{r.z.zone}</span>
                  <div className="cmp-track"><i style={{ width: `${Math.max(2, (r.gapEur / maxGap) * 100)}%`, background: r.gapEur === 0 ? 'var(--accent)' : 'var(--hydro)' }} /></div>
                  <span className="num cmp-v">{money(r.yearEur, '€')}</span>
                  <span className="num faint cmp-g">{r.gapEur === 0 ? 'cheapest' : `+${money(r.gapEur, '€')}`}</span>
                </div>
              ))}
              <p className="cmp-note">
                {d.note} The yearly figure is a straight-line extrapolation of two days, not a forecast of the year. Power draw includes cooling overhead (PUE 1.3) and comes from vendor specifications, not measurements. {sel.kind === 'actual' ? 'Cleared auction prices.' : 'Includes our forecast beyond published auctions.'}
              </p>
            </>
          )}
        </div>
      )}
      <style>{`
        .cmp { width: 560px; max-width: 100%; min-width: 0; box-sizing: border-box; }
        .cmp-head { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; text-align: left; color: inherit; }
        .cmp-head > span:first-child { display: flex; align-items: center; gap: 8px; flex: none; }
        .cmp-sum { font-size: 12px; color: var(--text-2); display: flex; gap: 8px; align-items: center; min-width: 0; text-align: right; overflow-wrap: anywhere; }
        .cmp-body { padding: 0 18px 16px; }
        .cmp-presets { display: flex; gap: 4px; flex-wrap: wrap; padding: 3px; border-radius: 16px; background: var(--card); margin-bottom: 10px; }
        .cmp-presets button, .cmp-zones button { padding: 5px 10px; border-radius: 999px; font-size: 12px; color: var(--text-2); font-weight: 600; }
        .cmp-presets button.on, .cmp-zones button.on { background: var(--card-2); color: var(--accent); }
        .cmp-zones { display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 10px; }
        .cmp-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px 12px; align-items: center; transition: opacity .2s; }
        .cmp-hero.stale { opacity: .5; }
        .cmp-hero b { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; display: block; }
        .cmp-hero b.acc { color: var(--accent); }
        .cmp-l { font-size: 11px; color: var(--text-3); display: block; }
        .cmp-arrow { color: var(--text-3); font-size: 20px; }
        .cmp-save { grid-column: 1 / -1; font-size: 12px; color: var(--text-2); }
        .cmp-save b { color: var(--text); }
        .cmp-sub { margin: 14px 0 6px; font-size: 11px; color: var(--text-3); }
        .cmp-row { display: grid; grid-template-columns: 52px 1fr 70px 70px; gap: 10px; align-items: center; margin-bottom: 6px; font-size: 12px; }
        .cmp-z { font-weight: 600; }
        .cmp-track { height: 10px; border-radius: 5px; background: var(--card); overflow: hidden; }
        .cmp-track i { display: block; height: 100%; border-radius: 5px; }
        .cmp-v { text-align: right; font-weight: 600; }
        .cmp-g { text-align: right; }
        .cmp-note { margin: 10px 0 0; font-size: 11px; line-height: 1.45; color: var(--text-3); }
        @media (max-width: 700px) { .cmp { width: auto; } .cmp-hero b { font-size: 22px; } .cmp-row { grid-template-columns: 44px 1fr 62px 62px; } }
      `}</style>
    </section>
  )
}

export default { id: 'compute', slot: 'bottomRight', order: 40, modes: ['overview'], Component: Compute }
