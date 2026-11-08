import { Icon } from './icons.jsx'
import { useStore } from '../store/store.js'
import { SECTIONS, openSection } from './sections.js'
import { showWelcome } from './Welcome.jsx'
import LayersMenu from './LayersMenu.jsx'

// The one top bar: the six sections, the Layers menu, and the live-data and time chips. On a stand-alone page
// (page = the section that owns it) it is the same bar without the map controls.
export default function TopBar({ at: stateAt, source, page }) {
  const section = useStore((s) => s.section) ?? 'now'
  const current = page ?? section
  const when = stateAt
    ? new Date(stateAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    : '…'
  return (
    <header className={`topbar ${page ? 'page' : ''}`}>
      <div className="brand">The Living Grid <small>Europe</small></div>
      <nav className="tabs" aria-label="Sections">
        {SECTIONS.map((t) => (
          <button key={t.id} className={`${current === t.id ? 'on' : ''}`} aria-current={current === t.id ? 'page' : undefined} onClick={() => openSection(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {!page && <LayersMenu />}
      <div className="top-right">
        {!page && (
          <>
            <span className="chip" title={source === 'live' ? 'Live data from the API' : source ? 'API unreachable: showing bundled fixture data' : 'Waiting for the live API'}>
              <span className={`dot ${source === 'live' ? '' : source ? 'fixture' : 'loading'}`} />
              {source === 'live' ? 'Live' : source ? 'Fixture data' : 'Loading live data…'}
              <style>{`.dot.loading { background: var(--text-3); box-shadow: none; animation: lgpulse 1s ease-in-out infinite; } @keyframes lgpulse { 50% { opacity: .3; } }`}</style>
            </span>
            <span className="chip num"><Icon name="calendar" size={15} /> {when} UTC</span>
          </>
        )}
        <button className="chip icon" title="Show the welcome again" aria-label="Show the welcome again" onClick={showWelcome}><Icon name="help" size={16} /></button>
      </div>
    </header>
  )
}
