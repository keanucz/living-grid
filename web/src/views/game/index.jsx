import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../shell/icons.jsx'
import { connectGame, upcomingSlots } from './connection.js'

const TZ = 'Europe/London'
const hm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const ACTIONS = [
  { id: 'charge', label: 'Charge' },
  { id: 'hold', label: 'Hold' },
  { id: 'discharge', label: 'Discharge' },
]
const money = (v) => `${v < 0 ? '−' : ''}£${Math.abs(v).toFixed(2)}`

function useGame() {
  const [state, setState] = useState({ status: 'connecting' })
  const api = useRef(null)
  useEffect(() => {
    api.current = connectGame({ onState: (s) => setState((prev) => ({ ...prev, ...s })) })
    return () => api.current?.close()
  }, [])
  return [state, api]
}

function Join({ onJoin, busy }) {
  const [name, setName] = useState('')
  return (
    <form className="gm-card" onSubmit={(e) => (e.preventDefault(), name.trim() && onJoin(name.trim()))}>
      <label className="gm-field">
        <span>Your name on the leaderboard</span>
        <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ada" autoFocus />
      </label>
      <button className="gm-primary" disabled={busy || !name.trim()}>Join the game</button>
    </form>
  )
}

function Zones({ zones, current, onPick }) {
  return (
    <section className="gm-card">
      <div className="gm-h">{current ? 'Your battery' : 'Claim a zone battery'}</div>
      <p className="gm-muted">1 MW / 2 MWh. Settled on the GB system price; the market index price is a provisional figure until it is out.</p>
      <div className="gm-zones">
        {zones.map((z) => (
          <button key={z.code} className={`gm-zone ${current === z.code ? 'on' : ''}`} onClick={() => onPick(z.code)}>
            <b>{z.code}</b>
            <span>{z.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Slots({ decisions, onDecide }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30e3)
    return () => clearInterval(t)
  }, [])
  const chosen = new Map(decisions.map((d) => [d.slot, d.action]))
  return (
    <section className="gm-card">
      <div className="gm-h">Next half-hours</div>
      {upcomingSlots(now).map((slot) => (
        <div key={slot} className="gm-slot">
          <div className="gm-time">{hm(slot)}</div>
          <div className="gm-acts" role="group" aria-label={`Action for ${hm(slot)}`}>
            {ACTIONS.map((a) => (
              <button key={a.id} className={`gm-act ${a.id} ${chosen.get(slot) === a.id ? 'on' : ''}`} onClick={() => onDecide(slot, a.id)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="gm-muted">No choice means hold. You can change a half-hour until it starts.</p>
    </section>
  )
}

function Settled({ decisions }) {
  const done = decisions.filter((d) => d.settled).slice(-6).reverse()
  if (!done.length) return null
  return (
    <section className="gm-card">
      <div className="gm-h">Settled</div>
      {done.map((d) => (
        <div key={d.slot} className="gm-row">
          <span>{hm(d.slot)} · {d.action}</span>
          <b className={d.pnl >= 0 ? 'up' : 'down'}>{money(d.pnl)}</b>
        </div>
      ))}
    </section>
  )
}

function Game() {
  const [s, api] = useGame()
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
  const me = s.me
  const rank = me && s.leaderboard?.find((r) => r.name === me.name && r.zone === me.zone)?.rank
  return (
    <div className="gm">
      <header className="gm-top">
        <a href="#/" className="gm-logo" aria-label="Back to the map"><Icon name="bolt" size={18} stroke={2.2} /></a>
        <div>
          <div className="gm-kicker">The Living Grid · room game</div>
          <h1>Beat the forecast battery</h1>
        </div>
      </header>

      {s.status === 'connecting' && <p className="gm-muted">Connecting to the room…</p>}
      {s.status === 'offline' && <p className="gm-muted">The game server is out of reach. Check the Wi-Fi and reload.</p>}
      {error && <p className="gm-error">{error}</p>}

      {s.status === 'live' && !me && <Join busy={busy} onJoin={(name) => call(() => api.current.join(name))} />}
      {me && (
        <section className="gm-me">
          <div><div className="gm-muted">{me.name}{rank ? ` · #${rank}` : ''}</div><div className="gm-score">{money(me.score)}</div></div>
          <span className="gm-tag">{me.zone || 'No zone yet'}</span>
        </section>
      )}
      {me && <Zones zones={s.zones ?? []} current={me.zone} onPick={(z) => call(() => api.current.claimZone(z))} />}
      {me?.zone && <Slots decisions={s.decisions ?? []} onDecide={(slot, a) => call(() => api.current.decide(slot, a))} />}
      {me && <Settled decisions={s.decisions ?? []} />}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
body { overflow: auto; }
.gm { max-width: 520px; margin: 0 auto; padding: 20px 16px 40px; min-height: 100%; }
.gm-top { display: flex; gap: 12px; align-items: center; margin-bottom: 18px; }
.gm-logo { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); flex: none; }
.gm-kicker { font-size: 12px; color: var(--text-3); }
.gm h1 { font-size: 22px; margin: 2px 0 0; letter-spacing: -0.02em; }
.gm-card, .gm-me { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px; margin-bottom: 10px; }
.gm-me { display: flex; justify-content: space-between; align-items: center; }
.gm-score { font-size: 26px; font-weight: 700; color: var(--accent); }
.gm-tag { padding: 4px 10px; border-radius: 999px; background: var(--accent-dim); color: var(--accent); font-size: 13px; }
.gm-h { font-weight: 600; margin-bottom: 6px; }
.gm-muted { font-size: 12px; color: var(--text-2); margin: 4px 0 10px; }
.gm-error { font-size: 13px; color: var(--hot); background: var(--hot-dim); border-radius: 12px; padding: 8px 12px; }
.gm-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-2); margin-bottom: 12px; }
.gm-field input { height: 46px; border-radius: 14px; background: var(--card); border: 1px solid var(--line-2); color: var(--text); padding: 0 12px; font: inherit; font-size: 16px; }
.gm-primary { width: 100%; height: 48px; border-radius: 14px; border: 0; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 600; font-size: 15px; }
.gm-primary:disabled { opacity: .5; }
.gm-zones { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.gm-zone { display: flex; flex-direction: column; gap: 2px; padding: 10px 8px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--card); color: var(--text); font: inherit; text-align: left; min-width: 0; }
.gm-zone span { font-size: 11px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gm-zone.on { border-color: var(--accent); background: var(--accent-dim); }
.gm-slot { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); }
.gm-slot:first-of-type { border-top: 0; }
.gm-time { width: 48px; font-family: var(--mono); font-size: 14px; flex: none; }
.gm-acts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; flex: 1; }
.gm-act { height: 40px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--card); color: var(--text-2); font: inherit; font-size: 13px; }
.gm-act.on.charge { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
.gm-act.on.hold { background: var(--card-2); border-color: var(--text-3); color: var(--text); }
.gm-act.on.discharge { background: var(--hot-dim); border-color: var(--hot); color: var(--hot); }
.gm-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; }
.gm-row .up { color: var(--up); } .gm-row .down { color: var(--down); }
`

export default { path: '/game', title: 'Room game', Component: Game }
