import { useEffect } from 'react'
import { Icon } from '../icons.jsx'
import { setState } from '../../store/store.js'
import { LENSES, openLensView, leaveLens, store } from './lenses.js'
import { openSection } from '../sections.js'

function close() {
  store('lg-welcomed', '1')
  setState({ welcome: false })
}

export function choose(lensId) {
  close()
  openLensView(lensId)
}

export function skip() {
  close()
  leaveLens()
  openSection('overview')
}

export default function Welcome() {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && skip()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="wel" role="dialog" aria-modal="true" aria-labelledby="wel-h">
      <div className="wel-box fade-in">
        <div className="wel-kicker"><span className="wel-logo"><Icon name="bolt" size={16} stroke={2.4} /></span>The Living Grid</div>
        <h1 id="wel-h">What brings you here?</h1>
        <div className="wel-doors">
          {LENSES.map((l, i) => (
            <button key={l.id} className="wel-door" onClick={() => choose(l.id)} autoFocus={i === 0}>
              <span className="wel-ic"><Icon name={l.icon} size={22} /></span>
              <span className="wel-t">{l.door}</span>
              <span className="wel-l">{l.line}</span>
              <span className="wel-v">{l.views.map((v) => v.label).join(' · ')}</span>
            </button>
          ))}
        </div>
        <button className="wel-skip" onClick={skip}>Skip, show me the map</button>
      </div>
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.wel { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 24px;
  background: rgba(10,10,10,.72); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.wel-box { width: min(980px, 100%); }
.wel-kicker { display: flex; align-items: center; gap: 10px; color: var(--text-2); font-weight: 500; }
.wel-logo { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); }
.wel h1 { font-size: 40px; font-weight: 500; letter-spacing: -0.025em; margin: 14px 0 28px; }
.wel-doors { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.wel-door { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; text-align: left; padding: 22px;
  min-height: 250px; border-radius: 14px; background: var(--panel-solid); border: 1px solid var(--line-2);
  transition: border-color .15s, transform .15s, background .15s; }
.wel-door:hover, .wel-door:focus-visible { border-color: var(--accent); background: #1b1d17; transform: translateY(-2px); outline: none; }
.wel-ic { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-dim); color: var(--accent); }
.wel-t { font-size: 21px; font-weight: 600; letter-spacing: -0.015em; margin-top: 6px; }
.wel-l { color: var(--text-2); line-height: 1.45; flex: 1; }
.wel-v { font-size: 12px; color: var(--text-3); }
.wel-skip { margin-top: 22px; color: var(--text-2); padding: 8px 0; text-decoration: underline; text-underline-offset: 3px; }
.wel-skip:hover { color: var(--text); }
@media (max-width: 760px) { .wel-doors { grid-template-columns: 1fr; } .wel-door { min-height: 0; } .wel h1 { font-size: 30px; } }
`
