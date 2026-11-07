import { useEffect, useState, useSyncExternalStore } from 'react'
import { SUN_STOPS } from '../../layers/solar/index.js'
import { WIND_STOPS } from '../../layers/wind/index.js'
import { getField, hourKey, status, subscribe, version } from '../../layers/wind/grid.js'
import { effectLine, spark, weatherAt } from './model.js'

// Side card for the wind and sun layers: the modelled weather at the selected zone, its wind and solar share of
// generation now, and what wind and sun did to the price (the engine's estimated merit-order effect). Only shown while
// either layer is on. Weather is Open-Meteo model output, the price effect an estimate; both are labelled.
const cache = new Map()
async function loadImpact(zone) {
  if (cache.has(zone) && Date.now() - cache.get(zone).at < 5 * 60e3) return cache.get(zone).data
  try {
    const r = await fetch(`/api/impact/renewables?zone=${zone}`)
    const data = r.ok ? await r.json() : null
    cache.set(zone, { at: Date.now(), data })
    return data
  } catch {
    return null
  }
}

const hhmm = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
const grad = (stops, max) => `linear-gradient(90deg, ${stops.map(([v, c]) => `rgb(${c}) ${(v / max) * 100}%`).join(', ')})`

function Renewables({ ctx }) {
  const wind = ctx.ui.layers?.wind === true
  const sun = ctx.ui.layers?.solar === true
  const zone = ctx.ui.selectedZone
  useSyncExternalStore(subscribe, version)
  const [impact, setImpact] = useState(undefined)
  useEffect(() => {
    if (!wind && !sun) return undefined
    let live = true
    setImpact(undefined)
    loadImpact(zone).then((d) => live && setImpact(d))
    return () => (live = false)
  }, [zone, wind, sun])
  if (!wind && !sun) return null

  const field = getField(ctx.ui.at)
  const z = ctx.zoneById?.[zone]
  const w = weatherAt(field, z?.centroid)
  const mix = ctx.stateByZone?.[zone]?.mix ?? {}
  const synthetic = field?.kind === 'synthetic'
  const kinds = [wind && 'wind', sun && 'solar'].filter(Boolean)
  const lines = kinds.map((k) => effectLine(impact, k)).filter(Boolean)
  const sp = spark(impact?.hours, ctx.ui.at ?? null)
  const st = status(ctx.ui.at)
  return (
    <section className="panel rn fade-in" aria-label="Wind and sun">
      <div className="rn-head">
        <b>{wind && sun ? 'Wind and sun' : wind ? 'Wind' : 'Sunshine'} · {z?.name ?? zone}</b>
        <span className={`tag ${synthetic ? 'hot' : ''}`}>{synthetic ? 'Placeholder data' : 'Modelled'}</span>
      </div>
      <div className="rn-sub faint">{field ? hhmm(field.ts) + ' UTC' : st === 'none' ? 'No weather for this hour' : 'Loading weather…'}</div>

      {w && (
        <div className="rn-now">
          {wind && <div><span className="rn-l">Wind at 100 m</span><b className="num">{w.speed.toFixed(1)} m/s</b><span className="rn-s">from the {w.from}</span></div>}
          {sun && <div><span className="rn-l">Sunshine</span><b className="num">{w.sun == null ? '—' : `${Math.round(w.sun)} W/m²`}</b><span className="rn-s">{w.sun != null && w.sun < 5 ? 'dark' : 'modelled'}</span></div>}
          {wind && mix.wind != null && <div><span className="rn-l">Wind share of generation</span><b className="num">{Math.round(mix.wind * 100)}%</b></div>}
          {sun && mix.solar != null && <div><span className="rn-l">Solar share of generation</span><b className="num">{Math.round(mix.solar * 100)}%</b></div>}
        </div>
      )}
      {!w && field && <div className="rn-sub faint">No weather points near {z?.name ?? zone}.</div>}

      <div className="rn-legend">
        {wind && <div><div className="rn-bar" style={{ background: grad(WIND_STOPS, 20) }} /><div className="rn-ticks faint"><span>calm</span><span>12 m/s</span><span>20+</span></div></div>}
        {sun && <div><div className="rn-bar" style={{ background: grad(SUN_STOPS, 900) }} /><div className="rn-ticks faint"><span>low sun</span><span>300</span><span>900 W/m²</span></div></div>}
      </div>

      <div className="rn-price">
        <div className="rn-ph">What it did to the price <span className="faint">(estimate)</span></div>
        {impact === undefined && <div className="faint">Loading…</div>}
        {impact === null && <div className="faint">No price-effect estimate for {z?.name ?? zone} yet.</div>}
        {lines.map((l, i) => (
          <div key={i} className="rn-line"><b>{l.text}</b><span className="faint">{[l.perGw, l.total].filter(Boolean).join(' · ')}</span></div>
        ))}
        {impact && !lines.length && <div className="faint">{kinds.includes('solar') && !kinds.includes('wind') ? 'No solar data for this zone, so no solar estimate.' : 'No estimate for this window.'}</div>}
        {sp && (
          <svg viewBox={`0 0 ${sp.w} ${sp.h}`} width="100%" role="img" aria-label="Price over the last 24 hours with wind output behind it">
            {sp.bars.map((b, i) => <rect key={i} x={b.x - 3} y={sp.h - b.h} width="6" height={b.h} fill="rgb(96 176 220)" opacity=".28" />)}
            <path d={sp.line} fill="none" stroke="var(--text)" strokeWidth="1.8" strokeLinejoin="round" />
            {sp.marker != null && <line x1={sp.marker} x2={sp.marker} y1="0" y2={sp.h} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 3" />}
          </svg>
        )}
        {sp && <div className="rn-cap faint">Line: price. Bars: wind output. {impact?.currency === 'GBP' ? '£' : '€'}{Math.round(sp.lo)} to {Math.round(sp.hi)}/MWh.</div>}
      </div>

      <p className="rn-note faint">
        {synthetic ? field.note : 'Weather is modelled (Open-Meteo analysis and forecast), not measured.'} The price effect is an estimate from past hours
        (how price moved with wind output), not a market simulation.
      </p>
      <style>{CSS}</style>
    </section>
  )
}

const CSS = `
.rn { width: 560px; padding: 14px 18px; }
.rn-head { display: flex; justify-content: space-between; align-items: center; }
.rn-sub { font-size: 12px; margin: 2px 0 8px; }
.rn-now { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px 14px; margin-bottom: 10px; }
.rn-now > div { display: flex; flex-direction: column; }
.rn-l { font-size: 11px; color: var(--text-3); } .rn-now b { font-size: 20px; } .rn-s { font-size: 11px; color: var(--text-2); }
.rn-legend { display: grid; gap: 8px; margin: 6px 0 10px; }
.rn-bar { height: 8px; border-radius: 4px; }
.rn-ticks { display: flex; justify-content: space-between; font-size: 10px; margin-top: 2px; }
.rn-ph { font-weight: 600; margin-bottom: 4px; font-size: 13px; }
.rn-line { display: flex; flex-direction: column; font-size: 13px; margin-bottom: 4px; } .rn-line span { font-size: 11px; }
.rn-cap { font-size: 11px; margin-top: 2px; }
.rn-note { font-size: 11px; line-height: 1.45; margin: 8px 0 0; }
@media (max-width: 700px) { .rn { width: auto; } }
`

export default { id: 'renewables', slot: 'bottomRight', order: 12, modes: ['overview'], Component: Renewables }
