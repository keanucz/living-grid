import { Icon } from './icons.jsx'
import { useStore } from '../store/store.js'
import { SECTIONS, openSection } from './sections.js'

export default function TopBar({ at: stateAt, source }) {
  const tab = useStore((s) => s.section) ?? 'overview'
  const when = stateAt
    ? new Date(stateAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    : '…'
  return (
    <header className="topbar">
      <div className="brand">The Living Grid <small>Europe</small></div>
      <div className="tabs">
        {SECTIONS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => openSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="top-right">
        <span className="chip" title={source === 'live' ? 'Live data from the API' : source ? 'API unreachable: showing bundled fixture data' : 'Waiting for the live API'}>
          <span className={`dot ${source === 'live' ? '' : source ? 'fixture' : 'loading'}`} />
          {source === 'live' ? 'Live' : source ? 'Fixture data' : 'Loading live data…'}
          <style>{`.dot.loading { background: var(--text-3); box-shadow: none; animation: lgpulse 1s ease-in-out infinite; } @keyframes lgpulse { 50% { opacity: .3; } }`}</style>
        </span>
        <span className="chip num"><Icon name="calendar" size={15} /> {when} UTC</span>
        <button className="chip icon" title="Search"><Icon name="search" size={16} /></button>
      </div>
    </header>
  )
}
