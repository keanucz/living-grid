import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Icon } from '../../shell/icons.jsx'
import { connectMarket } from '../market/connection.js'
import { Phone } from '../market/index.jsx'
import { BatteryMode } from './BatteryMode.jsx'
import { DemoPlay, isDemo } from '../play/DemoPlay.jsx'
import { BeatRoom, PmSolo } from '../play/Live.jsx'
import { AVATARS, Avatar, avatarIds } from './avatars.jsx'
import {
  COUNTDOWN_S, QUESTION_COUNTS, SPEEDS, countdownLeft, members, myLobby, normaliseCode, playLink, roundLength, routeCode, screenLink,
} from './logic.js'

// Game lobby. Host a game (4-letter code, QR, link to the big screen) or join by code; waiting room with ready ticks;
// host settings and Start; 5 s countdown on every screen; the round; rematch. Deep link: #/play/<CODE>.
const PROFILE_KEY = 'lg-lobby-profile'
// The screen that plays each game mode (lobby.mode).
const ROUNDS = { beat: (props) => <BeatRoom {...props} />, market: (props) => <Phone {...props} />, battery: (props) => <BatteryMode {...props} /> }

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}')
  } catch {
    return {}
  }
}
function saveProfile(p) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
  } catch {
    /* private window: asked again next time */
  }
}

function useRouteCode() {
  const [code, setCode] = useState(() => routeCode(location.hash))
  useEffect(() => {
    const on = () => setCode(routeCode(location.hash))
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return code
}

function useLobby() {
  const [s, setS] = useState({ status: 'connecting' })
  const api = useRef(null)
  useEffect(() => {
    api.current = connectMarket({ onState: (n) => setS((p) => ({ ...p, ...n })) })
    return () => api.current?.close()
  }, [])
  return [s, api]
}

const go = (code) => {
  location.hash = code ? `#/play/${code}` : '#/play'
}

function Header({ sub }) {
  return (
    <header className="lb-top">
      <a href="#/" className="lb-logo" aria-label="Back to the map"><Icon name="bolt" size={18} stroke={2.2} /></a>
      <div>
        <div className="lb-kicker">The Living Grid · mystery day</div>
        <h1>{sub}</h1>
      </div>
    </header>
  )
}

function AvatarPicker({ value, onChange }) {
  return (
    <div className="lb-avs" role="radiogroup" aria-label="Pick your avatar">
      {AVATARS.map((a) => (
        <button key={a.id} type="button" role="radio" aria-checked={value === a.id} className={value === a.id ? 'on' : ''} onClick={() => onChange(a.id)} title={a.label}>
          <Avatar id={a.id} size={34} />
        </button>
      ))}
    </div>
  )
}

function Segmented({ label, options, value, onChange, disabled }) {
  return (
    <div className="lb-seg-wrap">
      <span className="lb-label">{label}</span>
      <div className="lb-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} disabled={disabled} onClick={() => onChange(o.value)} title={o.note}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Profile({ profile, setProfile, autoFocus }) {
  return (
    <>
      <label className="lb-field">
        <span>Your name</span>
        <input value={profile.name ?? ''} maxLength={20} autoFocus={autoFocus} placeholder="e.g. Ada" onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
      </label>
      <span className="lb-label">Your avatar</span>
      <AvatarPicker value={profile.avatar ?? avatarIds[0]} onChange={(avatar) => setProfile({ ...profile, avatar })} />
    </>
  )
}

const defaultName = () => `Player ${100 + Math.floor(Math.random() * 900)}`

function Landing({ profile, setProfile, queue, onSolo, onHost, onJoinCode, onQuick, onCancel }) {
  const [code, setCode] = useState('')
  const waiting = queue?.waiting?.beat ?? 0
  return (
    <>
      <section className="lb-card lb-quick">
        <h2>Beat the model</h2>
        <p className="lb-muted">Trade yes/no markets on a mystery day against our model. Buy what you think is underpriced, sell before it moves, and see whether you out-earn the model and the bots.</p>
        <Profile profile={profile} setProfile={setProfile} />
        <button className="lb-primary" onClick={onSolo}>Play solo</button>
      </section>
      <section className="lb-card">
        <h2>Play with others</h2>
        {queue?.mine ? (
          <>
            <p className="lb-muted"><b>Looking for another player…</b> {waiting} waiting. The game starts a few seconds after a second person arrives. Ask a friend to scan the same QR code.</p>
            <button className="lb-ghost wide" onClick={onCancel}>Cancel</button>
          </>
        ) : (
          <>
            <p className="lb-muted">Quick play matches you with whoever is waiting. Or host a room and share its code.</p>
            <button className="lb-ghost wide" onClick={onQuick}>Quick play{waiting ? ` · ${waiting} waiting` : ''}</button>
            <button className="lb-ghost wide" style={{ marginTop: 8 }} onClick={onHost}>Host a room</button>
          </>
        )}
      </section>
      <section className="lb-card">
        <h2>Join with a code</h2>
        <form onSubmit={(e) => (e.preventDefault(), code.length === 4 && onJoinCode(code))}>
          <label className="lb-field">
            <span>Code from the host</span>
            <input className="lb-code-in" value={code} maxLength={4} inputMode="text" autoCapitalize="characters" autoComplete="off" placeholder="ABCD" onChange={(e) => setCode(normaliseCode(e.target.value))} />
          </label>
          <button className="lb-ghost wide" disabled={code.length !== 4}>Continue</button>
        </form>
      </section>
      <a className="lb-link" href="#/play?demo=1">Try a rehearsal day (invented markets)</a>
    </>
  )
}

const MODES = [
  { value: 'beat', label: 'Beat the model', note: 'Five calls on a mystery day: call it, say how sure you are, and see if you beat the model and the bots' },
  { value: 'battery', label: 'Battery', note: 'Charge, hold or discharge a 1 MW battery against two planning agents' },
]

function HostForm({ profile, setProfile, busy, onCreate, onBack }) {
  const [mode, setMode] = useState('beat')
  const ok = (profile.name ?? '').trim().length > 0
  return (
    <section className="lb-card">
      <h2>Host a game</h2>
      <Profile profile={profile} setProfile={setProfile} autoFocus />
      <Segmented label="Game" options={MODES} value={mode} onChange={setMode} />
      <p className="lb-muted">{MODES.find((m) => m.value === mode).note}. The code and QR appear in the waiting room.</p>
      <button className="lb-primary" disabled={busy || !ok} onClick={() => onCreate({ mode })}>Create game</button>
      <button className="lb-link" onClick={onBack}>Back</button>
    </section>
  )
}

function JoinForm({ code, profile, setProfile, busy, onJoin, onBack }) {
  const ok = (profile.name ?? '').trim().length > 0
  return (
    <section className="lb-card">
      <h2>Join game <span className="lb-code-s">{code}</span></h2>
      <Profile profile={profile} setProfile={setProfile} autoFocus />
      <button className="lb-primary" disabled={busy || !ok} onClick={() => onJoin(code)}>Join</button>
      <button className="lb-link" onClick={onBack}>Use a different code</button>
    </section>
  )
}

function ShareCard({ lobby }) {
  const [qr, setQr] = useState(null)
  const [copied, setCopied] = useState(false)
  const link = playLink(lobby.code)
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: '#0a0a0a', light: '#fafafa' } }).then(setQr).catch(() => setQr(null))
  }, [link])
  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500))).catch(() => {})
  }
  return (
    <section className="lb-card lb-share">
      <div className="lb-code" aria-label={`Game code ${lobby.code.split('').join(' ')}`}>{lobby.code}</div>
      <div className="lb-muted">Join at this address with the code, or scan:</div>
      {qr && <img src={qr} alt={`QR code to join game ${lobby.code}`} width="160" height="160" className="lb-qr" />}
      <div className="lb-row">
        <button className="lb-ghost" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        <a className="lb-ghost" href={screenLink(lobby.code)} target="_blank" rel="noreferrer">Big screen ↗</a>
      </div>
    </section>
  )
}

function Settings({ lobby, busy, onChange }) {
  const set = (patch) => onChange({ mode: lobby.mode, secondsPerHour: lobby.secondsPerHour, nQuestions: lobby.nQuestions, botsOn: lobby.botsOn, ...patch })
  return (
    <section className="lb-card">
      <h2>Settings</h2>
      <Segmented label="Game" options={MODES} value={lobby.mode} onChange={(mode) => set({ mode })} disabled={busy} />
      {lobby.mode === 'beat' ? <p className="lb-muted">Five calls, about 15 seconds each, with the bots playing along. A round takes under two minutes.</p> : <>
      <Segmented label="Speed" options={SPEEDS} value={lobby.secondsPerHour} onChange={(secondsPerHour) => set({ secondsPerHour })} disabled={busy} />
      <Segmented label="Questions" options={QUESTION_COUNTS.map((n) => ({ value: n, label: String(n) }))} value={lobby.nQuestions} onChange={(nQuestions) => set({ nQuestions })} disabled={busy} />
      <label className="lb-check"><input type="checkbox" checked={lobby.botsOn} disabled={busy} onChange={(e) => set({ botsOn: e.target.checked })} /> Bots play too</label>
      <p className="lb-muted">A round takes {roundLength(lobby.secondsPerHour)}.</p></>}
    </section>
  )
}

function Players({ s, lobby, isHost, busy, onKick }) {
  const list = members(s, lobby)
  return (
    <section className="lb-card">
      <h2>Players <span className="lb-count">{list.length}</span></h2>
      <ul className="lb-players">
        {list.map((p) => (
          <li key={p.id} className={p.id === s.me ? 'me' : ''}>
            <Avatar id={p.avatar} size={30} />
            <span className="lb-pn">{p.name}{p.id === lobby.host && <small> · host</small>}{p.id === s.me && p.id !== lobby.host && <small> · you</small>}</span>
            <span className={`lb-tick ${p.ready || p.id === lobby.host ? 'on' : ''}`} aria-label={p.ready || p.id === lobby.host ? 'Ready' : 'Not ready'}>{p.ready || p.id === lobby.host ? '✓' : '…'}</span>
            {isHost && p.id !== s.me && <button className="lb-kick" disabled={busy} onClick={() => onKick(p.id)} aria-label={`Remove ${p.name}`}>✕</button>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Waiting({ s, lobby, busy, run, api }) {
  const isHost = lobby.host === s.me
  const mine = s.lobbyPlayers?.find((p) => p.id === s.me && p.lobbyId === lobby.id)
  const list = members(s, lobby)
  const others = list.filter((p) => p.id !== lobby.host)
  const ready = others.filter((p) => p.ready).length
  return (
    <>
      <ShareCard lobby={lobby} />
      <Players s={s} lobby={lobby} isHost={isHost} busy={busy} onKick={(id) => run(() => api.current.lobbyKick(id))} />
      {isHost && <Settings lobby={lobby} busy={busy} onChange={(o) => run(() => api.current.lobbySettings(o))} />}
      {isHost ? (
        <section className="lb-card">
          <button className="lb-primary" disabled={busy} onClick={() => run(() => api.current.lobbyStart())}>Start game</button>
          <p className="lb-muted">{others.length ? `${ready} of ${others.length} ready. You can start any time.` : 'Waiting for players. You can start on your own.'}</p>
        </section>
      ) : (
        <section className="lb-card">
          <button className={`lb-primary ${mine?.ready ? 'done' : ''}`} disabled={busy} onClick={() => run(() => api.current.lobbyReady(!mine?.ready))}>
            {mine?.ready ? '✓ Ready (tap to undo)' : 'Ready'}
          </button>
          <p className="lb-muted">The host starts the game when everyone is in.</p>
        </section>
      )}
      <button className="lb-link" onClick={() => run(() => api.current.lobbyLeave().then(() => go('')))}>Leave game</button>
    </>
  )
}

function Countdown({ lobby, onVote, vote, players = [], tally = null }) {
  const seen = useRef(Date.now())
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    seen.current = Date.now()
    const t = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [lobby.id, lobby.state])
  const left = countdownLeft(lobby.countdownEnd ?? 0, now, seen.current, lobby.countdownS ?? COUNTDOWN_S)
  return (
    <section className="lb-card lb-count-wrap" role="timer" aria-live="polite">
      <div className="lb-muted">Game {lobby.code} starts in</div>
      <div className="lb-big num">{left > 0 ? left : 'Go'}</div>
      <div className="lb-muted">Get ready: a real day from the past, date hidden.</div>
      {players.length > 0 && (
        <ul className="lb-faces" aria-label="Players in this game">
          {players.map((p) => <li key={p.id} title={p.name}><Avatar id={p.avatar} size={30} /><span>{p.name}</span></li>)}
        </ul>
      )}
      {onVote && (
        <div className="lb-row">
          <button className={`lb-ghost ${vote === 'start' ? 'on' : ''}`} onClick={() => onVote('start')}>Start now{tally ? ` · ${tally.start}` : ''}</button>
          <button className={`lb-ghost ${vote === 'wait' ? 'on' : ''}`} onClick={() => onVote('wait')}>Wait for more{tally ? ` · ${tally.wait}` : ''}</button>
        </div>
      )}
    </section>
  )
}

function RoundFooter({ s, lobby, busy, run, api, profile }) {
  const isHost = lobby.host === s.me
  const over = lobby.state === 'reveal'
  const quick = lobby.kind === 'quick'
  const again = () => run(() => api.current.lobbyLeave().then(() => api.current.quickPlay((profile?.name ?? '').trim() || defaultName(), profile?.avatar ?? avatarIds[0], lobby.mode)))
  return (
    <div className="lb-foot">
      {over && quick && <button className="lb-primary" disabled={busy} onClick={again}>Play again</button>}
      {over && !quick && isHost && <button className="lb-primary" disabled={busy} onClick={() => run(() => api.current.lobbyRematch())}>Rematch</button>}
      {over && !quick && !isHost && <p className="lb-muted">Waiting for the host to start a rematch.</p>}
      <button className="lb-link" onClick={() => run(() => api.current.lobbyLeave().then(() => go('')))}>Leave game</button>
      <style>{CSS}</style>
    </div>
  )
}

function Play() {
  const [demo, setDemo] = useState(isDemo())
  useEffect(() => {
    const on = () => setDemo(isDemo())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return demo ? <DemoPlay /> : <Lobby />
}

function Lobby() {
  const [s, api] = useLobby()
  const routeCodeNow = useRouteCode()
  const [profile, setProfileState] = useState(loadProfile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [hosting, setHosting] = useState(false)
  const [solo, setSolo] = useState(false)
  const setProfile = (p) => (setProfileState(p), saveProfile(p))
  const run = (fn) => {
    setBusy(true)
    setError(null)
    return Promise.resolve()
      .then(fn)
      .catch((e) => setError(e?.message || 'That did not go through. Try again.'))
      .finally(() => setBusy(false))
  }
  const lobby = myLobby(s)

  // The deep link follows the room you are in.
  useEffect(() => {
    if (lobby && routeCodeNow !== lobby.code) go(lobby.code)
  }, [lobby?.code, routeCodeNow]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = (set) => {
    setHosting(false)
    run(() => api.current.lobbyCreate({ ...set, name: profile.name.trim(), avatar: profile.avatar ?? avatarIds[0] }))
  }
  const quickPlay = (mode) => {
    const name = (profile.name ?? '').trim() || defaultName()
    if (!profile.name) setProfile({ ...profile, name })
    return run(() => api.current.quickPlay(name, profile.avatar ?? avatarIds[0], 'beat'))
  }
  const join = (code) => run(() => api.current.lobbyJoin(code, profile.name.trim(), profile.avatar ?? avatarIds[0]))

  if (solo) return <PmSolo name={(profile.name ?? '').trim() || defaultName()} avatar={profile.avatar ?? avatarIds[0]} onExit={() => setSolo(false)} />
  let body
  if (s.status === 'connecting') body = <p className="lb-muted">Connecting…</p>
  else if (s.status === 'offline') body = <p className="lb-muted">The game server is out of reach. Check the Wi-Fi and reload.</p>
  else if (!lobby) {
    body = hosting
      ? <HostForm profile={profile} setProfile={setProfile} busy={busy} onCreate={create} onBack={() => setHosting(false)} />
      : routeCodeNow
        ? <JoinForm code={routeCodeNow} profile={profile} setProfile={setProfile} busy={busy} onJoin={join} onBack={() => go('')} />
        : <Landing profile={profile} setProfile={setProfile} queue={s.queue} onSolo={() => { if (!profile.name) setProfile({ ...profile, name: defaultName() }); setSolo(true) }} onHost={() => setHosting(true)} onJoinCode={go}
            onQuick={() => quickPlay()} onCancel={() => run(() => api.current.quickCancel())} />
  } else if (lobby.state === 'waiting') body = <Waiting s={s} lobby={lobby} busy={busy} run={run} api={api} />
  else if (lobby.state === 'countdown') {
    const ballots = (s.ballots ?? []).filter((b) => b.lobbyId === lobby.id)
    const tally = { start: ballots.filter((b) => b.vote === 'start').length, wait: ballots.filter((b) => b.vote === 'wait').length }
    body = <Countdown lobby={lobby} players={members(s, lobby)} tally={lobby.kind === 'quick' ? tally : null} vote={ballots.find((b) => b.id === s.me)?.vote}
      onVote={lobby.kind === 'quick' ? (v) => run(() => api.current.lobbyVote(v)) : null} />
  }
  else body = null

  if (lobby && (lobby.state === 'playing' || lobby.state === 'reveal')) {
    const Round = ROUNDS[lobby.mode]
    const footer = <RoundFooter s={s} lobby={lobby} busy={busy} run={run} api={api} profile={profile} />
    if (Round) return Round({ lobbyId: lobby.id, footer })
    body = <><p className="lb-muted">This game mode is not available on your device yet.</p>{footer}</>
  }
  return (
    <div className="lb">
      <Header sub={lobby ? `Game ${lobby.code}` : 'Play with the room'} />
      {error && <p className="lb-error" role="alert">{error}</p>}
      {body}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
body { overflow: auto; }
.lb { max-width: 520px; margin: 0 auto; padding: 20px 16px 48px; min-height: 100%; }
.lb-top { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
.lb-logo { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); flex: none; }
.lb-kicker { font-size: 12px; color: var(--text-3); }
.lb h1 { font-size: 22px; margin: 2px 0 0; letter-spacing: -0.02em; }
.lb h2 { font-size: 16px; margin: 0 0 8px; }
.lb-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 16px; margin-bottom: 12px; }
.lb-muted { font-size: 12px; color: var(--text-2); margin: 8px 0; line-height: 1.45; }
.lb-error { font-size: 13px; color: var(--hot); background: var(--hot-dim); border-radius: 12px; padding: 8px 12px; }
.lb-label { display: block; font-size: 12px; color: var(--text-2); margin: 12px 0 6px; }
.lb-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-2); margin-bottom: 4px; }
.lb-field input { height: 48px; border-radius: 14px; background: var(--card); border: 1px solid var(--line-2); color: var(--text); padding: 0 12px; font: inherit; font-size: 16px; }
.lb-code-in { text-transform: uppercase; letter-spacing: 0.4em; text-align: center; font-weight: 700; font-size: 22px !important; }
.lb-primary { width: 100%; height: 50px; border-radius: 14px; border: 0; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 700; font-size: 16px; margin-top: 12px; }
.lb-primary:disabled { opacity: .5; } .lb-primary.done { background: var(--accent-dim); color: var(--accent); border: 1px solid var(--accent); }
.lb-link { display: block; margin: 12px auto 0; background: none; border: 0; color: var(--text-2); text-decoration: underline; font: inherit; font-size: 13px; padding: 8px; }
.lb-ghost { flex: 1; text-align: center; padding: 11px; border-radius: 12px; background: var(--card); color: var(--text); text-decoration: none; font: inherit; font-size: 14px; border: 1px solid var(--line-2); }
.lb-row { display: flex; gap: 8px; margin-top: 10px; }
.lb-avs { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.lb-avs button { aspect-ratio: 1; display: grid; place-items: center; border-radius: 14px; border: 1px solid var(--line-2); background: var(--card); color: var(--text-2); padding: 0; }
.lb-avs button.on { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }
.lb-seg { display: flex; gap: 4px; padding: 3px; border-radius: 14px; background: var(--card); }
.lb-seg button { flex: 1; min-height: 40px; border-radius: 11px; border: 0; background: none; color: var(--text-2); font: inherit; font-size: 13px; font-weight: 600; }
.lb-seg button.on { background: var(--card-2); color: var(--accent); }
.lb-check { display: flex; gap: 8px; align-items: center; margin-top: 14px; font-size: 14px; min-height: 40px; }
.lb-check input { width: 20px; height: 20px; }
.lb-share { text-align: center; }
.lb-code { font-size: 54px; font-weight: 800; letter-spacing: 0.18em; color: var(--accent); margin: 0 0 4px 0.18em; font-family: var(--mono); }
.lb-code-s { font-family: var(--mono); letter-spacing: 0.2em; color: var(--accent); }
.lb-qr { border-radius: 12px; margin-top: 8px; }
.lb-count { font-size: 12px; color: var(--text-3); font-weight: 400; }
.lb-players { list-style: none; margin: 0; padding: 0; }
.lb-players li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
.lb-players li:first-child { border-top: 0; } .lb-players li.me { color: var(--accent); }
.lb-pn { flex: 1; font-size: 15px; } .lb-pn small { color: var(--text-3); font-size: 11px; }
.lb-tick { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--card); color: var(--text-3); font-weight: 700; }
.lb-tick.on { background: var(--accent-dim); color: var(--accent); }
.lb-kick { width: 32px; height: 32px; border-radius: 50%; border: 0; background: var(--card); color: var(--text-2); }
.lb-count-wrap { text-align: center; padding: 36px 16px; }
.lb-big { font-size: 140px; font-weight: 800; line-height: 1; color: var(--accent); margin: 12px 0; }
.lb-foot { max-width: 520px; margin: 0 auto 40px; padding: 0 16px; }
.av { display: block; }
.lb-faces { list-style: none; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; padding: 0; margin: 12px 0 4px; }
.lb-faces li { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; color: var(--text-2); max-width: 64px; }
.lb-faces li span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 64px; }
.lb-ghost.on { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
.lb-ghost.wide { width: 100%; }
.lb-quick h2 { color: var(--accent); }
`

export { Countdown, HostForm, JoinForm, Landing, RoundFooter, Waiting }

export default { path: '/play', prefix: true, title: 'Play', Component: Play }
