import { fmtPts, kindInfo, optionLabel, secondsLeft, signed } from './model.js'
import { useNow } from './hooks.js'

// After a call: your answer, the model's and each bot's, the model's top reason, and what happened.
export function RevealCard({ call, reveal, phaseUntil, last, onFinish }) {
  const now = useNow(250)
  if (!call || !reveal) return null
  const right = reveal.mine ? reveal.mine.option === reveal.correct : null
  const next = secondsLeft(phaseUntil, now)
  const k = kindInfo(call.kind)
  const rows = [
    { id: 'me', name: 'You', option: reveal.mine?.option, confidence: reveal.mine?.confidence, points: reveal.mine?.points, me: true },
    { id: 'model', name: 'The model', option: reveal.model.option, confidence: reveal.model.confidence, points: reveal.model.points },
    ...reveal.bots.map((b) => ({ id: b.id, name: b.title, option: b.option, confidence: b.confidence, points: b.points })),
  ]
  return (
    <section className="bm-card bm-reveal" aria-label="Result">
      <div className="bm-callhead"><span className="bm-kind"><i aria-hidden>{k.icon}</i>{k.label} · call {call.n + 1}</span></div>
      <div className={`bm-verdict ${right == null ? '' : right ? 'bm-win' : 'bm-lose'}`}>
        <b>{right == null ? 'No answer' : right ? 'Right' : 'Wrong'}</b>
        <span className="num">{reveal.mine ? `${signed(reveal.mine.points)} points` : '0 points'}</span>
      </div>
      <p className="bm-happened"><span>What happened</span> {reveal.actualText}</p>
      <ul className="bm-rows">
        {rows.map((r) => {
          const ok = r.option != null && r.option === reveal.correct
          return (
            <li key={r.id} className={`${r.me ? 'bm-me' : ''} ${r.option == null ? 'bm-none' : ok ? 'bm-ok' : 'bm-bad'}`}>
              <span className="bm-who">{r.name}</span>
              <span className="bm-what">{r.option == null ? '—' : `${optionLabel(call, r.option)} · ${r.confidence}%`}</span>
              <b className="num bm-pts">{r.points == null ? '' : signed(r.points)}</b>
            </li>
          )
        })}
      </ul>
      {reveal.model.reason && <p className="bm-reason"><span>{reveal.model.confidence <= 50 ? 'Why the model called it even' : `Why the model said ${optionLabel(call, reveal.model.option)}`}</span> {reveal.model.reason}</p>}
      {!last && next != null && <div className="bm-next num" role="timer">Next call in {next}…</div>}
      {last && onFinish && <button className="bm-primary" onClick={onFinish}>See your result</button>}
      {last && !onFinish && <div className="bm-next">That was the last call.</div>}
    </section>
  )
}
