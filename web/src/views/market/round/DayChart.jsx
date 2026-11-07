import { useState } from 'react'
import { chartModel, seriesList } from './chartModel.js'

// The mystery day, one hour at a time: the actual line draws in as the clock passes each hour, behind it each bot's
// P10-P90 fan at the hours questions ask about, and the line each question draws. Tap a bot chip to show or hide its fan.
const W = 340
const H = 170
const M = { l: 38, r: 10, t: 10, b: 22 }
const COLORS = ['#c5f06b', '#6bb8f0', '#f0a86b', '#c58bf0', '#f06b8b', '#6bf0c5']
const hh = (h) => `${String(h).padStart(2, '0')}:00`

export function DayChart({ round, feed, questions, botP, bots }) {
  const list = seriesList(feed, questions)
  const [pick, setPick] = useState(null)
  const series = list.includes(pick) ? pick : list[0]
  const [off, setOff] = useState({})
  if (!round || !series) return null
  const m = chartModel({ feed, questions, botP, series, clock: round.clockHour, startHour: round.startHour, endHour: round.endHour })
  const sx = (h) => M.l + ((h - m.x[0]) / (m.x[1] - m.x[0])) * (W - M.l - M.r)
  const sy = (v) => H - M.b - ((v - m.y[0]) / (m.y[1] - m.y[0])) * (H - M.t - M.b)
  const names = Object.fromEntries((bots ?? []).map((b) => [b.name, b.title]))
  const botNames = [...new Set(m.marks.flatMap((k) => k.fans.map((f) => f.bot)))]
  const color = (bot) => COLORS[Math.max(0, botNames.indexOf(bot)) % COLORS.length]
  const line = m.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.hour + 0.5).toFixed(1)} ${sy(p.value).toFixed(1)}`).join('')
  const last = m.points.at(-1)
  const ticks = [0, 0.5, 1].map((t) => m.y[0] + (m.y[1] - m.y[0]) * t)
  return (
    <section className="dc-card" aria-label="The mystery day so far">
      <div className="dc-head">
        <b>The day so far</b>
        {list.length > 1 && (
          <select value={series} onChange={(e) => setPick(e.target.value)} aria-label="Series">
            {list.map((l) => <option key={l}>{l}</option>)}
          </select>
        )}
        {list.length === 1 && <span className="dc-sub">{series}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${series}, ${m.points.length} hours revealed`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={M.l - 4} y={sy(t) + 3} textAnchor="end" fontSize="9" fill="var(--text-3)">{Math.round(t)}</text>
          </g>
        ))}
        {[m.x[0], Math.round((m.x[0] + m.x[1]) / 2), m.x[1]].map((h) => (
          <text key={h} x={sx(h)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--text-3)">{hh(h)}</text>
        ))}
        {m.marks.map((k) => (
          <g key={k.id}>
            <line x1={sx(k.hour + 0.5)} x2={sx(k.hour + 0.5)} y1={M.t} y2={H - M.b} stroke="var(--line-2)" strokeDasharray="2 3" />
            <line x1={sx(k.hour + 0.5) - 9} x2={sx(k.hour + 0.5) + 9} y1={sy(k.threshold)} y2={sy(k.threshold)} stroke={k.status === 'settled' ? (k.outcome === 'yes' ? 'var(--accent)' : 'var(--hot)') : 'var(--text-2)'} strokeWidth="2" />
            {k.fans.filter((f) => !off[f.bot]).map((f, i) => (
              <g key={f.bot} opacity="0.85">
                <line x1={sx(k.hour + 0.5) + (i - k.fans.length / 2) * 3} x2={sx(k.hour + 0.5) + (i - k.fans.length / 2) * 3} y1={sy(f.p10)} y2={sy(f.p90)} stroke={color(f.bot)} strokeWidth="2.2" strokeLinecap="round" />
                <circle cx={sx(k.hour + 0.5) + (i - k.fans.length / 2) * 3} cy={sy(f.p50)} r="1.8" fill={color(f.bot)} />
              </g>
            ))}
          </g>
        ))}
        {line && <path d={line} fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" />}
        {last && <circle className="dc-now" cx={sx(last.hour + 0.5)} cy={sy(last.value)} r="3.6" fill="var(--text)" />}
      </svg>
      {!m.points.length && <p className="dc-note">The day reveals one hour at a time. Nothing has been played yet.</p>}
      {botNames.length > 0 && (
        <div className="dc-chips" role="group" aria-label="Show a bot's range">
          {botNames.map((b) => (
            <button key={b} className={off[b] ? '' : 'on'} style={{ '--c': color(b) }} onClick={() => setOff({ ...off, [b]: !off[b] })} aria-pressed={!off[b]}>
              <i />{names[b] ?? b}
            </button>
          ))}
        </div>
      )}
      <p className="dc-note">Bars are each bot's 80% range at the hours questions ask about; the white line is what actually happened.</p>
      <style>{CSS}</style>
    </section>
  )
}

const CSS = `
.dc-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px; margin-bottom: 10px; }
.dc-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
.dc-head select { background: var(--card); color: var(--text); border: 1px solid var(--line-2); border-radius: 10px; padding: 6px 8px; font: inherit; font-size: 12px; max-width: 60%; }
.dc-sub { font-size: 12px; color: var(--text-2); }
.dc-note { margin: 6px 0 0; font-size: 11px; color: var(--text-3); line-height: 1.4; }
.dc-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.dc-chips button { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--card); color: var(--text-3); font: inherit; font-size: 12px; }
.dc-chips button.on { color: var(--text); border-color: var(--c); }
.dc-chips i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); display: inline-block; }
.dc-now { animation: dcpulse 1.4s ease-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes dcpulse { 0% { transform: scale(1); } 60% { transform: scale(1.7); opacity: .5; } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .dc-now { animation: none; } }
`
