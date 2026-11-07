import { badges as computeBadges, streak as computeStreak } from './streaks.js'

// Streak counter and badges for the player's own round, from public rows (see streaks.js). Renders nothing until
// there is something to show, so a fresh round stays uncluttered.
export function Stats({ questions, positions, bots, points, roundDone }) {
  const s = computeStreak(questions, positions)
  const earned = computeBadges({ questions, positions, bots, points, roundDone })
  if (!s.best && !earned.length) return null
  return (
    <section className="st-card" aria-label="Streak and badges">
      <div className="st-streak">
        <b className="num">{s.current}</b>
        <span>{s.current === 1 ? 'win' : 'wins'} in a row{s.best > s.current ? ` · best ${s.best}` : ''}</span>
        {s.current >= 2 && <span className="st-fire" aria-hidden>🔥</span>}
      </div>
      {earned.length > 0 && (
        <ul className="st-badges">
          {earned.map((b) => (
            <li key={b.id} title={b.why}><span aria-hidden>🏅</span> {b.label}</li>
          ))}
        </ul>
      )}
      <style>{CSS}</style>
    </section>
  )
}

const CSS = `
.st-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 12px 14px; margin-bottom: 10px; }
.st-streak { display: flex; align-items: baseline; gap: 8px; font-size: 13px; color: var(--text-2); }
.st-streak b { font-size: 26px; color: var(--accent); }
.st-badges { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.st-badges li { padding: 5px 10px; border-radius: 999px; background: var(--accent-dim); color: var(--accent); font-size: 12px; font-weight: 600; }
`
