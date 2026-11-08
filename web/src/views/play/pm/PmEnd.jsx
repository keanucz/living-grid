import { pts, signedPts } from './format.js'

// The day is over: the date is revealed, then your profit against the model and each bot, and your overall rank.
export function PmEnd({ model, onAgain, onLeave, busy, rehearsal }) {
  const { standings, end } = model
  const me = standings.find((s) => s.isMe)
  const bots = standings.filter((s) => s.isBot)
  return (
    <section className="pm-panel pm-end" aria-label="Market day over">
      <div className="pm-kicker">Market day over</div>
      <div className={`pm-bigpnl num ${me?.pnl > 0 ? 'up' : me?.pnl < 0 ? 'down' : ''}`}>{signedPts(me?.pnl ?? 0)}</div>
      <div className="pm-muted">profit on {pts(1000)} starting points{end?.rank ? ` · #${end.rank} of ${standings.length}` : ''}</div>
      <p className="pm-day">The mystery day was <b>{end?.day || 'a real day'}</b>. {rehearsal ? 'Invented for this rehearsal.' : 'Real prices and weather, replayed.'}</p>
      <ul className="pm-beats">
        {bots.map((b) => {
          const beat = (me?.equity ?? 0) > b.equity
          const margin = Math.abs((me?.equity ?? 0) - b.equity)
          const tie = margin < 0.005
          return (
            <li key={b.id} className={beat ? 'up' : tie ? '' : 'down'}>
              <span>{beat ? `You beat ${b.name}` : tie ? `You tied ${b.name}` : `${b.name} beat you`}<small className="pm-sub">{b.name} made {signedPts(b.pnl)}</small></span>
              <b className="num">{tie ? '' : `by ${pts(margin)}`}</b>
            </li>
          )
        })}
      </ul>
      {end?.meta && <p className="pm-meta-rank">Overall rank <b>#{end.meta.rank}</b> · rating <b className="num">{Math.round(end.meta.rating)}</b></p>}
      {onAgain && <button className="pm-go yes" disabled={busy} onClick={onAgain}>Play again</button>}
      {onLeave && <button className="pm-cancel" onClick={onLeave}>Leave</button>}
    </section>
  )
}
