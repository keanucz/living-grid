import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { line, curveMonotoneX } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import { Icon } from '../../shell/icons.jsx'

// Event movies: play an event from the library (data/events/) as a timed story. No route of its own: the Replay view renders it.
const files = import.meta.glob('../../../../data/events/*.json')
const load = (slug) => files[`../../../../data/events/${slug}.json`]?.().then((m) => m.default ?? m)

const MOVIE_S = 90
const SPEEDS = [1, 2, 4]
const W = 900
const H = 92
const P = { l: 8, r: 8, t: 8, b: 8 }
const COLOURS = ['var(--hot)', 'var(--accent)', 'var(--text)', 'var(--text-2)', 'var(--text-3)']
const when = (iso, daily) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: daily ? 'numeric' : undefined, hour: daily ? undefined : '2-digit', minute: daily ? undefined : '2-digit', timeZone: 'UTC' }) + (daily ? '' : ' UTC')
const num = (v, unit) => {
  const a = Math.abs(v)
  const s = a >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : a >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : a >= 100 ? v.toFixed(0) : v.toFixed(1)
  return `${s} ${unit}`
}

function Spark({ s, tNow, t0, t1, colour, shown }) {
  const pts = useMemo(() => s.points.map(([t, v]) => [Date.parse(t), v]), [s])
  const { x, y } = useMemo(() => {
    const vs = pts.map((p) => p[1])
    const lo = Math.min(...vs), hi = Math.max(...vs)
    const pad = (hi - lo || 1) * 0.08
    return { x: scaleLinear().domain([t0, t1]).range([P.l, W - P.r]), y: scaleLinear().domain([lo - pad, hi + pad]).range([H - P.b, P.t]) }
  }, [pts, t0, t1])
  const upto = pts.filter((p) => p[0] <= tNow)
  const d = line().x((p) => x(p[0])).y((p) => y(p[1])).curve(curveMonotoneX)(upto)
  const faint = line().x((p) => x(p[0])).y((p) => y(p[1])).curve(curveMonotoneX)(pts)
  const last = upto.at(-1)
  return (
    <div className="ev-spark" style={{ opacity: shown ? 1 : 0 }}>
      <div className="ev-spark-h"><span>{s.label}</span><b className="num">{last ? num(last[1], s.unit) : '—'}</b></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${s.label} through the event`}>
        <path d={faint} fill="none" stroke="var(--line)" strokeWidth="1.5" />
        {d && <path d={d} fill="none" stroke={colour} strokeWidth="2.6" />}
        {last && <circle cx={x(last[0])} cy={y(last[1])} r="4.5" fill={colour} stroke="var(--bg)" strokeWidth="2" />}
        <line x1={x(tNow)} x2={x(tNow)} y1={P.t} y2={H - P.b} stroke="var(--hot)" strokeWidth="1" opacity="0.5" />
      </svg>
    </div>
  )
}

export default function Movie({ onOpenReplay }) {
  const [index, setIndex] = useState(undefined)
  const [slug, setSlug] = useState(null)
  const [ev, setEv] = useState(null)
  const [p, setP] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [big, setBig] = useState(false)
  const last = useRef(0)

  useEffect(() => {
    load('index').then((i) => {
      const wanted = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('e')
      setIndex(i.events)
      setSlug(i.events.find((e) => e.slug === wanted)?.slug ?? i.events[0]?.slug)
    }).catch(() => setIndex(null))
  }, [])
  useEffect(() => {
    if (!slug) return
    setEv(null); setP(0); setPlaying(big)
    load(slug).then(setEv).catch(() => setEv(false))
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    if (!index) return
    const k = index.findIndex((e) => e.slug === slug)
    setSlug(index[(k + 1) % index.length].slug)
  }, [index, slug])

  useEffect(() => {
    if (!playing) return
    last.current = performance.now()
    let raf
    const tick = (now) => {
      const dt = (now - last.current) / 1000
      last.current = now
      let done = false
      setP((v) => { const n = v + (dt * speed) / MOVIE_S; if (n >= 1) { done = true; return 1 } return n })
      if (done) { setPlaying(false); if (big) setTimeout(next, 4000); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, big, next])

  useEffect(() => { if (big && ev && p === 0) setPlaying(true) }, [big, ev]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => !document.fullscreenElement && setBig(false)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const toggleBig = () => {
    if (!big) { document.documentElement.requestFullscreen?.().catch(() => {}); setBig(true); setPlaying(true) }
    else { document.fullscreenElement && document.exitFullscreen?.(); setBig(false) }
  }

  if (index === undefined) return <p className="rp-muted">Loading the event library…</p>
  if (index === null) return <p className="rp-muted">The event library isn’t available right now.</p>

  const daily = ev?.resolution === 'daily'
  const t0 = ev ? Date.parse(ev.start) : 0
  const t1 = ev ? Date.parse(ev.end) : 1
  const tNow = t0 + p * (t1 - t0)
  const moments = ev?.moments ?? []
  const current = [...moments].reverse().find((m) => Date.parse(m.ts) <= tNow)
  const script = ev?.script ?? []
  const line_ = script[Math.min(script.length - 1, Math.floor(p * script.length))]
  const toEnd = p >= 0.999
  const series = ev?.series ?? []

  return (
    <div className={`ev ${big ? 'ev-big' : ''}`}>
      <div className="rp-tabs ev-pick" role="tablist" aria-label="Events">
        {index.map((e) => (
          <button key={e.slug} role="tab" aria-selected={e.slug === slug} className={e.slug === slug ? 'on' : ''} onClick={() => setSlug(e.slug)}>{e.title}</button>
        ))}
      </div>

      {ev === null && <p className="rp-muted">Loading the movie…</p>}
      {ev === false && <p className="rp-muted">This event isn’t available.</p>}

      {ev && (
        <>
          <header className="ev-head">
            <h2>{ev.title}</h2>
            <p>{ev.headline} · {when(ev.start, daily)} to {when(ev.end, daily)}</p>
          </header>

          <div className="ev-stage">
            <section className="ev-charts" aria-label="Playback">
              {series.slice(0, 5).map((s, k) => (
                <Spark key={s.key} s={s} tNow={tNow} t0={t0} t1={t1} colour={COLOURS[k % COLOURS.length]} shown={p >= k * 0.08} />
              ))}
              <div className="ev-timeline">
                <input type="range" min={0} max={1000} value={Math.round(p * 1000)} onChange={(e) => { setPlaying(false); setP(+e.target.value / 1000) }} aria-label="Position in the movie" />
                {moments.map((m) => (
                  <button key={m.ts + m.label} className="ev-chap" style={{ left: `${((Date.parse(m.ts) - t0) / (t1 - t0)) * 100}%` }}
                    title={`${m.label} · ${when(m.ts, daily)}`} aria-label={`Chapter: ${m.label}`} onClick={() => { setPlaying(false); setP((Date.parse(m.ts) - t0) / (t1 - t0)) }} />
                ))}
              </div>
              <div className="ev-clock num">{when(new Date(tNow).toISOString(), daily)}</div>
            </section>

            <aside className="ev-story">
              <p className="ev-line" aria-live="polite">{line_}</p>
              {current && <div className="ev-moment"><span>{when(current.ts, daily)} · {current.label}</span><p>{current.text}</p></div>}
              {toEnd && (
                <ul className="ev-nums">
                  {ev.key_numbers.slice(0, 5).map((n) => <li key={n.label}><span>{n.label}</span><b className="num">{num(n.value, n.unit)}</b></li>)}
                </ul>
              )}
              <p className="ev-src">{ev.label}. {ev.sources.join('; ')}. {ev.caveats[0]}</p>
            </aside>
          </div>

          <div className="rp-controls ev-controls">
            <button className="rp-play" onClick={() => { if (p >= 0.999) setP(0); setPlaying((v) => !v) }}>
              {!playing && <Icon name="play" size={14} fill="currentColor" />} {playing ? 'Pause' : toEnd ? 'Play again' : p > 0 ? 'Resume' : 'Play the movie'}
            </button>
            <div className="rp-tabs" aria-label="Speed">
              {SPEEDS.map((s) => <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
            </div>
            <button className="ev-ghost" onClick={toggleBig}>{big ? 'Leave big screen' : 'Big screen autoplay'}</button>
            {ev.replay?.available && onOpenReplay && <button className="ev-ghost" onClick={onOpenReplay}>Open the forecast replay</button>}
          </div>
          {!ev.replay?.available && <p className="ev-src">No forecast replay for this event yet: it needs a model trained only on data before the date.</p>}
        </>
      )}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.ev-pick { margin-bottom: 14px; }
.ev-head h2 { margin: 0 0 4px; font-size: 24px; letter-spacing: -0.01em; }
.ev-head p { margin: 0 0 14px; color: var(--text-2); }
.ev-stage { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; }
@media (max-width: 900px) { .ev-stage { grid-template-columns: 1fr; } }
.ev-charts, .ev-story { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 16px; }
.ev-spark { transition: opacity .6s; margin-bottom: 6px; }
.ev-spark-h { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-2); }
.ev-spark-h b { color: var(--text); font-weight: 600; }
.ev-timeline { position: relative; margin-top: 10px; }
.ev-timeline input { width: 100%; accent-color: var(--hot); margin: 0; }
.ev-chap { position: absolute; top: -4px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg); padding: 0; min-width: 0; }
.ev-clock { font-size: 13px; color: var(--text-3); margin-top: 6px; }
.ev-story { display: flex; flex-direction: column; gap: 14px; }
.ev-line { font-size: 17px; line-height: 1.5; margin: 0; min-height: 5.5em; }
.ev-moment { border-left: 3px solid var(--hot); padding-left: 12px; }
.ev-moment span { font-size: 12px; color: var(--text-3); }
.ev-moment p { margin: 2px 0 0; line-height: 1.45; }
.ev-nums { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.ev-nums span { display: block; font-size: 12px; color: var(--text-3); }
.ev-nums b { font-size: 20px; font-weight: 600; }
.ev-src { font-size: 12px; color: var(--text-3); line-height: 1.5; margin: 0; }
.ev-controls { margin-top: 14px; justify-content: flex-start; }
.ev-ghost { height: 42px; padding: 0 16px; border-radius: 999px; background: var(--card); color: var(--text-2); font-weight: 600; }
.ev-big .ev-line { font-size: 26px; }
.ev-big .ev-head h2 { font-size: 36px; }
.ev-big .ev-stage { grid-template-columns: minmax(0, 1fr) 420px; }
.ev-big .ev-moment p { font-size: 20px; }
`
