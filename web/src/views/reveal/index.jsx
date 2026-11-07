import { useEffect, useRef, useState } from 'react'
import { area, line, curveMonotoneX } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import { Icon } from '../../shell/icons.jsx'
import sample from './sample.json'
import { Verify } from '../../panels/verify/index.jsx'

const NAMES = { GB: 'Great Britain', FR: 'France', 'DE-LU': 'Germany–Lux.', NL: 'Netherlands', BE: 'Belgium', NO2: 'Southern Norway' }
const FREEZE = '2026-11-07T23:59:00Z'
const W = 320
const H = 120

async function fetchReveal() {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const r = await fetch('/api/reveal', { signal: ctrl.signal })
    if (r.status === 404) return { pending: true, detail: (await r.json().catch(() => ({}))).detail }
    return r.ok ? await r.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function useCountdown(iso) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const s = Math.max(0, Math.floor((Date.parse(iso) - now) / 1000))
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function ZoneCard({ z, fresh }) {
  const hrs = z.hours ?? []
  const vals = hrs.flatMap((h) => [h.p10, h.p90, h.actual]).filter((v) => v != null)
  const x = scaleLinear().domain([0, Math.max(1, hrs.length - 1)]).range([8, W - 8])
  const y = scaleLinear().domain(vals.length ? [Math.min(...vals) * 0.9, Math.max(...vals) * 1.05] : [0, 1]).range([H - 8, 8])
  const band = area().x((_, i) => x(i)).y0((h) => y(h.p10)).y1((h) => y(h.p90)).curve(curveMonotoneX)(hrs)
  const med = line().x((_, i) => x(i)).y((h) => y(h.p50)).curve(curveMonotoneX)(hrs)
  const cur = z.currency === 'GBP' ? '£' : '€'
  return (
    <article className={`rv-card ${z.published ? 'pub' : ''} ${fresh ? 'fresh' : ''}`}>
      <div className="rv-head">
        <b>{NAMES[z.zone] ?? z.zone}</b>
        <span className={`tag ${z.published ? 'accent' : ''}`}>{z.published ? 'Result in' : 'Waiting for auction'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-label={`${z.zone} frozen forecast against the auction result`}>
        <path d={band} fill="var(--accent)" opacity=".16" />
        <path d={med} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="4 3" />
        {hrs.map((h, i) =>
          h.actual != null ? (
            <circle key={h.ts} cx={x(i)} cy={y(h.actual)} r="3.2" className="rv-dot" style={{ animationDelay: `${i * 40}ms` }}
              fill={h.actual >= h.p10 && h.actual <= h.p90 ? 'var(--text)' : 'var(--hot)'} />
          ) : null,
        )}
      </svg>
      <div className="rv-foot">
        {z.published ? (
          <>
            <span>Average error <b className="num">{cur}{z.mae?.toFixed(1)}</b></span>
            <span>Inside band <b className="num">{Math.round((z.inside_band_share ?? 0) * 100)}%</b></span>
          </>
        ) : (
          <span className="faint">Frozen P50 range {cur}{Math.min(...hrs.map((h) => h.p50)).toFixed(0)}–{cur}{Math.max(...hrs.map((h) => h.p50)).toFixed(0)}</span>
        )}
      </div>
    </article>
  )
}

function Reveal() {
  const [d, setD] = useState(undefined)
  const [preview, setPreview] = useState(false)
  const seen = useRef(new Set())
  const [fresh, setFresh] = useState(new Set())
  const countdown = useCountdown(FREEZE)

  useEffect(() => {
    let live = true
    const tick = () =>
      fetchReveal().then((r) => {
        if (!live) return
        if (r?.zones) {
          const nowPub = new Set(r.zones.filter((z) => z.published).map((z) => z.zone))
          const newly = [...nowPub].filter((z) => !seen.current.has(z))
          if (seen.current.size || d) setFresh(new Set(newly))
          nowPub.forEach((z) => seen.current.add(z))
        }
        setD(r)
      })
    tick()
    // Results land 10:00 (GB) and ~11:55-12:10 (continent) UK time on Sunday; poll every 30 s.
    const id = setInterval(tick, 30_000)
    return () => ((live = false), clearInterval(id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const data = preview ? sample : d?.zones ? d : null
  const frozen = data?.frozen_at ? new Date(data.frozen_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : null

  return (
    <div className="rv">
      <header className="rv-top">
        <a href="#/" className="rv-back" aria-label="Back to the map"><Icon name="back" /></a>
        <div style={{ flex: 1 }}>
          <div className="rv-kicker">Day-ahead reveal</div>
          <h1>Monday’s forecast, frozen before the auction</h1>
          <p>We froze a forecast for every zone before Sunday’s day-ahead auction. As each result is published, it lands on the frozen band.</p>
        </div>
        {data && (
          <div className="rv-sum">
            <div><span>Frozen</span><b className="num">{frozen} UTC</b></div>
            <div><span>Zones in</span><b className="num">{data.zones_published} of {data.zones.length}</b></div>
            <div><span>Mean error</span><b className="num">{data.mean_abs_error != null ? data.mean_abs_error.toFixed(1) : '—'}</b></div>
            <div><span>Inside band</span><b className="num">{data.zones_inside_band ?? 0}</b></div>
          </div>
        )}
      </header>

      {preview && <div className="rv-banner">Sample data (engine contract fixture) — not today’s forecast. <button onClick={() => setPreview(false)}>Back to live</button></div>}

      {!data && d?.pending && (
        <section className="rv-wait">
          <div className="rv-clock num">{countdown}</div>
          <p>until the forecast freezes at 23:59 UTC on Saturday. GB’s result arrives about 10:00 on Sunday, the continent’s about noon.</p>
          <button onClick={() => setPreview(true)}>Preview with sample data</button>
        </section>
      )}
      {d === undefined && !preview && <p className="faint">Loading…</p>}
      {d === null && !preview && <p className="faint">The reveal isn’t reachable right now.</p>}

      {data && (
        <div className="rv-grid">
          {data.zones.map((z) => <ZoneCard key={z.zone} z={z} fresh={fresh.has(z.zone)} />)}
        </div>
      )}
      <div className="rv-legend"><span><i className="b" />Frozen P10–P90</span><span><i className="m" />Frozen P50</span><span><i className="d" />Result inside band</span><span><i className="h" />Outside band</span></div>
      <Verify />
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
body { overflow: auto; }
.rv { max-width: 1280px; margin: 0 auto; padding: 28px 24px 40px; }
.rv-top { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap; }
.rv-back { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--card); color: var(--text); flex: none; }
.rv-kicker { font-size: 12px; color: var(--accent); font-weight: 600; }
.rv h1 { margin: 4px 0 6px; font-size: 30px; letter-spacing: -0.02em; }
.rv-top p { margin: 0; color: var(--text-2); max-width: 680px; }
.rv-sum { display: grid; grid-template-columns: repeat(4, auto); gap: 18px; background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px 18px; }
.rv-sum span { display: block; font-size: 12px; color: var(--text-3); }
.rv-sum b { font-size: 22px; font-weight: 600; }
.rv-banner { background: var(--hot-dim); color: var(--hot); border-radius: 12px; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; }
.rv-banner button, .rv-wait button { margin-left: 8px; color: var(--text); text-decoration: underline; }
.rv-wait { text-align: center; padding: 50px 20px; background: var(--panel-solid); border: 1px solid var(--line); border-radius: 24px; margin-bottom: 16px; }
.rv-clock { font-size: 64px; font-weight: 700; color: var(--accent); letter-spacing: -0.03em; }
.rv-wait p { color: var(--text-2); max-width: 520px; margin: 8px auto 16px; }
.rv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.rv-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px; transition: border-color .4s, box-shadow .4s; }
.rv-card.pub { border-color: rgba(197,240,107,.3); }
.rv-card.fresh { box-shadow: 0 0 0 2px var(--accent), 0 0 40px rgba(197,240,107,.3); }
.rv-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.rv-foot { display: flex; gap: 16px; font-size: 12px; color: var(--text-2); margin-top: 4px; }
.rv-foot b { color: var(--text); font-size: 14px; margin-left: 4px; }
.rv-dot { animation: rvland .5s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes rvland { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: none; } }
.rv-legend { display: flex; gap: 16px; font-size: 12px; color: var(--text-2); margin-top: 14px; flex-wrap: wrap; }
.rv-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.rv-legend .b { background: rgba(197,240,107,.25); } .rv-legend .m { background: var(--accent); height: 2px; }
.rv-legend .d { background: var(--text); border-radius: 50%; } .rv-legend .h { background: var(--hot); border-radius: 50%; }
`

export default { path: '/reveal', title: 'Day-ahead reveal', Component: Reveal }
