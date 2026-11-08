// Leaderboard race for the big screen: one bar per player or bot, sized by points and moved into rank order with a
// transition, so overtakes are visible from the back of the room. Rows are { name, points, isModel, rank }.
const START_POINTS = 1000
const ROW = 66
const signed = (v) => (Math.abs(v) < 0.5 ? '±0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`)

export function LeaderboardRace({ rows, n = 10, pin = 'Our model', start = START_POINTS }) {
  const sorted = [...rows].sort((a, b) => b.points - a.points)
  let shown = sorted.slice(0, n)
  const pinned = sorted.find((r) => r.name === pin)
  if (pinned && !shown.includes(pinned)) shown = [...shown.slice(0, n - 1), pinned]
  const pts = shown.map((r) => r.points)
  const hi = Math.max(start, ...pts)
  const lo = Math.min(start, ...pts)
  const span = Math.max(1, hi - lo)
  // Names are stable keys; sorting the keys keeps each DOM node in place so the transform animates.
  const order = new Map(shown.map((r, i) => [r.name, i]))
  return (
    <div className="race" style={{ height: shown.length * ROW }} role="list" aria-label="Leaderboard">
      {[...shown].sort((a, b) => a.name.localeCompare(b.name)).map((r) => {
        const i = order.get(r.name)
        const rank = sorted.indexOf(r) + 1
        const w = 18 + 82 * ((r.points - lo) / span)
        return (
          <div key={r.name} role="listitem" className={`race-row ${r.isModel ? 'bot' : ''} ${rank === 1 ? 'lead' : ''}`} style={{ transform: `translateY(${i * ROW}px)` }}>
            <span className="race-rank num">{rank}</span>
            <div className="race-track">
              <div className="race-bar" style={{ width: `${w}%` }} />
              <span className="race-name">{r.name}{r.isModel && <small>bot</small>}</span>
            </div>
            <span className="race-pts num">{r.points.toFixed(0)}<small className={r.points >= start ? 'up' : 'down'}>{signed(r.points - start)}</small></span>
          </div>
        )
      })}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.race { position: relative; }
.race-row { position: absolute; left: 0; right: 0; top: 0; height: ${ROW - 10}px; display: grid; grid-template-columns: 44px 1fr 150px; gap: 14px; align-items: center; transition: transform .9s cubic-bezier(.3,.8,.3,1); }
.race-rank { font-size: 26px; color: var(--text-3); text-align: right; }
.race-row.lead .race-rank { color: var(--accent); }
.race-track { height: 100%; position: relative; }
.race-bar { position: absolute; inset: 0 auto 0 0; border-radius: 12px; background: var(--accent-dim); border: 1px solid var(--accent); transition: width .9s cubic-bezier(.3,.8,.3,1); }
.race-name { position: absolute; left: 16px; right: 8px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 10px; }
.race-name small { font-size: 14px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; padding: 2px 8px; border-radius: 6px; background: rgba(96,165,250,.2); color: var(--hydro); }
.race-row.bot .race-bar { background: rgba(96, 165, 250, .14); border-color: var(--hydro); }
.race-row.lead .race-bar { background: var(--accent); }
.race-row.lead .race-name { color: var(--accent-ink); }
.race-name { z-index: 1; font-size: 24px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; }
.race-row.bot .race-name { color: var(--hydro); }
.race-row.lead .race-name, .race-row.lead.bot .race-name { color: var(--accent-ink); }
.race-row.lead.bot .race-name small { background: rgba(10,10,10,.12); color: var(--accent-ink); }
.race-bar { min-width: 190px; }
.race-pts { font-size: 26px; font-weight: 700; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.05; }
.race-pts small { font-size: 16px; font-weight: 500; }
.race-pts small.up { color: var(--accent); } .race-pts small.down { color: var(--hot); }
`
