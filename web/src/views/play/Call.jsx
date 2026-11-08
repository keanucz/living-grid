import { useEffect, useState } from 'react'
import { CONF_DEFAULT, CONF_MAX, CONF_MIN, confidenceWord, kindInfo, optionLabel, secondsLeft } from './model.js'
import { useNow } from './hooks.js'
import { outcomes } from './score.js'
import { signed } from './model.js'

// One call: the question, 2-5 big choice buttons, a confidence slider, Lock in. A soft 15 s timer runs from the module's
// phase_until; when it ends the module moves on (an unanswered call scores as a 50% guess), so the screen never blocks.
const RING = 2 * Math.PI * 17

function Timer({ until, total = 15 }) {
  const now = useNow(200)
  const left = secondsLeft(until, now)
  if (left == null) return null
  const frac = Math.max(0, Math.min(1, ((until - now) / 1000) / total))
  return (
    <div className="bm-timer" role="timer" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
        <circle cx="20" cy="20" r="17" fill="none" stroke="var(--line-2)" strokeWidth="3" />
        <circle cx="20" cy="20" r="17" fill="none" stroke={left <= 5 ? 'var(--hot)' : 'var(--accent)'} strokeWidth="3" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - frac)} transform="rotate(-90 20 20)" />
      </svg>
      <b className="num">{left}</b>
    </div>
  )
}

export function CallCard({ call, nCalls, mine, phaseUntil, onAnswer, busy }) {
  const [picked, setPicked] = useState(mine?.option ?? null)
  const [conf, setConf] = useState(mine?.confidence ?? CONF_DEFAULT)
  useEffect(() => {
    setPicked(mine?.option ?? null)
    setConf(mine?.confidence ?? CONF_DEFAULT)
  }, [call?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!call) return null
  const k = kindInfo(call.kind)
  const locked = !!mine
  const unchanged = locked && mine.option === picked && mine.confidence === conf
  const o = outcomes(call.options.length, conf)
  return (
    <section className="bm-card bm-call" aria-label={`Call ${call.n + 1} of ${nCalls}`}>
      <div className="bm-callhead">
        <span className="bm-kind"><i aria-hidden>{k.icon}</i>{k.label} · call {call.n + 1} of {nCalls}</span>
        <Timer until={phaseUntil} />
      </div>
      <h2 className="bm-q">{call.text}</h2>
      {call.context && <p className="bm-ctx">{call.context}</p>}
      <div className="bm-opts" role="radiogroup" aria-label="Your answer">
        {call.options.map((opt) => (
          <button key={opt.id} role="radio" aria-checked={picked === opt.id} className={picked === opt.id ? 'bm-on' : ''} disabled={busy} onClick={() => setPicked(opt.id)}>
            {opt.label}
          </button>
        ))}
      </div>
      <label className="bm-conf">
        <span className="bm-conf-h"><b>{confidenceWord(conf)}</b><b className="num">{conf}%</b></span>
        <input type="range" min={CONF_MIN} max={CONF_MAX} step="5" value={conf} disabled={busy} onChange={(e) => setConf(Number(e.target.value))} aria-label="How sure are you" />
        <span className="bm-conf-t"><span>Guess</span><span>Certain</span></span>
      </label>
      <p className="bm-hint" aria-live="polite">If you are right <b className="bm-g">{signed(o.right)}</b> · if you are wrong <b className="bm-b">{signed(o.wrong)}</b>. Say what you really believe: that scores best.</p>
      <button className="bm-primary" disabled={!picked || busy || unchanged} onClick={() => onAnswer(picked, conf)}>
        {unchanged ? 'Locked in ✓' : !picked ? 'Pick an answer' : locked ? 'Change my answer' : 'Lock in'}
      </button>
      {locked && <div className="bm-locked" role="status">Your answer is in. The reveal comes when everyone has answered or the timer ends; you can change it until then.</div>}
    </section>
  )
}
