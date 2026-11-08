import { useState } from 'react'
import { PANELS } from '../registry.js'
import { sectionById } from '../../shell/sections.js'

// The "More" drawer: panels a section keeps out of the way. Which ones come from the section's `more` list in
// shell/sections.js, so each section shows its one primary panel and one KPI strip and everything else sits here.
function More({ ctx }) {
  const [open, setOpen] = useState(false)
  const ids = sectionById[ctx.ui.section ?? 'overview']?.more ?? []
  const items = PANELS.filter((p) => ids.includes(p.id))
  if (!items.length) return null
  return (
    <div className="more">
      <button className="more-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>More</span>
        <span className="faint">{items.length} {items.length === 1 ? 'panel' : 'panels'} · {open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="more-body fade-in">
          {items.map((p) => <p.Component key={p.id} ctx={ctx} />)}
        </div>
      )}
      <style>{`
        .more { width: 100%; }
        .more-btn { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-radius: 16px;
          background: var(--panel-solid); border: 1px solid var(--line); color: var(--text); font-weight: 600; }
        .more-btn .faint { font-weight: 400; font-size: 12px; }
        .more-body { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; max-height: calc(100vh - 460px); overflow-y: auto; scrollbar-width: none; }
        .more-body::-webkit-scrollbar { display: none; }
        .more-body > * { flex: none; }
      `}</style>
    </div>
  )
}

export default { id: 'more', slot: 'bottomRight', order: 99, modes: ['overview', 'simulate'], Component: More }
