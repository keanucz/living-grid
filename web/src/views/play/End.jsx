import { beatLines, fmtPts, rankOf } from './model.js'

// The end of a round: the day and weather are revealed, your score against each bot, rank, Play again.
export function EndCard({ model, onAgain, onLeave, busy }) {
  const { end, totals } = model
  if (!end) return null
  const me = totals.find((t) => t.isMe)
  const lines = beatLines(totals)
  const wins = lines.filter((l) => l.beat).length
  const rank = end.rank ?? rankOf(totals)
  return (
    <section className="bm-card bm-end" aria-label="Round over">
      <div className="bm-kicker">Round over</div>
      <div className="bm-bigscore num">{fmtPts(me?.points)}</div>
      <div className="bm-muted">points (best possible {model.nCalls * 100}){rank ? ` · ${end.nPlayers > 1 ? `#${rank} of ${end.nPlayers}` : `#${rank} with the bots`}` : ''}</div>
      <p className="bm-day">The mystery day was <b>{end.day}</b>{end.regime ? <>, a {end.regime} day</> : null}. {model.rehearsal ? 'Invented for this rehearsal.' : 'Real prices, replayed.'}</p>
      <ul className="bm-beats">
        {lines.map((l) => (
          <li key={l.title} className={l.beat ? 'bm-win' : l.tie ? 'bm-tie' : 'bm-lose'}>
            <span>{l.beat ? `You beat ${l.title}` : l.tie ? `You tied ${l.title}` : `${l.title} beat you`}</span>
            <b className="num">{l.beat || l.tie ? '' : '−'}{Math.abs(Math.round(l.diff))}</b>
          </li>
        ))}
      </ul>
      {lines.length > 0 && <p className="bm-muted">{wins === lines.length ? 'You beat every bot.' : `You beat ${wins} of ${lines.length} bots.`}</p>}
      {end.meta && (
        <p className="bm-meta">Overall rank <b>#{end.meta.rank}</b>{end.meta.rating != null ? <> · rating <b className="num">{Math.round(end.meta.rating)}</b>{end.meta.delta ? <span className={end.meta.delta > 0 ? 'bm-up' : 'bm-down'}> ({end.meta.delta > 0 ? '+' : '−'}{Math.abs(Math.round(end.meta.delta))})</span> : null}</> : null}</p>
      )}
      {onAgain && <button className="bm-primary" disabled={busy} onClick={onAgain}>Play again</button>}
      {onLeave && <button className="bm-link" onClick={onLeave}>Leave</button>}
    </section>
  )
}
