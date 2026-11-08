import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store/store.js'
import { FUELS, STORM_DAY, ZONES, addDays, loadGeneration, placeName, sentence, slots, todayUtc } from './model.js'
import './genMix.css'

const fmtMw = (v) => `${Math.round(v).toLocaleString('en-GB')} MW`

function useDay(zone, date) {
  const [g, setG] = useState(null)
  useEffect(() => {
    let live = true
    setG(null)
    loadGeneration(zone, date).then((r) => live && setG(r))
    return () => { live = false }
  }, [zone, date])
  return g
}

function Bars({ g, max, w, h, hover, setHover, axis = true }) {
  const s = slots(g)
  const pad = axis ? { l: 54, b: 26, t: 8 } : { l: 4, b: 4, t: 4 }
  const iw = w - pad.l - 6, ih = h - pad.b - pad.t
  const bw = iw / 24
  const y = (v) => pad.t + ih - (v / max) * ih
  const ticks = axis ? [0, 0.5, 1].map((k) => k * max) : []
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Generation by fuel for each hour" className="gm-svg">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={w - 6} y1={y(t)} y2={y(t)} stroke="var(--line, #2a2a2a)" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="gm-tick">{Math.round(t / 1000)} GW</text>
        </g>
      ))}
      {s.map((r, i) => {
        if (!r) return <rect key={i} x={pad.l + i * bw + 1} y={y(0) - 2} width={Math.max(1, bw - 2)} height={2} fill="#333" />
        let acc = 0
        return (
          <g key={i} onMouseEnter={() => setHover?.(i)} onMouseLeave={() => setHover?.(null)} onClick={() => setHover?.(i)} opacity={hover == null || hover === i ? 1 : 0.55}>
            {FUELS.map((f) => {
              const v = r.mw[f.id]
              if (!v) return null
              const top = y(acc + v)
              const hh = y(acc) - top
              acc += v
              return <rect key={f.id} x={pad.l + i * bw + 1} y={top} width={Math.max(1, bw - 2)} height={Math.max(0, hh)} fill={f.color} />
            })}
            <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill="transparent" />
          </g>
        )
      })}
      {axis && [0, 6, 12, 18, 23].map((h2) => <text key={h2} x={pad.l + h2 * bw + bw / 2} y={h - 6} textAnchor="middle" className="gm-tick">{String(h2).padStart(2, '0')}</text>)}
    </svg>
  )
}

function Hover({ g, i }) {
  const r = slots(g)[i]
  if (!r) return <div className="gm-hover faint">Hover or tap a bar for its numbers.</div>
  return (
    <div className="gm-hover">
      <b>{String(r.h).padStart(2, '0')}:00 UTC</b>
      <table>
        <tbody>
          {FUELS.filter((f) => r.mw[f.id] > 0).sort((a, b) => r.mw[b.id] - r.mw[a.id]).map((f) => (
            <tr key={f.id}><td><i style={{ background: f.color }} />{f.label}</td><td className="num">{fmtMw(r.mw[f.id])}</td><td className="num faint">{Math.round((r.mw[f.id] / r.total) * 100)}%</td></tr>
          ))}
          <tr className="gm-sum"><td>Made in the country</td><td className="num">{fmtMw(r.total)}</td><td /></tr>
          {r.imports > 0 && <tr><td className="faint">Imports (not stacked)</td><td className="num">{fmtMw(r.imports)}</td><td /></tr>}
          {r.pumped > 0 && <tr><td className="faint">Pumped storage</td><td className="num">{fmtMw(r.pumped)}</td><td /></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Legend() {
  return <div className="gm-legend">{FUELS.map((f) => <span key={f.id}><i style={{ background: f.color }} />{f.label}</span>)}</div>
}

function One({ zone, date }) {
  const g = useDay(zone, date)
  const [hover, setHover] = useState(null)
  const max = useMemo(() => Math.max(1000, ...slots(g).map((r) => r?.total ?? 0)) * 1.08, [g])
  if (!g) return <div className="gm-load faint">Loading {placeName(zone)}…</div>
  return (
    <>
      <p className="gm-sentence">{sentence(g, zone, date)}</p>
      <div className="gm-body">
        <div className="gm-chart"><Bars g={g} max={max} w={640} h={300} hover={hover} setHover={setHover} /></div>
        <Hover g={g} i={hover} />
      </div>
      <Legend />
      <Source g={g} />
    </>
  )
}

function Source({ g }) {
  return (
    <div className="gm-source faint">
      {g.sample ? <b className="gm-sample">Sample shape, not real data: the generation feed is not live yet.</b> : `Source: ${g.source ?? 'engine'}${g.as_of ? `, as of ${String(g.as_of).slice(0, 16).replace('T', ' ')} UTC` : ''}.`}
      {!g.sample && g.estimated && ' Some figures are estimates.'}
    </div>
  )
}

function Six({ date }) {
  const days = [useDay('GB', date), useDay('FR', date), useDay('DE-LU', date), useDay('NL', date), useDay('BE', date), useDay('NO2', date)]
  const ready = days.every(Boolean)
  const max = useMemo(() => Math.max(1000, ...days.flatMap((g) => slots(g).map((r) => r?.total ?? 0))) * 1.08, [ready, date])
  if (!ready) return <div className="gm-load faint">Loading six countries…</div>
  return (
    <>
      <p className="gm-sentence">{sentence(days[0], 'GB', date)} Every small chart below uses the same scale, up to {Math.round(max / 1000)} GW.</p>
      <div className="gm-six">
        {ZONES.map((z, i) => (
          <div key={z} className="gm-mini">
            <div className="gm-mini-t">{placeName(z)}</div>
            <Bars g={days[i]} max={max} w={300} h={120} axis={false} />
          </div>
        ))}
      </div>
      <Legend />
      <Source g={days[0]} />
    </>
  )
}

export function GenMixModal({ zone: zone0 = 'GB', onClose }) {
  const at = useStore((s) => s.at)
  const [zone, setZone] = useState(zone0)
  const [view, setView] = useState('one')
  const [pick, setPick] = useState(null)
  useEffect(() => setPick(null), [at])
  const date = pick ?? (at ? at.slice(0, 10) : todayUtc())
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  const chips = [['Today', todayUtc()], ['Yesterday', addDays(todayUtc(), -1)], ['26 Oct storm', STORM_DAY]]
  return createPortal(
    <div className="gm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="gm-card" role="dialog" aria-label="Generation by type through the day">
        <header className="gm-head">
          <div>
            <div className="gm-kicker">Today’s mix</div>
            <h2>What the power was made from</h2>
          </div>
          <button className="gm-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="gm-controls">
          <div className="gm-seg">
            <button className={view === 'one' ? 'on' : ''} onClick={() => setView('one')}>One country</button>
            <button className={view === 'six' ? 'on' : ''} onClick={() => setView('six')}>All six, same scale</button>
          </div>
          {view === 'one' && (
            <select value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Country">
              {ZONES.map((z) => <option key={z} value={z}>{placeName(z)}</option>)}
            </select>
          )}
          <div className="gm-seg">
            {chips.map(([l, d]) => <button key={d} className={date === d ? 'on' : ''} onClick={() => setPick(d)}>{l}</button>)}
          </div>
          <input type="date" value={date} max={todayUtc()} onChange={(e) => e.target.value && setPick(e.target.value)} aria-label="Date" />
        </div>
        {view === 'one' ? <One zone={zone} date={date} /> : <Six date={date} />}
        <div className="gm-foot faint">Hours are UTC. The date follows the history scrubber; pick another to override it.</div>
      </section>
    </div>,
    document.body,
  )
}
