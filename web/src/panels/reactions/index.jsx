import { useEffect, useRef, useState } from 'react'

// Five fixed emoji reactions. ReactionBar is the phone's row of buttons; ReactionBursts floats the recent ones up the
// big screen. Both need the module's reaction table and react reducer (not in the module yet); until they exist the
// bar hides itself and the bursts render nothing. Not auto-registered as a panel: the phone view and the big screen mount them.
export const EMOJI = ['⚡', '🔥', '🌬️', '😮', '👏']
const COOLDOWN_MS = 800

export function ReactionBar({ react, disabled }) {
  const [last, setLast] = useState(0)
  const [flash, setFlash] = useState(null)
  if (!react) return null
  const send = (e) => {
    const now = Date.now()
    if (now - last < COOLDOWN_MS) return
    setLast(now)
    setFlash(e)
    setTimeout(() => setFlash(null), 400)
    navigator.vibrate?.(8)
    Promise.resolve(react(e)).catch(() => {})
  }
  return (
    <div className="rx-bar" role="group" aria-label="Send a reaction">
      {EMOJI.map((e) => (
        <button key={e} className={flash === e ? 'pop' : ''} disabled={disabled} onClick={() => send(e)} aria-label={`React ${e}`}>{e}</button>
      ))}
      <style>{BAR_CSS}</style>
    </div>
  )
}

// reactions: [{ id, emoji, at (ms) }], newest last. Each is shown once for ~3 s at a stable pseudo-random x.
export function ReactionBursts({ reactions }) {
  const [live, setLive] = useState([])
  const seen = useRef(new Set())
  useEffect(() => {
    const fresh = (reactions ?? []).filter((r) => !seen.current.has(r.id) && Date.now() - r.at < 5000)
    if (!fresh.length) return
    fresh.forEach((r) => seen.current.add(r.id))
    const mine = fresh.slice(-12).map((r) => ({ ...r, x: 6 + ((Number(r.id) * 37) % 88) }))
    setLive((l) => [...l, ...mine].slice(-40))
    const t = setTimeout(() => setLive((l) => l.filter((b) => !mine.includes(b))), 3200)
    return () => clearTimeout(t)
  }, [reactions])
  if (!live.length) return null
  return (
    <div className="rx-sky" aria-hidden>
      {live.map((b) => <span key={b.id} style={{ left: `${b.x}%` }}>{b.emoji}</span>)}
      <style>{SKY_CSS}</style>
    </div>
  )
}

const BAR_CSS = `
.rx-bar { display: flex; justify-content: space-between; gap: 6px; margin: 6px 0 10px; }
.rx-bar button { flex: 1; min-height: 46px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--card); font-size: 22px; transition: transform .12s; }
.rx-bar button.pop { transform: scale(1.18); background: var(--accent-dim); }
.rx-bar button:disabled { opacity: .4; }
`
const SKY_CSS = `
.rx-sky { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 50; }
.rx-sky span { position: absolute; bottom: -40px; font-size: 44px; animation: rxup 3.2s ease-out forwards; }
@keyframes rxup { 0% { transform: translateY(0) scale(.6); opacity: 0; } 12% { opacity: 1; transform: translateY(-10vh) scale(1.1); } 100% { transform: translateY(-85vh) scale(1); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .rx-sky span { animation-duration: .01s; } }
`
