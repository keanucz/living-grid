import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Icon } from '../../shell/icons.jsx'
import { BotLeagueCard } from '../../panels/botLeague/Card.jsx'
import { LeaderboardRace } from '../../panels/leaderboard/Race.jsx'
import { connectScreen } from './connection.js'
import { demoState, DEMO_REPLAY } from './demo.js'
import { CSS } from './style.js'
import { connectRoom } from './room/connection.js'
import { BEAT_CSS, BeatEnd, BeatHeader, BeatPlaying, beatPhase } from './room/BeatScreen.jsx'
import { PM_CSS, PmEnd, PmHeader, PmPlaying, pmPhase } from './room/PmScreen.jsx'

// Big screen for the mystery-day market, made for a 1080p projector: #/screen?code=ABCD (one per lobby), or
// #/screen for the current round. Waiting room with the join QR, then the leaderboard race, the crowd against
// the bots per question and the day so far, then the reveal. #/screen?demo=1 runs a scripted rehearsal.
const param = (k) => new URLSearchParams(location.hash.split('?')[1] || '').get(k)
const hour = (h) => `${String(h).padStart(2, '0')}:00`
const pct = (p) => `${Math.round(p * 100)}%`
const UNIT = { 'GBP/MWh': '£/MWh', 'EUR/MWh': '€/MWh' }
const OUR_MODEL = 'Our model'

function joinUrl(code) {
  const base = `${location.origin}${location.pathname}`
  return code ? `${base}#/lobby?code=${encodeURIComponent(code)}` : `${base}#/market`
}

function phaseOf(s) {
  const st = s.lobby?.state
  if (st === 'waiting' || st === 'countdown') return st
  if (st === 'reveal' || s.round?.status === 'done') return 'reveal'
  if (st === 'playing' || (s.round?.status === 'running' && s.round.clockHour > s.round.startHour)) return 'playing'
  return s.round?.status === 'running' ? 'countdown' : 'waiting'
}

function useScreen(code, demo) {
  const [s, setS] = useState({ status: 'connecting' })
  const [bursts, setBursts] = useState([])
  const push = (e) => {
    const id = `${Date.now()}-${Math.random()}`
    setBursts((b) => [...b.slice(-2), { ...e, id }])
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 4200)
  }
  useEffect(() => {
    if (demo) {
      const t0 = performance.now()
      let last = null
      const tick = () => {
        const d = demoState((performance.now() - t0) / 1000)
        if (d.event && d.event.stamp !== last) {
          last = d.event.stamp
          push(d.event)
        }
        setS(d)
      }
      tick()
      const id = setInterval(tick, 500)
      return () => clearInterval(id)
    }
    if (import.meta.env?.VITE_LG_OFFLINE === '1') {
      setS({ status: 'offline' })
      return undefined
    }
    const c = connectScreen({ code, onState: (n) => setS((p) => ({ ...p, ...n })), onEvent: push })
    return () => c.close()
  }, [code, demo])
  return [s, bursts]
}

function useQr(url, width) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width, color: { dark: '#0a0a0a', light: '#fafafa' } }).then(setSrc).catch(() => setSrc(null))
  }, [url, width])
  return src
}

function useReplay(day, demo) {
  const [r, setR] = useState(null)
  useEffect(() => {
    if (!day) return undefined
    if (demo) {
      setR(DEMO_REPLAY)
      return undefined
    }
    let live = true
    fetch(`/api/replay?event=${day}`).then((x) => (x.ok ? x.json() : null)).then((d) => live && setR(d)).catch(() => {})
    return () => (live = false)
  }, [day, demo])
  return r
}

function Header({ s, phase, code, url }) {
  const qr = useQr(url, 140)
  const r = s.round
  const label = { waiting: 'Waiting for players', countdown: 'Starting', playing: 'Live', reveal: 'Round over' }[phase]
  return (
    <header className="sc-top">
      <div className="sc-logo"><Icon name="bolt" size={30} stroke={2.2} /></div>
      <div className="sc-titles">
        <div className="sc-kicker">The Living Grid · mystery-day market{s.demo && <span className="sc-demo">Rehearsal data</span>}</div>
        <h1>{phase === 'reveal' ? 'The day revealed' : r?.title || 'Predict a real day of Europe’s grid'}</h1>
      </div>
      <span className={`sc-pill ${phase}`}>{label}</span>
      {code && <div className="sc-code" aria-label="Room code"><small>Room</small>{code}</div>}
      {r && phase !== 'waiting' && (
        <div className="sc-clock" aria-label="Game clock">
          <small>{phase === 'reveal' ? 'Played' : 'Game clock'}</small>
          <b className="num">{hour(Math.min(r.clockHour, 23))}</b>
        </div>
      )}
      {phase === 'playing' && qr && <img className="sc-miniqr" src={qr} alt="QR code to join" width="96" height="96" />}
    </header>
  )
}

const MARKET_HOW = [
  'We replay a real past day of Europe’s grid, one hour at a time, with the date hidden.',
  'Buy YES or NO on questions about prices and wind. The price is the room’s probability.',
  'Beat the bots. Points only, no money. Each bot saw only data from before the day.',
]
const BEAT_HOW = [
  'We pick a real past day of Europe’s grid and hide the date.',
  'Five calls, about 15 seconds each: pick an answer and say how sure you are.',
  'You score for being right and for knowing how right you are. Beat the model and the bots.',
]

function Waiting({ s, url, code, phase, how = MARKET_HOW }) {
  const qr = useQr(url, 520)
  const players = s.players ?? []
  return (
    <main className="sc-wait">
      <section className="sc-card sc-join">
        {qr && <img src={qr} alt={`QR code to join: ${url}`} width="440" height="440" />}
        <div className="sc-join-t">Scan to play</div>
        <div className="sc-join-u num">{url.replace(/^https?:\/\//, '')}</div>
        {code && <div className="sc-join-c">Room code <b>{code}</b></div>}
      </section>
      <section className="sc-card sc-room">
        <div className="sc-h">
          <span>In the room</span>
          <b className="num">{players.length}</b>
        </div>
        {phase === 'countdown' && <div className="sc-count">Starting now. Grab your phone.</div>}
        <div className="sc-chips">
          {players.map((p) => (
            <span key={p.id} className={`sc-chip ${p.ready ? 'ready' : ''}`}>
              <i>{p.avatar || p.name.slice(0, 1).toUpperCase()}</i>
              {p.name}
            </span>
          ))}
          {!players.length && <p className="sc-muted">Nobody yet. Be the first.</p>}
        </div>
        <div className="sc-how">
          <div className="sc-h2">How it works</div>
          <ol>{how.map((t) => <li key={t}>{t}</li>)}</ol>
        </div>
        {s.bots?.length > 0 && (
          <div className="sc-against">
            <span className="sc-muted">Up against</span>
            {s.bots.map((b) => <span key={b.name} className="sc-bot">{b.title}</span>)}
          </div>
        )}
      </section>
    </main>
  )
}

// Room probability against each bot's on a 0 to 100% YES track.
function Meter({ q, botP, bots }) {
  const settled = q.status === 'settled'
  const room = settled ? q.roomPClose : q.priceYes
  const ours = q.modelP
  const marks = (bots ?? []).filter((b) => b.title !== OUR_MODEL && botP?.[b.name] != null).map((b) => ({ t: b.title, p: botP[b.name] }))
  const ps = marks.map((m) => m.p)
  return (
    <div className={`sc-meter ${settled ? 'done' : ''}`}>
      <div className="sc-mq">
        <span className="sc-mtag">{settled ? `Settled ${q.outcome.toUpperCase()}` : `Closes ${hour(q.targetHour)}`}</span>
        <span className="sc-mtext">{q.text}</span>
      </div>
      <div className="sc-track">
        <span className="sc-half no">NO</span>
        <span className="sc-half yes">YES</span>
        {marks.map((m) => <i key={m.t} className="sc-tick" style={{ left: pct(m.p) }} title={`${m.t} ${pct(m.p)}`} />)}
        {ours != null && <i className="sc-ours" style={{ left: pct(ours) }} title={`Our model ${pct(ours)}`} />}
        <b className={`sc-roomp ${room >= 0.5 ? 'yes' : 'no'}`} style={{ left: pct(room) }}>{pct(room)}</b>
        {settled && <span className={`sc-outcome ${q.outcome}`} style={{ left: q.outcome === 'yes' ? '100%' : '0%' }} />}
      </div>
      <div className="sc-mleg">
        <span><b className="sc-k room" /> Room {pct(room)}</span>
        {ours != null && <span><b className="sc-k ours" /> Our model {pct(ours)}</span>}
        {ps.length > 0 && <span><b className="sc-k bot" /> Bots {pct(Math.min(...ps))} to {pct(Math.max(...ps))}</span>}
      </div>
    </div>
  )
}

function Crowd({ s }) {
  const qs = s.questions ?? []
  const open = qs.filter((q) => q.status !== 'settled')
  const settled = qs.filter((q) => q.status === 'settled').reverse()
  const shown = [...open, ...settled].slice(0, 3)
  return (
    <section className="sc-card sc-crowd">
      <div className="sc-h"><span>The room against the bots</span></div>
      {shown.map((q) => <Meter key={q.id} q={q} botP={s.botP?.[q.id]} bots={s.bots} />)}
      {!shown.length && <p className="sc-muted">Questions appear when the round starts.</p>}
    </section>
  )
}

function pickSeries(feed) {
  const labels = [...new Set(feed.map((f) => f.label))]
  const label = labels.find((l) => /^GB day-ahead/.test(l)) ?? labels.find((l) => /price/.test(l)) ?? labels[0]
  return label ? feed.filter((f) => f.label === label) : []
}

function DayChart({ s }) {
  const r = s.round
  const feed = s.feed ?? []
  const pts = pickSeries(feed)
  const off = feed.filter((f) => /switched off/.test(f.label)).at(-1)
  const W = 820
  const H = 250
  const pad = { l: 56, r: 18, t: 16, b: 34 }
  const x0 = r?.startHour ?? 0
  const x1 = r?.endHour ?? 23
  const vs = pts.map((p) => p.value)
  const lo = Math.floor(Math.min(0, ...vs) / 20) * 20
  const hi = Math.ceil(Math.max(lo + 20, ...vs) / 20) * 20
  const X = (h) => pad.l + ((h - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r)
  const Y = (v) => H - pad.b - ((v - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.hour).toFixed(1)},${Y(p.value).toFixed(1)}`).join('')
  const last = pts.at(-1)
  const unit = UNIT[last?.unit] ?? last?.unit ?? ''
  const ticks = [lo, (lo + hi) / 2, hi]
  return (
    <section className="sc-card sc-day">
      <div className="sc-h"><span>{last?.label ?? 'The day so far'}</span>{last && <b className="num">{unit.startsWith('£') || unit.startsWith('€') ? unit[0] : ''}{last.value.toFixed(0)}<small> {unit.replace(/^[£€]/, '')}</small></b>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="sc-svg" role="img" aria-label="The mystery day's prices so far">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} className="sc-grid" />
            <text x={pad.l - 10} y={Y(t) + 6} textAnchor="end" className="sc-ax">{t.toFixed(0)}</text>
          </g>
        ))}
        {[x0, Math.round((x0 + x1) / 2), x1].map((h) => <text key={h} x={X(h)} y={H - 8} textAnchor="middle" className="sc-ax">{hour(h)}</text>)}
        {r && r.clockHour <= x1 && <line x1={X(r.clockHour)} x2={X(r.clockHour)} y1={pad.t} y2={H - pad.b} className="sc-now" />}
        {line && <path d={line} className="sc-line" />}
        {last && <circle cx={X(last.hour)} cy={Y(last.value)} r="7" className="sc-dot" />}
      </svg>
      {off && <div className="sc-off">Wind switched off in GB so far: <b className="num">{off.value.toFixed(1)} GWh</b></div>}
      {!pts.length && <p className="sc-muted">Hours appear here as the clock plays the day.</p>}
    </section>
  )
}

function Bursts({ items }) {
  return (
    <div className="sc-bursts" aria-live="polite">
      {items.map((b) => (
        <div key={b.id} className={`sc-burst ${b.kind === 'settle' ? 'settle' : b.side}`}>
          {b.kind === 'settle' ? (
            <><b>{(b.outcome || '').toUpperCase()}</b> settled · {b.question}</>
          ) : (
            <><b>{b.who}</b> {b.shares > 0 ? 'bought' : 'sold'} {Math.abs(Math.round(b.shares))} <b className={b.side}>{b.side.toUpperCase()}</b><span> · {b.question}</span></>
          )}
        </div>
      ))}
    </div>
  )
}

function Playing({ s, bursts }) {
  return (
    <main className="sc-play">
      <section className="sc-card sc-race">
        <div className="sc-h"><span>Points</span><small className="sc-muted">open positions count once they settle</small></div>
        <LeaderboardRace rows={s.leaderboard ?? []} n={9} pin={OUR_MODEL} />
        <Bursts items={bursts} />
      </section>
      <Crowd s={s} />
      <DayChart s={s} />
    </main>
  )
}

const longDate = (d) => {
  const t = new Date(`${d}T12:00:00Z`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// One sentence on what the day did, from the hours the room just watched.
function daySentence(feed) {
  const pts = pickSeries(feed)
  if (!pts.length) return null
  const unit = UNIT[pts[0].unit] ?? pts[0].unit
  const sym = /^[£€]/.test(unit) ? unit[0] : ''
  const top = pts.reduce((a, b) => (b.value > a.value ? b : a))
  const low = pts.reduce((a, b) => (b.value < a.value ? b : a))
  const off = feed.filter((f) => /switched off/.test(f.label)).at(-1)
  const label = pts[0].label.replace(/^GB /, 'the GB ')
  return `${label[0].toUpperCase()}${label.slice(1)} ran from ${sym}${low.value.toFixed(0)} at ${hour(low.hour)} to ${sym}${top.value.toFixed(0)} at ${hour(top.hour)}${off ? `, and ${off.value.toFixed(1)} GWh of wind was paid to switch off` : ''}.`
}

function regimeOf(replay, feed) {
  if (replay?.title && !/^Replay of/.test(replay.title)) return replay.title
  const off = feed.filter((f) => /switched off/.test(f.label)).at(-1)
  if (!off) return null
  return off.value >= 10 ? 'A windy day: Scotland’s wind outran the wires' : 'A light-wind day'
}

function Reveal({ s }) {
  const r = s.round
  const replay = useReplay(r?.dayRevealed || null, s.demo)
  const feed = s.feed ?? []
  const people = (s.leaderboard ?? []).filter((x) => !x.isModel).sort((a, b) => b.points - a.points).slice(0, 3)
  const podium = [people[1], people[0], people[2]]
  const sentence = daySentence(feed)
  const regime = regimeOf(replay, feed)
  const [step, setStep] = useState(1)
  useEffect(() => {
    const ids = [1600, 3400, 5200].map((ms, i) => setTimeout(() => setStep(i + 2), ms))
    return () => ids.forEach(clearTimeout)
  }, [])
  const at = (n) => `sc-stage ${step >= n ? 'in' : ''}`
  return (
    <main className="sc-reveal">
      <section className={`sc-card sc-day-reveal ${at(1)}`}>
        <div className="sc-kicker">The mystery day was</div>
        <div className="sc-date">{r?.dayRevealed ? longDate(r.dayRevealed) : 'a real past day'}</div>
        {regime && <div className={`sc-regime ${at(2)}`}>{regime}</div>}
        {sentence && <p className={`sc-sentence ${at(2)}`}>{sentence}</p>}
        <p className={`sc-muted ${at(2)}`}>Real prices from that day, played back at speed. Every bot saw only data from before it.</p>
      </section>
      <div className={`sc-league ${at(3)}`}>
        <BotLeagueCard round={r} bots={s.bots ?? []} big />
      </div>
      <section className={`sc-card sc-podium ${at(4)}`}>
        <div className="sc-h"><span>Top of the room</span></div>
        <div className="sc-steps">
          {podium.map((p, i) => p && (
            <div key={p.name} className={`sc-step p${[2, 1, 3][i]}`}>
              <div className="sc-pname">{p.name}</div>
              <div className="sc-ppts num">{p.points.toFixed(0)} pts</div>
              <div className="sc-block num">{[2, 1, 3][i]}</div>
            </div>
          ))}
        </div>
        {!people.length && <p className="sc-muted">No players traded this round.</p>}
      </section>
    </main>
  )
}

function MarketScreen() {
  const code = (param('code') || '').toUpperCase().slice(0, 8) || null
  const demo = param('demo') === '1'
  const [s, bursts] = useScreen(code, demo)
  const phase = phaseOf(s)
  const roomCode = code ?? s.lobby?.code ?? null
  const url = useMemo(() => joinUrl(roomCode), [roomCode])
  useEffect(() => {
    document.body.classList.add('sc-body')
    return () => document.body.classList.remove('sc-body')
  }, [])
  return (
    <div className="sc" data-phase={phase}>
      <Header s={s} phase={phase} code={roomCode} url={url} />
      {s.status === 'connecting' && <div className="sc-status">Connecting to the game server…</div>}
      {s.status === 'offline' && <div className="sc-status">The game server is out of reach. Check the network and reload.</div>}
      {s.status === 'live' && (phase === 'waiting' || phase === 'countdown') && <Waiting s={s} url={url} code={roomCode} phase={phase} />}
      {s.status === 'live' && phase === 'playing' && <Playing s={s} bursts={bursts} />}
      {s.status === 'live' && phase === 'reveal' && <Reveal s={s} />}
      <style>{CSS}</style>
    </div>
  )
}

// A room of Beat the model plays on its own tables, so its screen reads the lobby and beat_* (room/BeatScreen.jsx);
// every other room, and #/screen without a code, keeps the market screen.
function BeatScreen({ room, code }) {
  const phase = beatPhase(room)
  const url = useMemo(() => joinUrl(code), [code])
  useEffect(() => {
    document.body.classList.add('sc-body')
    return () => document.body.classList.remove('sc-body')
  }, [])
  return (
    <div className="sc" data-phase={phase === 'answer' || phase === 'reveal' ? 'playing' : phase === 'end' ? 'reveal' : phase}>
      <BeatHeader room={room} phase={phase} />
      {(phase === 'waiting' || phase === 'countdown') && <Waiting s={{ players: room.members, bots: [] }} url={url} code={code} phase={phase} how={BEAT_HOW} />}
      {(phase === 'answer' || phase === 'reveal') && <BeatPlaying room={room} />}
      {phase === 'end' && <BeatEnd room={room} />}
      <style>{CSS}{BEAT_CSS}</style>
    </div>
  )
}

const PM_HOW = [
  'We pick a real past day of Europe’s grid and hide the date.',
  'Yes/no markets: buy YES or NO on your phone. The model sets the price and it moves every game hour.',
  'Profit by being right before the price catches up. Points only, no money. Beat the bots.',
]

function PmRoomScreen({ room, code }) {
  const phase = pmPhase(room)
  const url = useMemo(() => joinUrl(code), [code])
  useEffect(() => {
    document.body.classList.add('sc-body')
    return () => document.body.classList.remove('sc-body')
  }, [])
  return (
    <div className="sc" data-phase={phase === 'end' ? 'reveal' : phase}>
      <PmHeader room={room} phase={phase} />
      {(phase === 'waiting' || phase === 'countdown') && <Waiting s={{ players: room.members, bots: [] }} url={url} code={code} phase={phase} how={PM_HOW} />}
      {phase === 'playing' && <PmPlaying room={room} />}
      {phase === 'end' && <PmEnd room={room} />}
      <style>{CSS}{BEAT_CSS}{PM_CSS}</style>
    </div>
  )
}

function Screen() {
  const code = (param('code') || '').toUpperCase().slice(0, 8) || null
  const demo = param('demo') === '1'
  const [room, setRoom] = useState({ status: 'connecting' })
  useEffect(() => {
    if (demo || !code || import.meta.env?.VITE_LG_OFFLINE === '1') return undefined
    const c = connectRoom({ code, onState: setRoom })
    return () => c.close()
  }, [code, demo])
  if (!demo && code && room.lobby?.mode === 'beat') return <BeatScreen room={room} code={code} />
  if (!demo && code && room.lobby?.mode === 'pm') return <PmRoomScreen room={room} code={code} />
  if (!demo && code && room.status === 'connecting') return <div className="sc"><div className="sc-status">Connecting to the game server…</div><style>{CSS}</style></div>
  return <MarketScreen />
}

export default { path: '/screen', title: 'Big screen', Component: Screen }
