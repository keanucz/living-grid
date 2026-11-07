import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../shell/icons.jsx'
import { connectMarket, tradeCost } from './connection.js'
import { BotLeagueCard } from '../../panels/botLeague/Card.jsx'

// Mystery-day prediction market. Phone: #/market. Big screen: #/market?screen=1 (leaderboard, room vs model).
// A real past day with its date hidden; points only, no money. Prices are the room's probability (LMSR).
const SIZES = [10, 25, 50, 100]
const START_POINTS = 1000
const hour = (h) => `${String(h).padStart(2, '0')}:00`
const pct = (p) => `${Math.round(p * 100)}%`
const pts = (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) < 100 ? 1 : 0)}`
const isScreen = () => /[?&]screen(=1|=true|&|$)/.test(location.hash)

const RIVAL_KEY = 'lg-market-rival'
function useRival() {
  const [rival, setRival] = useState(() => {
    try {
      return localStorage.getItem(RIVAL_KEY) || ''
    } catch {
      return ''
    }
  })
  const pick = (name) => {
    setRival(name)
    try {
      localStorage.setItem(RIVAL_KEY, name)
    } catch {
      /* private window: the pick lasts until reload */
    }
  }
  return [rival, pick]
}

function useRegime(day) {
  const [title, setTitle] = useState(null)
  useEffect(() => {
    if (!day) return
    let live = true
    fetch(`/api/replay?event=${day}`).then((r) => (r.ok ? r.json() : null)).then((d) => live && setTitle(d?.title ?? null)).catch(() => {})
    return () => (live = false)
  }, [day])
  return title
}

function useMarket() {
  const [s, setS] = useState({ status: 'connecting' })
  const api = useRef(null)
  useEffect(() => {
    api.current = connectMarket({ onState: (n) => setS((p) => ({ ...p, ...n })) })
    return () => api.current?.close()
  }, [])
  return [s, api]
}

function Join({ onJoin, busy }) {
  const [name, setName] = useState('')
  return (
    <form className="mk-card" onSubmit={(e) => (e.preventDefault(), name.trim() && onJoin(name.trim()))}>
      <label className="mk-field">
        <span>Your name on the leaderboard</span>
        <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ada" autoFocus />
      </label>
      <button className="mk-primary" disabled={busy || !name.trim()}>Join the market</button>
    </form>
  )
}

function Question({ q, round, pos, points, busy, onTrade, rival, rivalP }) {
  const [size, setSize] = useState(25)
  const open = q.status === 'open' && round.status === 'running' && round.clockHour < q.targetHour
  const settled = q.status === 'settled'
  const yes = pos?.yes ?? 0
  const no = pos?.no ?? 0
  const costYes = tradeCost(q, 'yes', size, round.b)
  const costNo = tradeCost(q, 'no', size, round.b)
  const win = settled ? q.outcome : null
  const payout = win ? (win === 'yes' ? yes : no) : 0
  const net = pos ? payout - pos.spent : 0
  return (
    <article className={`mk-card mk-q ${settled ? 'done' : ''}`}>
      <div className="mk-qtop">
        <span className="mk-tag">{settled ? 'Settled' : open ? `Closes ${hour(q.targetHour)}` : `Settles after ${hour(q.targetHour)}`}</span>
        {q.modelNote && <span className="mk-faint" title={q.modelNote}>ⓘ</span>}
      </div>
      <h3>{q.text}</h3>
      <div className="mk-prob" aria-label={`The room gives YES ${pct(q.priceYes)}`}>
        <div className="mk-bar"><i style={{ width: pct(q.priceYes) }} /></div>
        <div className="mk-probnums"><b className="yes">YES {pct(q.priceYes)}</b><b className="no">NO {pct(1 - q.priceYes)}</b></div>
      </div>

      {rival && rivalP && (
        <div className="mk-rivalp">🤖 {rival.title} says <b>{pct(rivalP.p)}</b> YES{rivalP.note ? <span className="mk-faint"> · {rivalP.note}</span> : null}</div>
      )}
      {open && (
        <>
          <div className="mk-sizes" role="group" aria-label="Number of shares">
            {SIZES.map((n) => <button key={n} className={n === size ? 'on' : ''} onClick={() => setSize(n)}>{n}</button>)}
            <span className="mk-faint">shares · each pays 1 point if right</span>
          </div>
          <div className="mk-trade">
            <button className="mk-yes" disabled={busy || costYes > points} onClick={() => onTrade('buy', q.id, 'yes', size)}>Buy YES<small>{pts(costYes)} pts</small></button>
            <button className="mk-no" disabled={busy || costNo > points} onClick={() => onTrade('buy', q.id, 'no', size)}>Buy NO<small>{pts(costNo)} pts</small></button>
          </div>
        </>
      )}
      {(yes > 0 || no > 0) && (
        <div className="mk-hold">
          <span>You hold {yes > 0 && <b className="yes">{yes} YES</b>}{yes > 0 && no > 0 && ' · '}{no > 0 && <b className="no">{no} NO</b>} <span className="mk-faint">(spent {pts(pos.spent)})</span></span>
          {open && (
            <span className="mk-sell">
              {yes > 0 && <button disabled={busy} onClick={() => onTrade('sell', q.id, 'yes', Math.min(size, yes))}>Sell {Math.min(size, yes)} YES</button>}
              {no > 0 && <button disabled={busy} onClick={() => onTrade('sell', q.id, 'no', Math.min(size, no))}>Sell {Math.min(size, no)} NO</button>}
            </span>
          )}
        </div>
      )}
      {settled && (
        <div className="mk-result">
          <b className={win}>{win === 'yes' ? 'YES' : 'NO'}</b> won{q.unit ? ` (actual ${Number(q.actual).toFixed(1)} ${q.unit})` : ''}. The room closed at {pct(q.roomPClose)}; our model said {pct(q.modelP)}.
          {pos && <> You {net >= 0 ? 'made' : 'lost'} <b className={net >= 0 ? 'yes' : 'no'}>{pts(Math.abs(net))} pts</b> here.</>}
        </div>
      )}
    </article>
  )
}

function Calibration({ round, big }) {
  const have = round.nSettled > 0 && round.roomBrier >= 0
  const worst = Math.max(0.25, round.roomBrier, round.modelBrier)
  const rows = [
    { id: 'room', label: 'The room', v: round.roomBrier },
    { id: 'model', label: 'Our model', v: round.modelBrier },
  ]
  return (
    <section className={`mk-card mk-cal ${big ? 'big' : ''}`}>
      <div className="mk-h">Room against our model</div>
      {!have && <p className="mk-muted">Scores appear as questions settle. Brier score: lower is better; always saying 50% scores 0.25.</p>}
      {have && rows.map((r) => (
        <div key={r.id} className="mk-calrow">
          <span>{r.label}</span>
          <div className="mk-bar"><i className={r.id} style={{ width: `${Math.min(100, (r.v / worst) * 100)}%` }} /></div>
          <b className="num">{r.v.toFixed(3)}</b>
        </div>
      ))}
      {have && <p className="mk-muted">Brier score over {round.nSettled} settled question{round.nSettled === 1 ? '' : 's'}; lower is better, always saying 50% scores 0.25. {round.roomBrier < round.modelBrier ? 'The room beat the model.' : round.roomBrier > round.modelBrier ? 'The model beat the room.' : 'A tie.'}</p>}
    </section>
  )
}

function Leaderboard({ rows, meName, rivalTitle, n = 8 }) {
  return (
    <section className="mk-card">
      <div className="mk-h">Points</div>
      {rows.slice(0, n).map((r) => (
        <div key={r.rank + r.name} className={`mk-lb ${r.isModel ? 'model' : ''} ${r.name === meName ? 'me' : ''} ${r.name === rivalTitle ? 'rival' : ''}`}>
          <span className="num">{r.rank}</span><span>{r.name}{r.isModel && ' 🤖'}{r.name === rivalTitle && <small> · your rival</small>}</span><b className="num">{pts(r.points)}</b>
        </div>
      ))}
      {!rows.length && <p className="mk-muted">Nobody has traded yet.</p>}
      <p className="mk-muted">Open positions are not valued until their question settles, so points dip when you buy.</p>
    </section>
  )
}

function Header({ round }) {
  return (
    <header className="mk-top">
      <a href="#/" className="mk-logo" aria-label="Back to the map"><Icon name="bolt" size={18} stroke={2.2} /></a>
      <div style={{ flex: 1 }}>
        <div className="mk-kicker">The Living Grid · mystery day</div>
        <h1>{round?.title || 'Predict the grid'}</h1>
      </div>
      {round && <div className="mk-clock num" title="Game clock">{hour(Math.min(round.clockHour, 23))}</div>}
    </header>
  )
}

function Reveal({ round }) {
  const regime = useRegime(round.status === 'done' ? round.dayRevealed : null)
  if (round.status !== 'done') return null
  return (
    <div className="mk-reveal">
      Round over. The mystery day was <b>{round.dayRevealed || 'a real past day'}</b>{regime ? <> — {regime}</> : null}: real prices, played back at speed.
    </div>
  )
}

// Meet the bots: name, one-line method, how it stakes, and its score so far; tap to make one your rival.
function Bots({ bots, rival, onPick }) {
  if (!bots?.length) return null
  const style = (k) => (k >= 0.45 ? 'bold stakes' : k >= 0.25 ? 'steady stakes' : 'small stakes')
  return (
    <section className="mk-card">
      <div className="mk-h">The bots{rival ? '' : ' — pick a rival to beat'}</div>
      {bots.map((b) => (
        <button key={b.name} className={`mk-bot ${rival === b.name ? 'on' : ''}`} onClick={() => onPick(rival === b.name ? '' : b.name)} aria-pressed={rival === b.name}>
          <span className="mk-bot-t">🤖 {b.title}{rival === b.name && <small> · your rival</small>}</span>
          <span className="mk-bot-m">{b.method}</span>
          <span className="mk-bot-s">{style(b.kelly)}{b.brier != null ? ` · Brier ${b.brier.toFixed(3)} over ${b.n}` : ''}</span>
        </button>
      ))}
    </section>
  )
}

function Phone() {
  const [s, api] = useMarket()
  const [rivalName, pickRival] = useRival()
  const rival = s.bots?.find((b) => b.name === rivalName) ?? null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const call = (fn) => {
    setBusy(true)
    setError(null)
    Promise.resolve()
      .then(fn)
      .catch((e) => setError(e?.message || 'That did not go through. Try again.'))
      .finally(() => setBusy(false))
  }
  const round = s.round
  const points = s.account?.points ?? START_POINTS
  const trade = (kind, id, side, shares) => call(() => (kind === 'buy' ? api.current.buy(id, side, shares) : api.current.sell(id, side, shares)))
  return (
    <div className="mk">
      <Header round={round} />
      <p className="mk-muted">A real past day with its date hidden, replayed one hour at a time. Buy YES or NO with play points; the price is the room’s probability. Points only, no money.</p>
      {s.status === 'connecting' && <p className="mk-muted">Connecting…</p>}
      {s.status === 'offline' && <p className="mk-muted">The game server is out of reach. Check the Wi-Fi and reload.</p>}
      {error && <p className="mk-error">{error}</p>}
      {s.status === 'live' && !round && <p className="mk-card mk-muted">No round is running. The host starts one from the engine.</p>}
      {round && <Reveal round={round} />}
      {s.status === 'live' && round && !s.player && <Join busy={busy} onJoin={(name) => call(() => api.current.join(name))} />}
      {s.player && round && (
        <>
          <section className="mk-me">
            <div>
              <div className="mk-muted">{s.player.name}</div><div className="mk-score num">{pts(points)} pts</div>
              {rival && rival.points != null && (
                <div className="mk-muted">vs {rival.title}: <b className={points >= rival.points ? 'yes' : 'no'}>{points >= rival.points ? 'ahead by' : 'behind by'} {pts(Math.abs(points - rival.points))}</b></div>
              )}
            </div>
            <span className="mk-tag">{s.leaderboard?.find((r) => r.name === s.player.name) ? `#${s.leaderboard.find((r) => r.name === s.player.name).rank}` : 'Not traded yet'}</span>
          </section>
          {round.status === 'done' && <BotLeagueCard round={round} bots={s.bots ?? []} rivalName={rival?.title} />}
          <Bots bots={s.bots} rival={rivalName} onPick={pickRival} />
          {s.questions.map((q) => <Question key={q.id} q={q} round={round} pos={s.positions?.[q.id]} points={points} busy={busy} onTrade={trade} rival={rival} rivalP={rival ? s.botP?.[q.id]?.[rival.name] : null} />)}
          {s.feed?.length > 0 && (
            <section className="mk-card">
              <div className="mk-h">What happened</div>
              {s.feed.slice(-6).reverse().map((f) => (
                <div key={f.key} className="mk-row"><span>{hour(f.hour)} · {f.label}</span><b className="num">{Number(f.value).toFixed(1)} {f.unit}</b></div>
              ))}
            </section>
          )}
          {round.status !== 'done' && s.bots?.length > 0 && <BotLeagueCard round={round} bots={s.bots} rivalName={rival?.title} />}
          {!s.bots?.length && <Calibration round={round} />}
          <Leaderboard rows={s.leaderboard ?? []} meName={s.player.name} rivalTitle={rival?.title} />
        </>
      )}
      <style>{CSS}</style>
    </div>
  )
}

function Screen() {
  const [s] = useMarket()
  const round = s.round
  const last = s.feed?.at(-1)
  return (
    <div className="mk mk-wide">
      <Header round={round} />
      {s.status === 'offline' && <p className="mk-muted">The game server is out of reach.</p>}
      {!round && s.status === 'live' && <p className="mk-card mk-muted">No round is running.</p>}
      {round && <Reveal round={round} />}
      {round && (
        <div className="mk-cols">
          <Leaderboard rows={s.leaderboard ?? []} n={10} />
          <div>
            {s.bots?.length ? <BotLeagueCard round={round} bots={s.bots} big /> : <Calibration round={round} big />}
            <section className="mk-card">
              <div className="mk-h">Questions</div>
              {s.questions.map((q) => (
                <div key={q.id} className="mk-row">
                  <span>{q.text}</span>
                  <b className="num">{q.status === 'settled' ? `${q.outcome.toUpperCase()} · room ${pct(q.roomPClose)} / model ${pct(q.modelP)}` : `room ${pct(q.priceYes)}`}</b>
                </div>
              ))}
            </section>
            {last && <p className="mk-muted">Latest from the day: {hour(last.hour)} · {last.label} {Number(last.value).toFixed(1)} {last.unit}</p>}
          </div>
        </div>
      )}
      <style>{CSS}</style>
    </div>
  )
}

function Market() {
  return isScreen() ? <Screen /> : <Phone />
}

const CSS = `
body { overflow: auto; }
.mk { max-width: 520px; margin: 0 auto; padding: 20px 16px 40px; min-height: 100%; }
.mk-wide { max-width: 1100px; }
.mk-cols { display: grid; grid-template-columns: 360px 1fr; gap: 14px; align-items: start; }
@media (max-width: 800px) { .mk-cols { grid-template-columns: 1fr; } }
.mk-top { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
.mk-logo { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); flex: none; }
.mk-kicker { font-size: 12px; color: var(--text-3); }
.mk h1 { font-size: 22px; margin: 2px 0 0; letter-spacing: -0.02em; }
.mk-clock { font-size: 26px; font-weight: 700; color: var(--accent); }
.mk-card, .mk-me { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px; margin-bottom: 10px; }
.mk-me { display: flex; justify-content: space-between; align-items: center; }
.mk-score { font-size: 26px; font-weight: 700; color: var(--accent); }
.mk-tag { padding: 4px 10px; border-radius: 999px; background: var(--accent-dim); color: var(--accent); font-size: 12px; white-space: nowrap; }
.mk-h { font-weight: 600; margin-bottom: 6px; }
.mk-muted { font-size: 12px; color: var(--text-2); margin: 4px 0 10px; line-height: 1.45; }
.mk-faint { font-size: 11px; color: var(--text-3); }
.mk-error { font-size: 13px; color: var(--hot); background: var(--hot-dim); border-radius: 12px; padding: 8px 12px; }
.mk-reveal { background: var(--accent-dim); color: var(--text); border-radius: 14px; padding: 10px 14px; margin-bottom: 10px; font-size: 14px; }
.mk-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-2); margin-bottom: 12px; }
.mk-field input { height: 46px; border-radius: 14px; background: var(--card); border: 1px solid var(--line-2); color: var(--text); padding: 0 12px; font: inherit; font-size: 16px; }
.mk-primary { width: 100%; height: 48px; border-radius: 14px; border: 0; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 600; font-size: 15px; }
.mk-primary:disabled { opacity: .5; }
.mk-q h3 { margin: 6px 0 10px; font-size: 16px; line-height: 1.3; font-weight: 600; }
.mk-qtop { display: flex; justify-content: space-between; align-items: center; }
.mk-bar { height: 10px; border-radius: 5px; background: var(--card); overflow: hidden; }
.mk-bar i { display: block; height: 100%; border-radius: 5px; background: var(--accent); transition: width .5s; }
.mk-bar i.model { background: var(--hydro); }
.mk-probnums { display: flex; justify-content: space-between; margin-top: 6px; font-size: 14px; }
.yes { color: var(--accent); } .no { color: var(--hot); }
.mk-sizes { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 12px 0 8px; }
.mk-sizes button { min-width: 44px; height: 34px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--card); color: var(--text-2); font: inherit; font-size: 13px; }
.mk-sizes button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
.mk-trade { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mk-trade button { height: 54px; border-radius: 14px; border: 1px solid var(--line-2); font: inherit; font-weight: 700; font-size: 15px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.mk-trade small { font-weight: 400; font-size: 11px; opacity: .8; }
.mk-trade .mk-yes { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
.mk-trade .mk-no { background: var(--hot-dim); border-color: var(--hot); color: var(--hot); }
.mk-trade button:disabled { opacity: .4; }
.mk-hold { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; font-size: 13px; }
.mk-sell { display: flex; gap: 6px; }
.mk-sell button { padding: 5px 10px; border-radius: 999px; background: var(--card); color: var(--text-2); font: inherit; font-size: 12px; }
.mk-result { margin-top: 10px; font-size: 13px; line-height: 1.45; color: var(--text-2); }
.mk-q.done { opacity: .9; }
.mk-calrow { display: grid; grid-template-columns: 80px 1fr 56px; gap: 10px; align-items: center; margin-bottom: 6px; font-size: 13px; }
.mk-cal.big .mk-calrow { font-size: 18px; grid-template-columns: 120px 1fr 80px; }
.mk-lb { display: grid; grid-template-columns: 28px 1fr auto; gap: 8px; padding: 5px 0; font-size: 14px; border-top: 1px solid var(--line); }
.mk-lb.model { color: var(--hydro); } .mk-lb.me { color: var(--accent); font-weight: 600; }
.mk-bot { display: grid; gap: 2px; width: 100%; text-align: left; padding: 8px 10px; margin-top: 6px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--card); color: var(--text); font: inherit; }
.mk-bot.on { border-color: var(--accent); background: var(--accent-dim); }
.mk-bot-t { font-weight: 600; font-size: 14px; } .mk-bot-t small { color: var(--accent); font-weight: 400; }
.mk-bot-m { font-size: 12px; color: var(--text-2); } .mk-bot-s { font-size: 11px; color: var(--text-3); }
.mk-rivalp { margin-top: 8px; font-size: 13px; color: var(--text-2); } .mk-rivalp b { color: var(--text); }
.mk-lb.rival { background: var(--accent-dim); border-radius: 8px; } .mk-lb small { color: var(--accent); }
.mk-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 4px 0; }
`

export default { path: '/market', title: 'Mystery-day market', Component: Market }
