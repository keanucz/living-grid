import { useEffect, useMemo, useState } from 'react'
import { area, line, curveMonotoneX } from 'd3-shape'
import { scaleLinear, scaleUtc } from 'd3-scale'
import { Icon } from '../../shell/icons.jsx'
import { api, useApi } from '../../api/client.js'
import { fmt } from '../../styles/tokens.js'
import { useStore } from '../../store/store.js'
import Movie from '../events/Movie.jsx'
import { ReplayMap } from './ReplayMap.jsx'
import { Readout } from './Readout.jsx'
import { SPEEDS, atIndex, iso, usePlayhead, useReplayShell, windowFor } from './playhead.js'
import { daysAround, useDayStates, useDayWind, useMapState } from './useMapState.js'

// Replay: the map plays a day with the data, the chart and the readout follow the same playhead (the shared ui.at, which
// the history scrubber also moves). The default is the 26 October storm with the as-of forecast; every event in the
// library plays the same way, with its own series in place of the forecast chart.
const DEFAULT_DAY = ['2026-10-26T00:00:00Z', '2026-10-26T23:00:00Z']
const W = 900
const H = 300
const P = { l: 52, r: 16, t: 16, b: 30 }
const TARGET_LABEL = { gb_system_price: 'GB system price', price_da: 'Day-ahead price' }
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

// Short chip labels for the library's events; anything new falls back to its own title.
const SHORT = { storm: '26 Oct storm', dunkelflaute: 'Dark lull', 'sunny-weekend': 'Sunny weekend', 'record-wind': 'Windiest day', 'cable-out': 'Cable quiet', 'price-spike': 'Price spike', 'gas-crisis': '2022 gas crisis' }

const eventFiles = import.meta.glob('../../../../data/events/*.json')
const loadEvent = (slug) => eventFiles[`../../../../data/events/${slug}.json`]?.().then((m) => m.default ?? m)

function useEvents() {
  const [events, setEvents] = useState(null)
  useEffect(() => {
    loadEvent('index').then((i) => setEvents(i.events)).catch(() => setEvents([]))
  }, [])
  return events
}

function useGhostWind(from, at, playing, i, on = true) {
  const [mwh, setMwh] = useState(null)
  useEffect(() => {
    if (!on || (playing && i % 3 !== 0)) return undefined
    let live = true
    const t = setTimeout(() => {
      api.ghostWind(from, at).then((r) => live && setMwh(r?.data?.total_boalf_mwh ?? null)).catch(() => live && setMwh(null))
    }, playing ? 0 : 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [from, at, playing, i, on])
  return mwh
}

// Event series up to the playhead, one small chart each with its value now.
function EventSeries({ ev, at }) {
  const t = Date.parse(at)
  const COL = ['var(--hot)', 'var(--accent)', 'var(--text)', 'var(--text-2)']
  return (
    <div className="rp-evs">
      {(ev?.series ?? []).map((s, k) => {
        const pts = s.points.map(([ts, v]) => [Date.parse(ts), v])
        const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]))
        const x = scaleLinear().domain([pts[0][0], pts.at(-1)[0]]).range([4, 296])
        const y = scaleLinear().domain([lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.08 || 1]).range([54, 4])
        const upto = pts.filter((p) => p[0] <= t)
        const d = line().x((p) => x(p[0])).y((p) => y(p[1])).curve(curveMonotoneX)
        const last = upto.at(-1)
        return (
          <div key={s.label} className="rp-ev">
            <div className="rp-ev-h"><span>{s.label}</span><b className="num">{last ? `${Math.abs(last[1]) >= 100 ? Math.round(last[1]).toLocaleString('en-GB') : last[1].toFixed(1)} ${s.unit}` : '—'}</b></div>
            <svg viewBox="0 0 300 58" width="100%" role="img" aria-label={`${s.label} through the event`}>
              <path d={d(pts)} fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
              {upto.length > 1 && <path d={d(upto)} fill="none" stroke={COL[k % COL.length]} strokeWidth="2.4" />}
              {last && <circle cx={x(last[0])} cy={y(last[1])} r="3.6" fill={COL[k % COL.length]} />}
            </svg>
          </div>
        )
      })}
    </div>
  )
}

function Replay() {
  useReplayShell()
  const events = useEvents()
  const [mode, setMode] = useState('forecast')
  const [slug, setSlug] = useState('storm')
  const [key, setKey] = useState('GB|price_da')
  const [replay, setReplay] = useState(undefined)
  const [evData, setEvData] = useState(null)
  const zones = useApi(api.zones)
  const ev = events?.find((e) => e.slug === slug)
  const isStorm = slug === 'storm'

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 20000)
    fetch('/api/replay?event=2026-10-26', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(setReplay)
      .finally(() => clearTimeout(t))
  }, [])
  useEffect(() => {
    setEvData(null)
    if (slug && !isStorm) loadEvent(slug).then(setEvData).catch(() => setEvData(null))
  }, [slug, isStorm])

  const win = useMemo(() => {
    if (isStorm || !ev) {
      const pts = replay?.series?.[0]?.points
      return windowFor(pts?.[0]?.ts ?? DEFAULT_DAY[0], pts?.at(-1)?.ts ?? DEFAULT_DAY[1])
    }
    return windowFor(ev.start, ev.end)
  }, [isStorm, ev, replay])
  // The day's hours come in one /state/day request; the playhead waits for an hour that has not arrived yet.
  const at0 = useStore((st) => st.at) ?? atIndex(win, 0)
  const dayData = useDayStates(daysAround(at0, win.stepH))
  const dayOfIso = (t) => t.slice(0, 10)
  const ready = (t) => Boolean(dayData.hours[t]) || Boolean(dayData.failed[dayOfIso(t)])
  const ph = usePlayhead(win, ready)
  const map = useMapState(ph.at, dayData.hours, Boolean(dayData.failed[dayOfIso(ph.at)]))
  const dayWind = useDayWind(ph.at)
  const eventWind = useGhostWind(iso(win.start), ph.at, ph.playing, ph.i, !isStorm)
  const wind = isStorm ? dayWind : eventWind

  const s = replay?.series?.find((x) => `${x.zone}|${x.target}` === key) ?? replay?.series?.[0]
  const pts = s?.points ?? []
  const cur = isStorm ? pts[Math.min(ph.i, pts.length - 1)] : null
  const shown = pts.slice(0, ph.i + 1)
  const unit = s?.unit?.startsWith('GBP') ? '£' : '€'
  const explanation = useMemo(() => {
    const p = [...shown].reverse().find((x) => x.explanation)
    const e = p?.explanation
    return e ? `${typeof e === 'string' ? e : e.sentence} (for ${hhmm(p.ts)} UTC)` : null
  }, [shown.length, replay]) // eslint-disable-line react-hooks/exhaustive-deps

  const { x, y } = useMemo(() => {
    const vals = pts.flatMap((p) => [p.actual, p.p10, p.p90]).filter((v) => v != null)
    return {
      x: scaleUtc().domain([Date.parse(pts[0]?.ts ?? 0), Date.parse(pts.at(-1)?.ts ?? 1)]).range([P.l, W - P.r]),
      y: scaleLinear().domain(vals.length ? [Math.min(0, ...vals), Math.max(...vals) * 1.05] : [0, 100]).nice(5).range([H - P.b, P.t]),
    }
  }, [pts])
  const tx = (p) => x(Date.parse(p.ts))
  const band = area().x(tx).y0((p) => y(p.p10)).y1((p) => y(p.p90)).curve(curveMonotoneX)(pts)
  const med = line().x(tx).y((p) => y(p.p50)).curve(curveMonotoneX)(pts)
  const act = line().x(tx).y((p) => y(p.actual)).curve(curveMonotoneX)(shown.filter((p) => p.actual != null))
  const inBand = shown.filter((p) => p.actual != null && p.actual >= p.p10 && p.actual <= p.p90).length

  return (
    <div className="rp">
      <header className="rp-top">
        <a href="#/" className="rp-back" aria-label="Back to the map"><Icon name="back" /></a>
        <div>
          <div className="rp-kicker">{mode === 'movies' ? 'Event movies' : 'Replay'}</div>
          <h1>{mode === 'movies' ? 'The big days in our data' : isStorm ? (replay?.title ?? 'The 26 October storm') : (ev?.title ?? 'Replay')}</h1>
          <p>{mode === 'movies'
            ? 'Each movie plays an event from public data, with the moments that mattered and a plain-English script.'
            : isStorm
              ? `Would we have seen it coming? The map plays the day; forecasts come from a model trained only on data before ${replay?.trained_before ?? '2026-10-26'}, made 12 hours ahead.`
              : `${ev?.headline ?? ''} The map plays ${ev ? `${day(ev.start)} to ${day(ev.end)}` : 'the event'} from public data.`}</p>
        </div>
      </header>

      <div className="rp-tabs rp-mode" role="tablist" aria-label="Replay views">
        <button role="tab" aria-selected={mode === 'forecast'} className={mode === 'forecast' ? 'on' : ''} onClick={() => setMode('forecast')}>Play on the map</button>
        <button role="tab" aria-selected={mode === 'movies'} className={mode === 'movies' ? 'on' : ''} onClick={() => setMode('movies')}>Event movies</button>
      </div>

      {mode === 'movies' && <Movie onOpenReplay={() => setMode('forecast')} />}

      {mode === 'forecast' && (
        <>
          {events?.length > 0 && (
            <div className="rp-tabs rp-days" role="tablist" aria-label="Day to replay">
              {events.map((e) => <button key={e.slug} role="tab" aria-selected={e.slug === slug} className={e.slug === slug ? 'on' : ''} onClick={() => setSlug(e.slug)}>{SHORT[e.slug] ?? e.title}</button>)}
            </div>
          )}

          <div className="rp-grid">
            <div className="rp-main">
              <ReplayMap state={map.data} />
              <div className="rp-controls">
                <button className="rp-play" onClick={ph.toggle}>
                  {!ph.playing && <Icon name="play" size={14} fill="currentColor" />} {ph.playing ? 'Pause' : ph.i >= ph.n - 1 ? 'Play again' : ph.i > 0 ? 'Resume' : 'Play the day'}
                </button>
                <div className="rp-speed" role="group" aria-label="Speed">
                  {SPEEDS.map((v) => <button key={v} className={ph.speed === v ? 'on' : ''} onClick={() => ph.setSpeed(v)}>{v}×</button>)}
                </div>
                <span className="rp-time num">{ph.at.slice(5, 16).replace('T', ' ')} UTC</span>
              </div>
              <input className="rp-slider" type="range" min={0} max={Math.max(0, ph.n - 1)} value={ph.i} onChange={(e) => ph.seek(+e.target.value)} aria-label="Playhead" />

              {isStorm && s && (
                <section className="rp-chart">
                  <div className="rp-tabs rp-series">
                    {replay.series.map((q) => {
                      const k = `${q.zone}|${q.target}`
                      return <button key={k} className={k === `${s.zone}|${s.target}` ? 'on' : ''} onClick={() => setKey(k)}>{q.zone} <span>{TARGET_LABEL[q.target] ?? q.target}</span></button>
                    })}
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Actual price against forecast band through the day">
                    {y.ticks(5).map((v) => (
                      <g key={v}>
                        <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                        <text x={P.l - 8} y={y(v) + 4} textAnchor="end" className="rp-tick">{unit}{v}</text>
                      </g>
                    ))}
                    {pts.filter((_, k) => k % 3 === 0).map((p) => <text key={p.ts} x={tx(p)} y={H - 8} textAnchor="middle" className="rp-tick">{hhmm(p.ts)}</text>)}
                    <path d={band} fill="var(--accent)" opacity="0.14" />
                    <path d={med} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" />
                    {act && <path d={act} fill="none" stroke="var(--text)" strokeWidth="2.6" />}
                    {cur && <line x1={tx(cur)} x2={tx(cur)} y1={P.t} y2={H - P.b} stroke="var(--hot)" strokeWidth="1.5" />}
                    {cur?.actual != null && <circle cx={tx(cur)} cy={y(cur.actual)} r="5" fill="var(--text)" stroke="var(--bg)" strokeWidth="2" />}
                  </svg>
                  <div className="rp-legend"><span><i style={{ background: 'var(--text)' }} />What happened</span><span><i style={{ background: 'var(--accent)' }} />Forecast P50, P10–P90 band</span><span>{inBand} of {shown.filter((p) => p.actual != null).length} hours inside the band</span></div>
                </section>
              )}
              {isStorm && replay === undefined && <p className="rp-muted">Loading the forecast…</p>}
              {isStorm && replay === null && <p className="rp-muted">The forecast replay isn’t available right now; the map still plays.</p>}
              {!isStorm && (evData ? <EventSeries ev={evData} at={ph.at} /> : <p className="rp-muted">Loading the event…</p>)}
              {!isStorm && ev && !ev.replay_available && <p className="rp-foot">No as-of forecast was made for this event, so there is no forecast band, only what happened.</p>}
            </div>

            <Readout
              at={ph.at}
              state={map.data}
              stateAt={map.at}
              loading={map.loading}
              missing={map.missing}
              replay={isStorm ? replay : null}
              interconnectors={zones.data?.interconnectors}
              wind={wind}
              explanation={isStorm ? explanation : null}
              events={isStorm && replay?.constraint_cost_gbp ? <div className="rp-stat"><span>GB constraint bill that day</span><b className="num">{fmt.money(replay.constraint_cost_gbp)}</b></div> : null}
            />
          </div>
          {isStorm && replay?.summary && <p className="rp-sum">{replay.summary}</p>}
        </>
      )}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
body { overflow: auto; }
.rp { max-width: 1280px; margin: 0 auto; padding: 28px 24px 40px; }
.rp-top { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 20px; }
.rp-back { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--card); color: var(--text); flex: none; }
.rp-kicker { font-size: 12px; color: var(--accent); font-weight: 600; letter-spacing: .02em; }
.rp h1 { margin: 4px 0 6px; font-size: 30px; letter-spacing: -0.02em; }
.rp-top p { margin: 0; color: var(--text-2); max-width: 720px; }
.rp-controls { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 14px; }
.rp-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.rp-tabs button { padding: 8px 12px; border-radius: 999px; background: var(--card); color: var(--text-2); font-weight: 600; font-size: 13px; }
.rp-tabs button span { font-weight: 400; color: var(--text-3); margin-left: 4px; }
.rp-tabs button.on { background: var(--accent-dim); color: var(--accent); }
.rp-play { height: 42px; padding: 0 18px; border-radius: 999px; background: var(--hot); color: #1b0d00; font-weight: 700; display: inline-flex; gap: 8px; align-items: center; }
.rp-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
@media (max-width: 900px) { .rp-grid { grid-template-columns: 1fr; } }
.rp-chart, .rp-side { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 16px; }
.rp-chart input { width: 100%; margin-top: 8px; accent-color: var(--hot); }
.rp-tick { font-size: 12px; fill: var(--text-3); font-variant-numeric: tabular-nums; }
.rp-legend { display: flex; gap: 16px; font-size: 12px; color: var(--text-2); margin-top: 6px; }
.rp-legend i { display: inline-block; width: 12px; height: 3px; margin-right: 6px; vertical-align: middle; }
.rp-side { display: flex; flex-direction: column; gap: 14px; }
.rp-stat span, .rp-why span { font-size: 12px; color: var(--text-3); }
.rp-stat b { display: block; font-size: 24px; font-weight: 600; margin-top: 2px; }
.rp-stat small { font-size: 13px; color: var(--accent); font-weight: 500; }
.rp-why p { margin: 4px 0 0; line-height: 1.45; }
.rp-sum { font-size: 12px; color: var(--text-3); line-height: 1.5; margin: 0; }
.rp-muted { color: var(--text-2); }
.rp-mode { margin-bottom: 16px; }
.rp-main { display: grid; gap: 12px; min-width: 0; }
.rp-map { position: relative; height: 440px; border-radius: 20px; overflow: hidden; border: 1px solid var(--line); background: var(--bg-2); }
.rp-days { margin-bottom: 12px; }
.rp-speed { display: flex; gap: 4px; } .rp-speed button { min-width: 40px; height: 34px; border-radius: 999px; background: var(--card); color: var(--text-2); font-weight: 600; font-size: 13px; } .rp-speed button.on { background: var(--accent-dim); color: var(--accent); }
.rp-time { margin-left: auto; color: var(--text-2); font-size: 13px; }
.rp-controls { margin: 0; }
.rp-slider { width: 100%; accent-color: var(--hot); margin: 0; }
.rp-series { margin-bottom: 8px; }
.rp-zones { width: 100%; border-collapse: collapse; font-size: 13px; } .rp-zones th { text-align: left; font-weight: 500; color: var(--text-3); font-size: 11px; padding: 0 0 4px; } .rp-zones td { padding: 5px 0; border-top: 1px solid var(--line); } .rp-zones td.num { text-align: left; }
.rp-zones i { font-style: normal; font-weight: 700; margin-left: 4px; } .rp-zones i.in { color: #8fd16a; } .rp-zones i.out { color: var(--hot); }
.rp-foot { font-size: 11px; color: var(--text-3); line-height: 1.45; margin: 0; }
.rp-load, .rp-miss { display: block; font-size: 11px; color: var(--text-3); margin-top: 2px; } .rp-miss { color: var(--hot); }
.rp-stat small { display: block; font-size: 11px; color: var(--text-3); font-weight: 400; margin-top: 2px; }
.rp-stat b { font-size: 20px; }
.rp-evs { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
.rp-ev { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 16px; padding: 10px 12px; } .rp-ev-h { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-2); } .rp-ev-h b { color: var(--text); }
@media (max-width: 900px) { .rp-series button { padding: 6px 10px; font-size: 12px; } .rp-series button span { display: none; } .rp-map { height: 300px; } .rp { padding: 16px 14px 90px; } .rp h1 { font-size: 22px; } .rp-time { width: 100%; margin: 0; } }
`

export default { path: '/replay', title: 'Replay', Component: Replay }
