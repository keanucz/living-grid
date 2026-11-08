import { useEffect } from 'react'
import { Icon } from './icons.jsx'
import { setState } from '../store/store.js'
import { SECTIONS, openSection } from './sections.js'

const SEEN = 'lg-welcomed'

function load() {
  try {
    return localStorage.getItem(SEEN)
  } catch {
    return null
  }
}

function remember(on) {
  try {
    if (on) localStorage.setItem(SEEN, '1')
    else localStorage.removeItem(SEEN)
  } catch {
    /* private mode */
  }
}

// First visit to the map shows the welcome; stand-alone pages (the QR code opens #/household) never do.
export function initWelcome(onMap) {
  setState({ welcome: onMap && !load() })
}

export function showWelcome() {
  remember(false)
  setState({ welcome: true })
}

function close() {
  remember(true)
  setState({ welcome: false })
}

export function choose(id) {
  close()
  openSection(id)
}

export default function Welcome() {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && choose('now')
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="wel" role="dialog" aria-modal="true" aria-labelledby="wel-h">
      <div className="wel-box fade-in">
        <div className="wel-kicker"><span className="wel-logo"><Icon name="bolt" size={16} stroke={2.4} /></span>The Living Grid</div>
        <h1 id="wel-h">Where to?</h1>
        <div className="wel-doors">
          {SECTIONS.map((s, i) => (
            <button key={s.id} className="wel-door" onClick={() => choose(s.id)} autoFocus={i === 0}>
              <span className="wel-ic"><Icon name={s.icon} size={20} /></span>
              <span className="wel-t">{s.label}</span>
              <span className="wel-l">{s.door}</span>
            </button>
          ))}
        </div>
        <button className="wel-skip" onClick={() => choose('now')}>Skip, show me the map</button>
      </div>
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.wel { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 24px; overflow-y: auto;
  background: rgba(10,10,10,.72); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.wel-box { width: min(980px, 100%); }
.wel-kicker { display: flex; align-items: center; gap: 10px; color: var(--text-2); font-weight: 500; }
.wel-logo { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); }
.wel h1 { font-size: 40px; font-weight: 500; letter-spacing: -0.025em; margin: 14px 0 24px; }
.wel-doors { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.wel-door { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; text-align: left; padding: 18px;
  min-height: 150px; border-radius: 14px; background: var(--panel-solid); border: 1px solid var(--line-2);
  transition: border-color .15s, transform .15s, background .15s; }
.wel-door:hover, .wel-door:focus-visible { border-color: var(--accent); background: #1b1d17; transform: translateY(-2px); outline: none; }
.wel-ic { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-dim); color: var(--accent); }
.wel-t { font-size: 19px; font-weight: 600; letter-spacing: -0.015em; }
.wel-l { color: var(--text-2); line-height: 1.4; font-size: 13px; }
.wel-skip { margin-top: 20px; color: var(--text-2); padding: 8px 0; text-decoration: underline; text-underline-offset: 3px; }
.wel-skip:hover { color: var(--text); }
@media (max-width: 760px) { .wel-doors { grid-template-columns: 1fr; } .wel-door { min-height: 0; } .wel h1 { font-size: 30px; } }
`
