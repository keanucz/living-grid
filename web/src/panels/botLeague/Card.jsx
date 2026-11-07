import { Icon } from '../../shell/icons.jsx'

// The bot league card: each bot's Brier score (lower is better) and points, with the room as a row of its own, and
// whether the room beat each bot. Shared by the phone view, the big screen and the main-screen panel.
const pts = (v) => (v == null ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) < 100 ? 1 : 0)}`)

export function leagueRows(round, bots) {
  const room = round && round.nSettled > 0 && round.roomBrier >= 0 ? round.roomBrier : null
  const rows = bots.map((b) => ({ ...b, beatenByRoom: room != null && b.brier != null ? room < b.brier : null }))
  const scored = rows.filter((r) => r.brier != null).sort((a, b) => a.brier - b.brier)
  const unscored = rows.filter((r) => r.brier == null)
  return { room, rows: [...scored, ...unscored] }
}

export function BotLeagueCard({ round, bots, rivalName, big = false, onPick }) {
  if (!round || !bots?.length) return null
  const { room, rows } = leagueRows(round, bots)
  const worst = Math.max(0.25, room ?? 0, ...rows.map((r) => r.brier ?? 0))
  const done = round.status === 'done'
  const beaten = rows.filter((r) => r.beatenByRoom).length
  return (
    <section className={`bl-card ${big ? 'big' : ''}`} aria-label="Bot league">
      <div className="bl-h"><Icon name="chart" size={16} /> Bot league</div>
      {room == null && <p className="bl-m">Brier scores appear as questions settle (lower is better; always saying 50% scores 0.25).</p>}
      {room != null && (
        <div className="bl-row room">
          <span className="bl-n">The room</span>
          <div className="bl-bar"><i style={{ width: `${Math.min(100, (room / worst) * 100)}%` }} /></div>
          <b className="num">{room.toFixed(3)}</b>
          <span className="bl-v" />
        </div>
      )}
      {rows.map((b) => (
        <div key={b.name} className={`bl-row ${rivalName === b.title ? 'rival' : ''}`} onClick={onPick ? () => onPick(b.name) : undefined}>
          <span className="bl-n" title={b.method}>🤖 {b.title}{rivalName === b.title && <small> · your rival</small>}</span>
          <div className="bl-bar"><i className="bot" style={{ width: b.brier == null ? 0 : `${Math.min(100, (b.brier / worst) * 100)}%` }} /></div>
          <b className="num">{b.brier == null ? '—' : b.brier.toFixed(3)}</b>
          <span className={`bl-v ${b.beatenByRoom == null ? '' : b.beatenByRoom ? 'win' : 'lose'}`}>
            {b.beatenByRoom == null ? '' : b.beatenByRoom ? 'Room beat it' : 'Bot won'}
          </span>
          <span className="bl-p num" title="Points after settled questions">{pts(b.points)} pts</span>
        </div>
      ))}
      {room != null && (
        <p className="bl-m">
          {done ? 'Final: ' : 'So far: '}the room beat {beaten} of {rows.filter((r) => r.brier != null).length} bots over {round.nSettled} settled question{round.nSettled === 1 ? '' : 's'}.
          Brier score is the average squared miss of a probability (0 is perfect). Bots only saw data from before the day.
        </p>
      )}
      <style>{CSS}</style>
    </section>
  )
}

const CSS = `
.bl-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px; margin-bottom: 10px; }
.bl-h { font-weight: 600; margin-bottom: 8px; display: flex; gap: 8px; align-items: center; }
.bl-row { display: grid; grid-template-columns: minmax(110px, 1.2fr) 1fr 52px auto auto; gap: 8px; align-items: center; font-size: 13px; padding: 4px 6px; margin: 0 -6px; border-radius: 10px; }
.bl-row[onclick], .bl-row { cursor: default; }
.bl-row.room { color: var(--accent); }
.bl-row.rival { background: var(--accent-dim); }
.bl-n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bl-n small { color: var(--accent); }
.bl-bar { height: 8px; border-radius: 4px; background: var(--card); overflow: hidden; }
.bl-bar i { display: block; height: 100%; background: var(--accent); border-radius: 4px; transition: width .5s; }
.bl-bar i.bot { background: var(--hydro); }
.bl-v { font-size: 11px; min-width: 70px; text-align: right; color: var(--text-3); }
.bl-v.win { color: var(--accent); } .bl-v.lose { color: var(--hot); }
.bl-p { font-size: 11px; color: var(--text-2); min-width: 64px; text-align: right; }
.bl-m { margin: 8px 0 0; font-size: 11px; line-height: 1.45; color: var(--text-2); }
.bl-card.big { padding: 22px; } .bl-card.big .bl-row { font-size: 20px; padding: 8px 6px; } .bl-card.big .bl-v, .bl-card.big .bl-p { font-size: 15px; } .bl-card.big .bl-m { font-size: 14px; } .bl-card.big .bl-bar { height: 14px; }
@media (max-width: 700px) { .bl-row { grid-template-columns: minmax(90px, 1.2fr) 1fr 48px auto; } .bl-p { display: none; } }
`
