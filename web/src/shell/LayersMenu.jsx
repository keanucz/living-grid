import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { actions, useStore } from '../store/store.js'
import { LAYERS } from '../layers/registry.js'

const WEATHER = ['wind', 'solar']
const GROUPS = [['', null], ['Weather', WEATHER]]

// The one place to turn map layers on and off. Each section presets them when it opens (shell/sections.js).
export default function LayersMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const mode = useStore((s) => s.mode)
  const layers = useStore((s) => s.layers)
  const items = LAYERS.filter((l) => l.modes.includes(mode) && !l.hidden)
  const on = items.filter((l) => layers[l.id] !== false).length

  useEffect(() => {
    if (!open) return
    const away = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    addEventListener('pointerdown', away)
    addEventListener('keydown', esc)
    return () => {
      removeEventListener('pointerdown', away)
      removeEventListener('keydown', esc)
    }
  }, [open])

  const row = (l) => (
    <label key={l.id} className="lm-row" role="menuitemcheckbox" aria-checked={layers[l.id] !== false}>
      <input type="checkbox" checked={layers[l.id] !== false} onChange={() => actions.toggleLayer(l.id)} />
      <span className="lm-sw" style={{ background: l.swatch ?? 'var(--text-2)' }} />
      {l.label}
    </label>
  )

  return (
    <div className="lm" ref={ref}>
      <button data-tour="layers" className={`chip lm-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <Icon name="layers" size={15} /> Layers <span className="num lm-n">{on}</span>
      </button>
      {open && (
        <div className="lm-pop" role="menu">
          {GROUPS.map(([heading, ids]) => {
            const rows = ids ? items.filter((l) => ids.includes(l.id)) : items.filter((l) => !WEATHER.includes(l.id))
            return rows.length > 0 && (
              <div key={heading || 'main'}>
                {heading && <div className="lm-note" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{heading}</div>}
                {rows.map(row)}
              </div>
            )
          })}
          <div className="lm-note">Each section sets these for you. Change them here.</div>
        </div>
      )}
    </div>
  )
}
