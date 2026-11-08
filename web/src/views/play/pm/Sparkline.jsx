import { hh } from './format.js'

// The market's YES probability through the day so far: 0-100% on a fixed scale so every chart reads the same. The dot
// is the price now; dashed lines mark the price the player paid. The x axis runs to the market's close hour.
export function Sparkline({ series, startHour, closeHour, entries = [], w = 300, h = 70, closed = false, outcome = '' }) {
  const x = (hour) => ((hour - startHour) / Math.max(1, closeHour - startHour)) * (w - 8) + 4
  const y = (p) => h - 6 - (p / 100) * (h - 12)
  const pts = series.map((s) => [x(s.hour), y(s.price)])
  const line = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join('')
  const last = pts.at(-1)
  const area = pts.length > 1 ? `${line}L${last[0].toFixed(1)} ${h - 6}L${pts[0][0].toFixed(1)} ${h - 6}Z` : ''
  const colour = closed ? (outcome === 'yes' ? 'var(--pm-yes)' : 'var(--pm-no)') : 'var(--text)'
  return (
    <svg className="pm-spark" viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`Chance over the day, now ${series.at(-1)?.price ?? '—'}%`}>
      <line x1="4" x2={w - 4} y1={y(50)} y2={y(50)} stroke="var(--line-2)" strokeDasharray="3 4" />
      <text x={w - 4} y={y(50) - 3} textAnchor="end" fontSize="9" fill="var(--text-3)">50%</text>
      {entries.map((e, i) => <line key={i} x1="4" x2={w - 4} y1={y(e.price)} y2={y(e.price)} stroke={e.side === 'yes' ? 'var(--pm-yes)' : 'var(--pm-no)'} strokeDasharray="2 3" opacity=".7" />)}
      {area && <path d={area} fill={colour} opacity=".1" />}
      {line && <path d={line} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {last && <circle className={closed ? '' : 'pm-now'} cx={last[0]} cy={last[1]} r="3.6" fill={colour} />}
      <text x="4" y={h - 0} fontSize="9" fill="var(--text-3)">{hh(startHour)}</text>
      <text x={w - 4} y={h - 0} textAnchor="end" fontSize="9" fill="var(--text-3)">{hh(closeHour)}</text>
    </svg>
  )
}
