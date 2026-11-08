import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { actions } from '../../store/store.js'
import { DAY, HISTORY_START, HOUR, ZOOMS, loadTimeline, windowFor } from './timeline.js'

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z')
const floorH = (ms) => Math.floor(ms / HOUR) * HOUR
const SPEEDS = [1, 10, 60]
const STRIP_W = 600
const STRIP_H = 56
const PROXY_UNTIL = Date.parse('2026-09-08T00:00:00Z')

const fmt = (ms, withHour = true) =>
  new Date(ms).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', ...(withHour ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'UTC',
  })

function Scrubber({ ctx }) {
  const nowH = floorH(Date.now())
  const maxMs = nowH + 2 * DAY
  const atMs = ctx.ui.at ? Date.parse(ctx.ui.at) : nowH
  const [zoomId, setZoomId] = useState('2d')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [drag, setDrag] = useState(null)
  const [daily, setDaily] = useState(null)
  const [hourly, setHourly] = useState(null)
  const stripRef = useRef(null)
  const zoom = ZOOMS.find((z) => z.id === zoomId)
  const shown = drag ?? atMs
  const [lo, hi] = windowFor(zoom, nowH, shown)

  const commit = useCallback(
    (ms) => {
      const v = Math.min(maxMs, Math.max(HISTORY_START, floorH(ms)))
      actions.setAt(v === nowH ? null : iso(v))
    },
    [maxMs, nowH],
  )

  useEffect(() => {
    let live = true
    loadTimeline(HISTORY_START, nowH, 'day').then((t) => live && setDaily(t))
    return () => { live = false }
  }, [nowH])
  useEffect(() => {
    if (zoom.step !== 'hour') return setHourly(null)
    let live = true
    loadTimeline(lo, hi, 'hour').then((t) => live && setHourly(t))
    return () => { live = false }
  }, [zoom.step, lo, hi])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      const cur = ctx.ui.at ? Date.parse(ctx.ui.at) : nowH
      if (cur >= nowH) return setPlaying(false)
      commit(Math.min(nowH, cur + speed * HOUR))
    }, 1000)
    return () => clearInterval(id)
  }, [playing, speed, ctx.ui.at, nowH, commit])

  const series = zoom.step === 'hour' ? hourly : daily
  const gb = series?.zones?.GB
  const events = daily?.events ?? []

  const geom = useMemo(() => {
    const x = (ms) => ((ms - lo) / (hi - lo)) * STRIP_W
    if (!series || !gb) return { x, price: '', wind: '' }
    const pts = series.ms.map((m, i) => ({ m, p: gb.price[i], w: gb.wind_share[i] })).filter((d) => d.m >= lo && d.m <= hi)
    const ps = pts.map((d) => d.p).filter((v) => v != null)
    const [pmin, pmax] = [Math.min(...ps, 0), Math.max(...ps, 1)]
    const y = (p) => STRIP_H - 4 - ((p - pmin) / (pmax - pmin || 1)) * (STRIP_H - 10)
    const line = (key, f) => {
      let d = ''
      let up = true
      for (const pt of pts) {
        if (pt[key] == null) { up = true; continue }
        d += `${up ? 'M' : 'L'}${x(pt.m).toFixed(1)},${f(pt[key]).toFixed(1)}`
        up = false
      }
      return d
    }
    const band = pts.filter((d) => d.w != null)
    const wind = band.length
      ? `M${x(band[0].m)},${STRIP_H} ` + band.map((d) => `L${x(d.m).toFixed(1)},${(STRIP_H - d.w * (STRIP_H - 6)).toFixed(1)}`).join(' ') + ` L${x(band.at(-1).m)},${STRIP_H} Z`
      : ''
    return { x, price: line('p', y), wind }
  }, [series, gb, lo, hi])

  const msFromPointer = (e) => {
    const r = stripRef.current.getBoundingClientRect()
    return lo + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (hi - lo)
  }
  const onKey = (e) => {
    const big = e.shiftKey ? 24 : 1
    const moves = { ArrowLeft: -big * HOUR, ArrowDown: -big * HOUR, ArrowRight: big * HOUR, ArrowUp: big * HOUR, PageDown: -7 * DAY, PageUp: 7 * DAY }
    if (e.key in moves) { e.preventDefault(); commit(atMs + moves[e.key]) }
    else if (e.key === 'Home') { e.preventDefault(); commit(HISTORY_START) }
    else if (e.key === 'End') { e.preventDefault(); commit(nowH) }
    else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
  }

  const rel = Math.round((atMs - nowH) / HOUR)
  const kind = rel > 0 ? 'Forecast' : rel < 0 ? 'Past' : 'Live'
  const here = events.find((ev) => atMs >= Date.parse(ev.start) && atMs <= Date.parse(ev.end))
  const prices = Object.values(ctx.stateByZone ?? {})
  const noData = ctx.ui.at && rel <= 0 && prices.length > 0 && !prices.some((z) => z.price_eur != null)
  const proxyGb = rel < 0 && atMs < PROXY_UNTIL

  return (
    <section className="panel scrubber fade-in" onKeyDown={onKey}>
      <div className="scrub-head">
        <span className={`tag ${rel > 0 ? 'accent' : ''}`}>{kind}</span>
        <b className="num">{rel === 0 ? 'Now' : fmt(shown)}</b>
        {rel !== 0 && <span className="faint num">{rel > 0 ? `+${rel} h` : rel > -48 ? `${rel} h` : `${Math.round(-rel / 24)} days ago`}</span>}
        <span style={{ flex: 1 }} />
        <input
          type="date" className="scrub-date" aria-label="Jump to date"
          min="2024-01-01" max={iso(maxMs).slice(0, 10)} value={iso(shown).slice(0, 10)}
          onChange={(e) => e.target.value && commit(Date.parse(`${e.target.value}T12:00:00Z`))}
        />
        <button className="scrub-live" disabled={rel === 0} onClick={() => (setPlaying(false), setZoomId('2d'), actions.setAt(null))}>Live</button>
      </div>

      <div className="scrub-strip" ref={stripRef} tabIndex={0} role="slider" aria-label="Time"
        aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={shown} aria-valuetext={fmt(shown)}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setPlaying(false); setDrag(floorH(msFromPointer(e))) }}
        onPointerMove={(e) => drag != null && setDrag(floorH(msFromPointer(e)))}
        onPointerUp={(e) => { if (drag != null) commit(floorH(msFromPointer(e))); setDrag(null) }}
        onPointerCancel={() => setDrag(null)}
      >
        <svg viewBox={`0 0 ${STRIP_W} ${STRIP_H}`} preserveAspectRatio="none" width="100%" height={STRIP_H}>
          {nowH >= lo && nowH <= hi && <rect x={geom.x(nowH)} y="0" width={Math.max(0, STRIP_W - geom.x(nowH))} height={STRIP_H} className="scrub-future" />}
          {geom.wind && <path d={geom.wind} className="scrub-wind" />}
          {geom.price && <path d={geom.price} className="scrub-price" fill="none" vectorEffect="non-scaling-stroke" />}
          {events.filter((ev) => Date.parse(ev.end) >= lo && Date.parse(ev.start) <= hi).map((ev) => (
            <rect key={ev.slug} x={geom.x(Math.max(lo, Date.parse(ev.start)))} y="0" width={Math.max(3, geom.x(Math.min(hi, Date.parse(ev.end))) - geom.x(Math.max(lo, Date.parse(ev.start))))} height="5" className="scrub-ev"
              onPointerDown={(e) => { e.stopPropagation(); setPlaying(false); commit(Date.parse(ev.start) + (Date.parse(ev.end) - Date.parse(ev.start)) / 2) }}><title>{ev.title}</title></rect>
          ))}
          {shown >= lo && shown <= hi && <line x1={geom.x(shown)} x2={geom.x(shown)} y1="0" y2={STRIP_H} className="scrub-cursor" vectorEffect="non-scaling-stroke" />}
        </svg>
        {!series && <span className="scrub-empty faint">History not loaded</span>}
      </div>
      <div className="scrub-scale faint num"><span>{fmt(lo, false)}</span><span>GB price line · wind share band</span><span>{fmt(hi, false)}</span></div>

      <div className="scrub-controls">
        <button className="scrub-play" onClick={() => setPlaying((p) => !p)} disabled={atMs >= nowH && !playing} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        {SPEEDS.map((s) => <button key={s} className={`scrub-pill ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>{s}×</button>)}
        <span style={{ flex: 1 }} />
        {ZOOMS.map((z) => <button key={z.id} className={`scrub-pill ${zoomId === z.id ? 'on' : ''}`} onClick={() => setZoomId(z.id)}>{z.label}</button>)}
      </div>

      {here && (
        <div className="scrub-event">
          <b>{here.title}</b> <span className="faint">{here.headline}</span>
          <span style={{ flex: 1 }} />
          <a href={`#/events?e=${here.slug}`}>Watch the movie</a>
          {here.replay_available && <a href="#/replay">Replay</a>}
        </div>
      )}
      {noData && <div className="scrub-note">No data for this time: the cache holds no prices for it, so the map shows blanks.</div>}
      {proxyGb && !noData && <div className="scrub-note">GB price before September 2026 is the Elexon market index, a proxy for the day-ahead auction.</div>}
      <style>{`
        .mode-overview .slot-bottom { top: 76px; bottom: auto; left: 50%; right: auto; transform: translateX(-50%); max-width: none; }
        .scrubber { width: min(640px, calc(100vw - 32px)); padding: 12px 16px 10px; }
        .scrub-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
        .scrub-head b { font-size: 16px; }
        .scrub-date { background: transparent; color: var(--text-2); border: 1px solid var(--text-3); border-radius: 6px; font-size: 12px; padding: 2px 6px; color-scheme: dark; }
        .scrub-live { font-size: 12px; color: var(--accent); }
        .scrub-live:disabled { color: var(--text-3); }
        .scrub-strip { position: relative; touch-action: none; cursor: ew-resize; border-radius: 6px; background: rgba(255,255,255,.04); outline-offset: 2px; }
        .scrub-price { stroke: var(--text); stroke-width: 1.4; }
        .scrub-wind { fill: rgba(197,240,107,.22); }
        .scrub-future { fill: rgba(197,240,107,.08); }
        .scrub-ev { fill: #f5a65b; cursor: pointer; }
        .scrub-cursor { stroke: var(--accent); stroke-width: 2; }
        .scrub-empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 11px; }
        .scrub-scale { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; margin-top: 4px; }
        .scrub-controls { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
        .scrub-play { width: 30px; height: 26px; border-radius: 6px; border: 1px solid var(--text-3); color: var(--text); }
        .scrub-play:disabled { opacity: .4; }
        .scrub-pill { font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--text-3); color: var(--text-2); }
        .scrub-pill.on { background: var(--accent); border-color: var(--accent); color: #101010; }
        .scrub-event { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; font-size: 12px; margin-top: 8px; }
        .scrub-event a { color: var(--accent); }
        .scrub-note { font-size: 11px; color: var(--text-2); margin-top: 6px; }
      `}</style>
    </section>
  )
}

export default { id: 'scrubber', slot: 'bottom', order: 10, modes: ['overview'], Component: Scrubber }
