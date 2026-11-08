import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../shell/icons.jsx'
import { LeaderboardRace } from '../../../panels/leaderboard/Race.jsx'

// The big screen for a Beat the model room: the waiting room with the join code, then each call with a countdown (picks are
// private, so the screen shows the question and the timer, not a live split), the reveal after it (how the room split,
// the model's call and reason, the bots, what happened), a running leaderboard against the bots, and at the end the date.
const hour = (h) => `${String(h).padStart(2, '0')}:00`
const KIND = { price_band: 'Price band', battery: 'Battery', import_export: 'Imports and exports', which_zone: 'Which zone', wind_over: 'Wind switched off' }
const BOT_NAME = { bot_yesterday: 'Yesterday', bot_engineer: 'The Engineer', lgbm_q: 'Our model', bot_committee: 'The Committee' }
const num = (v) => (Math.abs(v) < 0.05 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`)
const longDate = (d) => {
  const t = new Date(`${d}T12:00:00Z`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const opts = (c) => {
  try {
    return JSON.parse(c.optionsJson)
  } catch {
    return []
  }
}

function useNow(every = 250) {
  const [n, setN] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), every)
    return () => clearInterval(t)
  }, [every])
  return n
}

export function beatPhase(room) {
  const st = room.lobby?.state
  const g = room.beat?.game
  if (!g) return st === 'countdown' ? 'countdown' : st === 'reveal' ? 'end' : 'waiting'
  if (g.state === 'done') return 'end'
  return g.state === 'revealing' ? 'reveal' : 'answer'
}

function Timer({ until }) {
  const now = useNow()
  const left = until ? Math.max(0, Math.ceil((until - now) / 1000)) : null
  if (left == null) return null
  return (
    <div className={`bs-timer ${left <= 5 ? 'low' : ''}`} role="timer" aria-label={`${left} seconds left`}>
      <b className="num">{left}</b><small>seconds</small>
    </div>
  )
}

function Question({ call, game, nCalls, answered }) {
  const o = opts(call)
  return (
    <section className="sc-card bs-q" aria-label={`Call ${call.idx + 1} of ${nCalls}`}>
      <div className="bs-qtop">
        <span className="bs-kind">{KIND[call.kind] ?? 'Call'} · call {call.idx + 1} of {nCalls}</span>
        <Timer until={game.openedAt ? game.openedAt + game.answerS * 1000 : null} />
      </div>
      <h2 className="bs-text">{call.text}</h2>
      <ul className="bs-opts">
        {o.map((x) => <li key={x.id}>{x.label}</li>)}
      </ul>
      <p className="sc-muted">Everyone is answering on their phone. Picks stay secret until the reveal.</p>
    </section>
  )
}

function Reveal({ call, results, players }) {
  const o = opts(call)
  const byId = Object.fromEntries(players.map((p) => [p.id, p]))
  const mine = results.filter((r) => r.idx === call.idx)
  const people = mine.filter((r) => !byId[r.id]?.isBot && r.choice)
  const counts = Object.fromEntries(o.map((x) => [x.id, people.filter((r) => r.choice === x.id).length]))
  const top = Math.max(1, ...Object.values(counts))
  let bots = {}
  try {
    bots = JSON.parse(call.botsJson || '{}')
  } catch { /* none */ }
  const label = (id) => o.find((x) => x.id === id)?.label ?? id
  const right = people.filter((r) => r.correct).length
  return (
    <section className="sc-card bs-q bs-rev" aria-label={`Result of call ${call.idx + 1}`}>
      <div className="bs-qtop"><span className="bs-kind">{KIND[call.kind] ?? 'Call'} · call {call.idx + 1} revealed</span><span className="bs-right">{right} of {people.length} right</span></div>
      <h2 className="bs-text">{call.text}</h2>
      <ul className="bs-split">
        {o.map((x) => (
          <li key={x.id} className={x.id === call.answer ? 'win' : ''}>
            <span className="bs-lab">{x.label}{x.id === call.answer && <em>correct</em>}</span>
            <span className="bs-bar"><i style={{ width: `${(counts[x.id] / top) * 100}%` }} /></span>
            <b className="num">{counts[x.id]}</b>
          </li>
        ))}
      </ul>
      <p className="bs-what"><span>What happened</span>{call.actualText}</p>
      <div className="bs-model">
        <div><span>The model said</span><b>{label(call.modelChoice)} · {Math.round(call.modelConfidence)}%</b></div>
        <p>{call.modelReason}</p>
      </div>
      <ul className="bs-bots">
        {Object.entries(bots).map(([k, a]) => (
          <li key={k} className={a.choice === call.answer ? 'ok' : 'bad'}><span>{BOT_NAME[k] ?? k}</span><b>{label(a.choice)} · {a.confidence}%</b></li>
        ))}
      </ul>
    </section>
  )
}

function Board({ players }) {
  const rows = players.map((p) => ({ name: p.name, points: p.score, isModel: p.isBot }))
  return (
    <section className="sc-card sc-race">
      <div className="sc-h"><span>Score</span><small className="sc-muted">100 per call if certain and right, 0 for a guess</small></div>
      <LeaderboardRace rows={rows} n={9} pin="Our model" start={0} />
    </section>
  )
}

function End({ beat }) {
  const { game, players, results } = beat
  const sorted = [...players].sort((a, b) => b.score - a.score)
  const people = sorted.filter((p) => !p.isBot)
  const bots = sorted.filter((p) => p.isBot)
  const podium = [people[1], people[0], people[2]]
  return (
    <main className="sc-reveal" aria-label="Round over">
      <section className="sc-card sc-day-reveal sc-stage in">
        <div className="sc-kicker">The mystery day was</div>
        <div className="sc-date">{game.dayRevealed ? longDate(game.dayRevealed) : 'a real past day'}</div>
        <p className="sc-muted">Real prices from that day, played back at speed. Every bot saw only data from before it.</p>
      </section>
      <section className="sc-card sc-podium sc-stage in">
        <div className="sc-h"><span>Top of the room</span></div>
        <div className="sc-steps">
          {podium.map((p, i) => p && (
            <div key={p.id} className={`sc-step p${[2, 1, 3][i]}`}>
              <div className="sc-pname">{p.name}</div>
              <div className="sc-ppts num">{num(p.score)} pts</div>
              <div className="sc-block num">{[2, 1, 3][i]}</div>
            </div>
          ))}
        </div>
        {!people.length && <p className="sc-muted">Nobody played this round.</p>}
      </section>
      <section className="sc-card sc-stage in bs-vsbots">
        <div className="sc-h"><span>The room against the bots</span></div>
        <ul>
          {bots.map((b) => {
            const beat = people.filter((p) => p.score > b.score).length
            return <li key={b.id}><span>{b.name}</span><b className="num">{num(b.score)}</b><em>{beat} of {people.length} people beat it</em></li>
          })}
        </ul>
      </section>
    </main>
  )
}

export function BeatHeader({ room, phase }) {
  const g = room.beat?.game
  const label = { waiting: 'Waiting for players', countdown: 'Starting', answer: 'Live', reveal: 'Live', end: 'Round over' }[phase]
  return (
    <header className="sc-top">
      <div className="sc-logo"><Icon name="bolt" size={30} stroke={2.2} /></div>
      <div className="sc-titles">
        <div className="sc-kicker">The Living Grid · Beat the model</div>
        <h1>{phase === 'end' ? 'The day revealed' : 'Can you beat the model?'}</h1>
      </div>
      <span className={`sc-pill ${phase === 'end' ? 'reveal' : phase === 'answer' || phase === 'reveal' ? 'playing' : phase}`}>{label}</span>
      {room.lobby && <div className="sc-code" aria-label="Room code"><small>Room</small>{room.lobby.code}</div>}
      {g && phase !== 'end' && (
        <div className="sc-clock" aria-label="Call"><small>Call</small><b className="num">{Math.min(g.callNo + 1, g.nCalls)}/{g.nCalls}</b></div>
      )}
    </header>
  )
}

export function BeatPlaying({ room }) {
  const { game, calls, players, results } = room.beat
  const phase = beatPhase(room)
  const call = calls.find((c) => c.idx === game.callNo)
  return (
    <main className="sc-play bs-play">
      <Board players={players} />
      {call && (phase === 'reveal' && call.revealed ? <Reveal call={call} results={results} players={players} /> : <Question call={call} game={game} nCalls={game.nCalls} />)}
    </main>
  )
}

export function BeatEnd({ room }) {
  return room.beat ? <End beat={room.beat} /> : <main className="sc-wait"><section className="sc-card"><p className="sc-muted">Round over.</p></section></main>
}

export const BEAT_CSS = `
.bs-play { grid-template-columns: 1fr 1.2fr; }
.bs-q { display: flex; flex-direction: column; gap: 18px; padding: 28px 32px; }
.bs-qtop { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.bs-kind { font-size: 22px; color: var(--text-2); }
.bs-right { font-size: 22px; color: var(--accent); font-weight: 600; }
.bs-text { margin: 0; font-size: 46px; line-height: 1.15; letter-spacing: -0.02em; }
.bs-timer { display: flex; align-items: baseline; gap: 10px; color: var(--accent); }
.bs-timer b { font-size: 76px; line-height: 1; }
.bs-timer small { font-size: 20px; color: var(--text-3); }
.bs-timer.low { color: var(--hot); }
.bs-opts { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 12px; }
.bs-opts li { padding: 16px 22px; border-radius: 16px; border: 1px solid var(--line-2); background: var(--card); font-size: 30px; font-weight: 600; }
.bs-split { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.bs-split li { display: grid; grid-template-columns: 1fr 44% 54px; align-items: center; gap: 14px; font-size: 26px; }
.bs-split li.win .bs-lab { color: var(--accent); font-weight: 700; }
.bs-lab em { margin-left: 10px; font-size: 16px; font-style: normal; text-transform: uppercase; letter-spacing: .08em; padding: 2px 8px; border-radius: 6px; background: var(--accent-dim); color: var(--accent); }
.bs-bar { height: 22px; border-radius: 11px; background: var(--card); overflow: hidden; }
.bs-bar i { display: block; height: 100%; background: var(--line-2); border-radius: 11px; transition: width .6s ease; }
.bs-split li.win .bs-bar i { background: var(--accent); }
.bs-split b { text-align: right; }
.bs-what { margin: 0; font-size: 26px; } .bs-what span { display: block; font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-3); margin-bottom: 4px; }
.bs-model { background: var(--card); border-radius: 16px; padding: 16px 20px; } .bs-model > div { display: flex; justify-content: space-between; font-size: 24px; } .bs-model span { color: var(--text-2); } .bs-model p { margin: 8px 0 0; font-size: 22px; line-height: 1.4; color: var(--text-2); }
.bs-bots { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 24px; font-size: 22px; }
.bs-bots li { display: flex; justify-content: space-between; gap: 12px; } .bs-bots li.ok b { color: var(--accent); } .bs-bots li.bad b { color: var(--hot); } .bs-bots span { color: var(--text-2); }
.bs-vsbots ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; font-size: 30px; }
.bs-vsbots li { display: grid; grid-template-columns: 1fr 120px 1fr; align-items: baseline; gap: 18px; } .bs-vsbots em { font-style: normal; font-size: 22px; color: var(--text-2); }
`
