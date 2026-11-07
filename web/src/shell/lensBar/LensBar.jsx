import { useState } from 'react'
import { Icon } from '../icons.jsx'
import { actions, setState, useStore } from '../../store/store.js'
import { lensById, LENSES, openLensView, leaveLens, load, store } from './lenses.js'

const hintKey = (lens) => `lg-hints-${lens}`

function Hint({ lens, current }) {
  const [i, setI] = useState(() => Number(load(hintKey(lens.id)) ?? 0) || 0)
  const [seenFor, setSeenFor] = useState(lens.id)
  if (seenFor !== lens.id) {
    setSeenFor(lens.id)
    setI(Number(load(hintKey(lens.id)) ?? 0) || 0)
  }
  const hints = lens.hints.slice(0, 3)
  const h = hints[i]
  if (!h) return null
  const go = (n) => {
    store(hintKey(lens.id), String(n))
    setI(n)
  }
  const here = h.view === current
  return (
    <div className="lb-hint fade-in" role="status">
      <span className="lb-hint-n num">{i + 1}/{hints.length}</span>
      <span className="lb-hint-t">{h.text}</span>
      {!here && <button className="lb-hint-b" onClick={() => openLensView(lens.id, h.view)}>Show me</button>}
      <button className="lb-hint-b" onClick={() => go(i + 1)}>{i + 1 < hints.length ? 'Next tip' : 'Got it'}</button>
      <button className="lb-hint-x" aria-label="No more tips" title="No more tips" onClick={() => go(hints.length)}><Icon name="plus" size={14} /></button>
    </div>
  )
}

export function restartHelp(lensId) {
  if (lensId) store(hintKey(lensId), '')
  store('lg-welcomed', '')
  setState({ welcome: true })
}

export default function LensBar({ page = false }) {
  const ui = useStore()
  const lens = lensById[ui.lens]
  const [open, setOpen] = useState(false)
  if (!lens) return null
  const current = ui.lensView
  const view = lens.views.find((v) => v.id === current)
  const onMap = !page && view && !view.href && view.section === ui.section
  const canSim = !page && onMap && view.section !== 'simulate'
  const sim = canSim && ui.mode === 'simulate'
  return (
    <div className={`lb ${page ? 'lb-page' : ''}`}>
      <div className="lb-bar">
        <div className="lb-lens">
          <button className="lb-lens-b" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Switch lens">
            <Icon name={lens.icon} size={15} /> {lens.door} <span className="lb-caret">▾</span>
          </button>
          {open && (
            <div className="lb-menu" onMouseLeave={() => setOpen(false)}>
              {LENSES.map((l) => (
                <button key={l.id} className={l.id === lens.id ? 'on' : ''} onClick={() => { setOpen(false); openLensView(l.id) }}>
                  <Icon name={l.icon} size={15} /> {l.door}
                </button>
              ))}
              <button onClick={() => { setOpen(false); leaveLens() }}><Icon name="grid" size={15} /> All views</button>
            </div>
          )}
        </div>
        <div className="lb-views">
          {lens.views.map((v) => (
            <button key={v.id} className={v.id === current && (onMap || page || v.href) ? 'on' : ''} onClick={() => openLensView(lens.id, v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        {canSim && (
          <button className={`lb-sim ${sim ? 'on' : ''}`} onClick={() => actions.setMode(sim ? 'overview' : 'simulate')} title="Run a world event on this view">
            <Icon name="sim" size={15} /> {sim ? 'Simulating' : 'Simulate'}
          </button>
        )}
        <button className="lb-help" aria-label="Show the welcome and tips again" title="Show the welcome and tips again" onClick={() => { restartHelp(lens.id); if (page) location.hash = '#/' }}>
          <Icon name="help" size={16} />
        </button>
      </div>
      <Hint lens={lens} current={current} />
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.lb { position: relative; margin: 0 auto; display: flex; flex-direction: column; align-items: center; min-width: 0; }
.lb .lb-hint { position: absolute; top: calc(100% + 10px); left: 50%; transform: translateX(-50%); width: max-content; }
.main:has(.topbar .lb-hint) .actions { top: 134px; transition: top .2s; }
.lb.lb-page { position: sticky; top: 0; z-index: 6; gap: 8px; padding: 12px 16px 6px; background: linear-gradient(var(--bg) 75%, transparent); }
.lb.lb-page .lb-hint { position: static; transform: none; width: auto; }
.lb-bar { display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow); max-width: calc(100vw - 32px); }
.lb-lens { position: relative; }
.lb-lens-b { display: flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 7px; background: var(--accent-dim); color: var(--accent); font-weight: 600; white-space: nowrap; }
.lb-caret { font-size: 10px; opacity: .8; }
.lb-menu { position: absolute; top: calc(100% + 6px); left: 0; min-width: 240px; padding: 4px; border-radius: 10px; background: var(--panel-solid); border: 1px solid var(--line-2); box-shadow: var(--shadow); display: flex; flex-direction: column; }
.lb-menu button { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 7px; color: var(--text-2); text-align: left; }
.lb-menu button:hover { background: var(--card-2); color: var(--text); }
.lb-menu button.on { color: var(--accent); }
.lb-views { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
.lb-views button { padding: 7px 14px; border-radius: 7px; color: var(--text-2); font-weight: 500; white-space: nowrap; }
.lb-views button:hover { color: var(--text); }
.lb-views button.on { background: var(--card-2); color: var(--text); }
.lb-sim { display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 7px; color: var(--hot); font-weight: 600; white-space: nowrap; }
.lb-sim.on { background: var(--hot); color: #1b0d00; }
.lb-help { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 7px; color: var(--text-3); }
.lb-help:hover { color: var(--text); background: var(--card-2); }
.lb-hint { display: flex; align-items: center; gap: 10px; max-width: min(620px, calc(100vw - 32px)); padding: 8px 8px 8px 12px; border-radius: 10px; background: var(--panel-solid); border: 1px solid var(--accent); box-shadow: var(--shadow); font-size: 13px; }
.lb-hint-n { color: var(--accent); font-size: 11px; font-weight: 600; }
.lb-hint-t { flex: 1; line-height: 1.4; }
.lb-hint-b { padding: 5px 10px; border-radius: 6px; background: var(--card-2); font-weight: 500; white-space: nowrap; }
.lb-hint-b:hover { background: var(--accent); color: var(--accent-ink); }
.lb-hint-x { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px; color: var(--text-3); transform: rotate(45deg); }
.lb-hint-x:hover { color: var(--text); }
`
