import { useEffect, useId, useRef, useState } from 'react'
import { GLOSSARY } from '../copy/glossary.js'

// <Term id="day-ahead">day-ahead price</Term>: the words with a dotted underline; hover (desktop) or tap (phone)
// shows the glossary definition in a small popover. Esc or a tap elsewhere closes it.
export default function Term({ id, children }) {
  const entry = GLOSSARY[id]
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const ref = useRef(null)
  const tip = useId()
  useEffect(() => {
    if (!open) return undefined
    const key = (e) => e.key === 'Escape' && (setOpen(false), setPinned(false))
    const away = (e) => ref.current && !ref.current.contains(e.target) && (setOpen(false), setPinned(false))
    addEventListener('keydown', key)
    addEventListener('pointerdown', away)
    return () => {
      removeEventListener('keydown', key)
      removeEventListener('pointerdown', away)
    }
  }, [open])
  if (!entry) return children
  return (
    <span className="term" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => !pinned && setOpen(false)}>
      <button
        type="button"
        className="term-word"
        aria-expanded={open}
        aria-describedby={open ? tip : undefined}
        onClick={(e) => {
          e.stopPropagation()
          const close = open && pinned
          setOpen(!close)
          setPinned(!close)
        }}
      >
        {children}
      </button>
      {open && (
        <span role="tooltip" id={tip} className="term-pop">
          <b>{entry.term}</b> {entry.text}
        </span>
      )}
      <style>{CSS}</style>
    </span>
  )
}

const CSS = `
.term { position: relative; display: inline; }
.term-word { all: unset; cursor: help; border-bottom: 1px dotted currentColor; }
.term-word:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
.term-pop { position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%); z-index: 50; width: max-content; max-width: min(280px, 80vw);
  padding: 10px 12px; border-radius: var(--radius); background: var(--card-2); border: 1px solid var(--line-2); box-shadow: var(--shadow);
  color: var(--text); font-size: 13px; font-weight: 400; line-height: 1.45; text-align: left; white-space: normal; }
.term-pop b { display: block; margin-bottom: 2px; font-weight: 600; }
`
