import { useId, useState } from 'react'

// The shared plain-English card: a question as the title, the answer in larger type, then two closed disclosures,
// "Why?" and "For experts". Copy carries no typed numbers: callers pass live values into `answer` and `why`.
function Disclosure({ label, children }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={`ex-d ${open ? 'open' : ''}`}>
      <button type="button" className="ex-dbtn" aria-expanded={open} aria-controls={id} onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
        <span className="ex-chev" aria-hidden="true">›</span>
        {label}
      </button>
      <div id={id} className="ex-dbody" hidden={!open}>
        {children}
      </div>
    </div>
  )
}

export default function Explain({ question, answer, why, experts, icon, tag, className = '', style }) {
  const reasons = why == null ? [] : Array.isArray(why) ? why : [why]
  return (
    <section className={`panel ex fade-in ${className}`} style={style}>
      <div className="ex-q">
        {icon && <span className="ex-icon" aria-hidden="true">{icon}</span>}
        <h2>{question}</h2>
        {tag && <span className="tag">{tag}</span>}
      </div>
      <div className="ex-a">{answer}</div>
      {(reasons.length > 0 || experts) && (
        <div className="ex-more">
          {reasons.length > 0 && (
            <Disclosure label="Why?">
              <ul className="ex-why">
                {reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </Disclosure>
          )}
          {experts && <Disclosure label="For experts">{experts}</Disclosure>}
        </div>
      )}
      <style>{CSS}</style>
    </section>
  )
}

const CSS = `
.ex { padding: 16px 18px 10px; max-width: 100%; }
.ex-q { display: flex; align-items: center; gap: 10px; }
.ex-q h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--text-2); flex: 1; }
.ex-icon { display: grid; place-items: center; color: var(--accent); }
.ex-a { margin: 10px 0 12px; font-size: 19px; line-height: 1.4; font-weight: 500; letter-spacing: -0.01em; color: var(--text); }
.ex-a p { margin: 0 0 8px; } .ex-a p:last-child { margin: 0; }
.ex-more { border-top: 1px solid var(--line); }
.ex-d + .ex-d { border-top: 1px solid var(--line); }
.ex-dbtn { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer;
  font-size: 14px; font-weight: 500; color: var(--text-2); }
.ex-dbtn:hover { color: var(--text); }
.ex-dbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.ex-chev { display: inline-block; transition: transform .15s; font-size: 18px; line-height: 1; width: 12px; }
.ex-d.open .ex-chev { transform: rotate(90deg); }
.ex-dbody { padding: 0 0 12px; font-size: 14px; line-height: 1.5; color: var(--text-2); }
.ex-why { margin: 0; padding-left: 20px; } .ex-why li { margin: 4px 0; }
@media (prefers-reduced-motion: reduce) { .ex-chev { transition: none; } }
`
