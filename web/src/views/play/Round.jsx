import { useEffect, useState } from 'react'
import { CallCard } from './Call.jsx'
import { EndCard } from './End.jsx'
import { RevealCard } from './Reveal.jsx'
import { fmtPts } from './model.js'
import { CSS } from './styles.js'

// A Beat the model round on a phone: progress dots, the running score against the bots, then the call, its reveal, or
// the end card. Pure: everything comes from the UI model (see model.js) and four callbacks.
function Progress({ model }) {
  return (
    <div className="bm-dots" aria-label={`Call ${Math.min(model.callNo + 1, model.nCalls)} of ${model.nCalls}`}>
      {Array.from({ length: model.nCalls }, (_, i) => {
        const h = model.history.find((x) => x.n === i)
        const state = h ? (h.right == null ? 'bm-skip' : h.right ? 'bm-win' : 'bm-lose') : i === model.callNo && model.status === 'running' ? 'bm-now' : ''
        return <i key={i} className={state} />
      })}
    </div>
  )
}

function Totals({ totals }) {
  if (!totals.length) return null
  return (
    <ul className="bm-totals" aria-label="Scores so far">
      {totals.map((t) => (
        <li key={t.id} className={`${t.isMe ? 'bm-me' : ''} ${t.isBot ? 'bm-bot' : ''}`}>
          <span>{t.isMe ? 'You' : t.name}{t.isBot && <small className="bm-tag">bot</small>}</span><b className="num">{fmtPts(t.points)}</b>
        </li>
      ))}
    </ul>
  )
}

export function BeatRound({ model, onAnswer, onAgain, onLeave, busy, error, banner, footer }) {
  const reveal = model.phase === 'reveal' && model.reveal
  // The last call's reveal is shown first; the end card follows when the player taps through.
  const [seenEnd, setSeenEnd] = useState(false)
  useEffect(() => {
    if (model.status !== 'done') setSeenEnd(false)
  }, [model.status])
  const showEnd = model.status === 'done' && (seenEnd || !model.reveal)
  return (
    <div className="bm">
      {banner && <div className="bm-banner" role="note">{banner}</div>}
      {error && <p className="bm-error" role="alert">{error}</p>}
      {showEnd ? (
        <EndCard model={model} onAgain={onAgain} onLeave={onLeave} busy={busy} />
      ) : (
        <>
          <Progress model={model} />
          {reveal ? (
            <RevealCard call={model.call} reveal={model.reveal} phaseUntil={model.phaseUntil} last={model.callNo >= model.nCalls - 1} onFinish={model.status === 'done' ? () => setSeenEnd(true) : null} />
          ) : model.call ? (
            <CallCard call={model.call} nCalls={model.nCalls} mine={model.mine} phaseUntil={model.phaseUntil} onAnswer={onAnswer} busy={busy} />
          ) : (
            <section className="bm-card"><p className="bm-muted">Getting the next call ready…</p></section>
          )}
          <Totals totals={model.totals} />
          {model.status !== 'done' && onLeave && <button className="bm-link" onClick={onLeave}>Leave</button>}
        </>
      )}
      {footer}
      <style>{CSS}</style>
    </div>
  )
}
