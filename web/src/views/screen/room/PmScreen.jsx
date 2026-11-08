import { Icon } from '../../../shell/icons.jsx'
import { LeaderboardRace } from '../../../panels/leaderboard/Race.jsx'
import { End } from './BeatScreen.jsx'

// The big screen for a room playing the markets: prices that move every game hour, the room's profit against the bots,
// and a ticker of trades. Prices, positions and the leaderboard are public to every player anyway; outcomes appear only when
// a market closes. Same waiting room and end screen as the other rooms.
const START_POINTS = 1000
const hour = (h) => `${String(h).padStart(2, '0')}:00`
const KIND_ICON = (k) => (/wind|ghost/.test(k) ? '≋' : /import|flow/.test(k) ? '⇄' : '£')

export function pmPhase(room) {
  const g = room.pm?.game
  if (!g) return room.lobby?.state === 'countdown' ? 'countdown' : room.lobby?.state === 'reveal' ? 'end' : 'waiting'
  return g.state === 'done' ? 'end' : 'playing'
}

function Spark({ series, close, start, closed, outcome }) {
  const W = 360
  const H = 70
  const X = (h) => 8 + ((h - start) / Math.max(1, close - start)) * (W - 16)
  const Y = (p) => H - 6 - (p / 100) * (H - 12)
  const pts = [...series].sort((a, b) => a.hour - b.hour)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.hour).toFixed(1)},${Y(p.price).toFixed(1)}`).join('')
  const last = pts.at(-1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ps-spark" role="img" aria-label="Chance over the day">
      <line x1="8" x2={W - 8} y1={Y(50)} y2={Y(50)} className="ps-mid" />
      {d && <path d={d} className="ps-line" />}
      {last && !closed && <circle cx={X(last.hour)} cy={Y(last.price)} r="5" className="ps-dot" />}
      {closed && <circle cx={W - 8} cy={Y(outcome === 'yes' ? 100 : 0)} r="6" className={`ps-end ${outcome}`} />}
    </svg>
  )
}

function Markets({ pm }) {
  const by = {}
  for (const p of pm.prices) (by[p.marketId] ??= []).push(p)
  return (
    <section className="ps-markets" aria-label="Markets">
      {pm.markets.map((m) => {
        const s = by[m.marketId] ?? []
        const sorted = [...s].sort((a, b) => a.hour - b.hour)
        const prev = sorted.length > 1 ? sorted.at(-2).price : null
        const delta = prev == null ? 0 : m.priceYes - prev
        const closed = m.status === 'closed'
        return (
          <article key={m.marketId} className={`sc-card ps-card ${closed ? 'closed' : ''}`}>
            <div className="ps-top"><span className="ps-kind"><i aria-hidden>{KIND_ICON(m.kind)}</i>{closed ? 'Resolved' : `Closes ${hour(m.closeHour)}`}</span></div>
            <h3 className="ps-q">{m.text}</h3>
            {closed ? (
              <div className={`ps-out ${m.outcome}`}><b>{m.outcome.toUpperCase()}</b><span>{m.actualText}</span></div>
            ) : (
              <div className="ps-prob"><b className="num">{m.priceYes}%</b><span>chance</span>{delta !== 0 && <em className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</em>}</div>
            )}
            <Spark series={sorted} close={m.closeHour} start={pm.game.startHour} closed={closed} outcome={m.outcome} />
            {!closed && m.note && <p className="ps-note">{m.note}</p>}
          </article>
        )
      })}
    </section>
  )
}

function Board({ pm }) {
  const rows = pm.accounts.map((a) => ({ name: a.name, points: a.equity - START_POINTS, isModel: a.isBot }))
  return (
    <section className="sc-card sc-race">
      <div className="sc-h"><span>Profit</span><small className="sc-muted">open positions at the model's price</small></div>
      <LeaderboardRace rows={rows} n={9} pin="Our model" start={0} />
      <ul className="ps-ticker" aria-label="Latest trades">
        {pm.trades.slice(0, 4).map((t) => (
          <li key={t.seq}><b>{t.who}</b> {t.action === 'buy' ? 'bought' : 'sold'} {Math.round(t.shares)} <em className={t.side}>{t.side.toUpperCase()}</em></li>
        ))}
      </ul>
    </section>
  )
}

export function PmHeader({ room, phase }) {
  const g = room.pm?.game
  const label = { waiting: 'Waiting for players', countdown: 'Starting', playing: 'Live', end: 'Round over' }[phase]
  return (
    <header className="sc-top">
      <div className="sc-logo"><Icon name="bolt" size={30} stroke={2.2} /></div>
      <div className="sc-titles">
        <div className="sc-kicker">The Living Grid · Market day</div>
        <h1>{phase === 'end' ? 'The day revealed' : 'Market day'}</h1>
      </div>
      <span className={`sc-pill ${phase === 'end' ? 'reveal' : phase}`}>{label}</span>
      {room.lobby && <div className="sc-code" aria-label="Room code"><small>Room</small>{room.lobby.code}</div>}
      {g && phase === 'playing' && <div className="sc-clock" aria-label="Game clock"><small>Game clock</small><b className="num">{hour(Math.min(g.clockHour, 23))}</b></div>}
    </header>
  )
}

export function PmPlaying({ room }) {
  return (
    <main className="sc-play ps-play">
      <Board pm={room.pm} />
      <Markets pm={room.pm} />
    </main>
  )
}

export function PmEnd({ room }) {
  const pm = room.pm
  if (!pm) return <main className="sc-wait"><section className="sc-card"><p className="sc-muted">Round over.</p></section></main>
  return <End day={pm.game.dayRevealed} players={pm.accounts.map((a) => ({ id: a.id, name: a.name, isBot: a.isBot, score: a.equity - START_POINTS }))} />
}

export const PM_CSS = `
.ps-play { grid-template-columns: 0.9fr 1.3fr; align-items: start; }
.ps-markets { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; align-content: start; }
.ps-card { display: flex; flex-direction: column; gap: 10px; padding: 22px 26px; }
.ps-card.closed { opacity: .92; }
.ps-top { display: flex; justify-content: space-between; font-size: 18px; color: var(--text-2); }
.ps-kind i { font-style: normal; margin-right: 8px; opacity: .8; }
.ps-q { margin: 0; font-size: 26px; line-height: 1.2; letter-spacing: -0.01em; }
.ps-prob { display: flex; align-items: baseline; gap: 12px; } .ps-prob b { font-size: 68px; line-height: 1; } .ps-prob span { font-size: 22px; color: var(--text-3); }
.ps-prob em { font-style: normal; font-size: 26px; font-weight: 600; } .ps-prob em.up { color: var(--accent); } .ps-prob em.down { color: var(--hot); }
.ps-out { display: flex; align-items: baseline; gap: 14px; font-size: 22px; } .ps-out b { font-size: 38px; } .ps-out.yes b { color: var(--accent); } .ps-out.no b { color: var(--hot); }
.ps-spark { width: 100%; height: 70px; } .ps-mid { stroke: var(--line-2); stroke-dasharray: 4 6; } .ps-line { fill: none; stroke: var(--accent); stroke-width: 3; } .ps-dot { fill: var(--accent); } .ps-end.yes { fill: var(--accent); } .ps-end.no { fill: var(--hot); }
.ps-note { margin: 0; font-size: 18px; line-height: 1.4; color: var(--text-2); }
.ps-ticker { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 6px; font-size: 20px; color: var(--text-2); } .ps-ticker em { font-style: normal; font-weight: 700; } .ps-ticker em.yes { color: var(--accent); } .ps-ticker em.no { color: var(--hot); }
`
