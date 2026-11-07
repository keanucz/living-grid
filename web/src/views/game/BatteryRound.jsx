import { useEffect, useState } from 'react'
import { money, slotTime } from './battery.js'

// One battery round: choose charge, hold or discharge for the open half-hour against two agents (median-only and
// risk-aware, both planned from forecasts made before the day). Prices appear as each half-hour settles; the day
// stays hidden until the end. `data` is readBattery(...); `onDecide(slot, action)` sends the choice.
const ACTIONS = [
  { id: 'charge', label: 'Charge', hint: 'buy 0.5 MWh' },
  { id: 'hold', label: 'Hold', hint: 'do nothing' },
  { id: 'discharge', label: 'Discharge', hint: 'sell 0.5 MWh' },
]
const AGENT_LABEL = { risk_aware: 'Plans for the worst case', median_only: 'Plans on the middle forecast' }
const CAPACITY_MWH = 2

function useCountdown(round) {
  const [left, setLeft] = useState(null)
  useEffect(() => {
    if (!round || round.status !== 'running') return undefined
    const end = Date.now() + round.seconds_per_slot * 1000
    setLeft(round.seconds_per_slot)
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 250)
    return () => clearInterval(t)
  }, [round?.slot, round?.status, round?.seconds_per_slot])
  return left
}

function Prices({ slots, round }) {
  if (!slots.length) return <p className="bt-muted">Prices appear here as each half-hour settles.</p>
  const w = 300
  const h = 70
  const lo = Math.min(...slots.map((s) => s.price))
  const hi = Math.max(...slots.map((s) => s.price))
  const x = (i) => (round.n_slots > 1 ? (i / (round.n_slots - 1)) * w : 0)
  const y = (p) => (hi === lo ? h / 2 : h - 6 - ((p - lo) / (hi - lo)) * (h - 12))
  const d = slots.map((s, i) => `${i ? 'L' : 'M'}${x(s.slot).toFixed(1)},${y(s.price).toFixed(1)}`).join(' ')
  const last = slots[slots.length - 1]
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="bt-chart" role="img" aria-label="GB system price so far">
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" />
        <circle cx={x(last.slot)} cy={y(last.price)} r="3.5" fill="var(--accent)" />
      </svg>
      <div className="bt-muted">GB system price at {slotTime(round, last.slot)}: <b className="num">{money(last.price)}/MWh</b> · range {money(lo)} to {money(hi)}</div>
    </div>
  )
}

function Board({ players, mine }) {
  const rows = [...players].sort((a, b) => b.pnl - a.pnl)
  return (
    <section className="bt-card">
      <div className="bt-h">Leaderboard</div>
      {rows.map((p, i) => (
        <div key={p.identity} className={`bt-row ${p.identity === mine ? 'me' : ''}`}>
          <span className="bt-rank">{i + 1}</span>
          <span className="bt-name">{p.name}{p.isAgent && <small>{AGENT_LABEL[p.kind]}</small>}</span>
          <span className="bt-soc" title="Energy stored"><i style={{ width: `${Math.round((p.soc / CAPACITY_MWH) * 100)}%` }} /></span>
          <b className="num">{money(p.pnl)}</b>
        </div>
      ))}
    </section>
  )
}

export default function BatteryRound({ data, onDecide }) {
  const { round, players, slots, mine, pending, settled } = data
  const left = useCountdown(round)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!round) return <p className="bt-muted">Waiting for the round to start…</p>

  const done = round.status === 'done'
  const me = players.find((p) => p.identity === mine)
  const slot = Math.min(round.slot, round.n_slots - 1)
  const chosen = pending[slot]
  const pick = (action) => {
    setBusy(true)
    setError('')
    Promise.resolve(onDecide(slot, action))
      .catch((e) => setError(e?.message || 'That did not go through. Try again.'))
      .finally(() => setBusy(false))
  }
  const beat = (kind) => {
    const a = players.find((p) => p.kind === kind)
    return me && a ? { name: a.name, ahead: me.pnl > a.pnl, by: Math.abs(me.pnl - a.pnl) } : null
  }
  const vsRisk = beat('risk_aware')
  const vsMedian = beat('median_only')

  return (
    <div className="bt">
      <div className="bt-top">
        <div>
          <div className="bt-kicker">{done ? 'Round over' : 'Battery round'}</div>
          <h2>{done ? `It was ${round.day_revealed}` : `Half-hour ${slotTime(round, slot)}`}</h2>
        </div>
        {!done && <div className="bt-clock num" aria-label="Seconds left to choose">{left ?? '–'}s</div>}
      </div>

      {me && (
        <section className="bt-card bt-me">
          <div>
            <div className="bt-muted">Your profit so far</div>
            <div className="bt-score num">{money(me.pnl)}</div>
          </div>
          <div className="bt-gauge" title={`${me.soc.toFixed(2)} of ${CAPACITY_MWH} MWh stored`}>
            <i style={{ height: `${Math.round((me.soc / CAPACITY_MWH) * 100)}%` }} />
            <span className="num">{me.soc.toFixed(1)} MWh</span>
          </div>
        </section>
      )}

      {!done && me && (
        <section className="bt-card">
          <div className="bt-h">What does your battery do at {slotTime(round, slot)}?</div>
          <div className="bt-actions">
            {ACTIONS.map((a) => (
              <button key={a.id} className={`bt-act ${chosen === a.id ? 'on' : ''}`} disabled={busy} onClick={() => pick(a.id)}>
                <b>{a.label}</b>
                <span>{a.hint}</span>
              </button>
            ))}
          </div>
          <div className="bt-muted">{chosen ? `Locked in: ${chosen}. You can change it until the clock runs out.` : 'No choice yet: your battery holds if you do nothing.'}</div>
          {error && <p className="bt-error">{error}</p>}
        </section>
      )}

      <section className="bt-card">
        <div className="bt-h">Prices so far</div>
        <Prices slots={slots} round={round} />
        {me && settled[slots.length - 1] && !done && (
          <div className="bt-muted">Your last half-hour: {settled[slots.length - 1].action}, {money(settled[slots.length - 1].pnl)}.</div>
        )}
      </section>

      <Board players={players} mine={mine} />

      {done && (
        <section className="bt-card bt-reveal">
          <div className="bt-h">Against the agents</div>
          {vsRisk && <p>{vsRisk.ahead ? `You beat ${vsRisk.name} by ${money(vsRisk.by)}.` : `${vsRisk.name} beat you by ${money(vsRisk.by)}.`}</p>}
          {vsMedian && <p>{vsMedian.ahead ? `You beat ${vsMedian.name} by ${money(vsMedian.by)}.` : `${vsMedian.name} beat you by ${money(vsMedian.by)}.`}</p>}
          <p className="bt-muted">Both agents planned from forecasts made before this day. Profit is on the GB system price, 1 MW / 2 MWh at 88% round trip.</p>
        </section>
      )}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.bt { max-width: 520px; margin: 0 auto; padding: 8px 0 24px; }
.bt-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.bt-kicker { font-size: 12px; color: var(--text-3); }
.bt h2 { font-size: 20px; margin: 2px 0 0; letter-spacing: -0.02em; }
.bt-clock { font-size: 28px; font-weight: 700; color: var(--accent); }
.bt-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px; margin-bottom: 10px; }
.bt-me { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.bt-score { font-size: 28px; font-weight: 700; color: var(--accent); }
.bt-h { font-weight: 600; margin-bottom: 8px; }
.bt-muted { font-size: 12px; color: var(--text-2); line-height: 1.45; margin: 6px 0 0; }
.bt-error { font-size: 13px; color: var(--hot); background: var(--hot-dim); border-radius: 12px; padding: 8px 12px; }
.bt-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.bt-act { display: flex; flex-direction: column; gap: 2px; align-items: center; justify-content: center; min-height: 72px; border-radius: 16px; border: 1px solid var(--line-2); background: var(--card); color: var(--text); font: inherit; }
.bt-act span { font-size: 11px; color: var(--text-3); }
.bt-act.on { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.bt-act.on span { color: inherit; opacity: .8; }
.bt-chart { width: 100%; height: 70px; }
.bt-row { display: grid; grid-template-columns: 22px 1fr 56px 74px; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid var(--line); font-size: 14px; }
.bt-row:first-of-type { border-top: 0; }
.bt-row.me { color: var(--accent); }
.bt-rank { color: var(--text-3); }
.bt-name small { display: block; font-size: 11px; color: var(--text-3); }
.bt-soc { height: 8px; border-radius: 4px; background: var(--card); overflow: hidden; }
.bt-soc i { display: block; height: 100%; background: var(--accent); }
.bt-row b { text-align: right; }
.bt-gauge { position: relative; width: 64px; height: 64px; border-radius: 14px; background: var(--card); overflow: hidden; display: grid; place-items: center; }
.bt-gauge i { position: absolute; left: 0; right: 0; bottom: 0; background: var(--accent-dim); }
.bt-gauge span { position: relative; font-size: 12px; }
.bt-reveal { background: var(--accent-dim); }
.bt-reveal p { margin: 4px 0; }
`
