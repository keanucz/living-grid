import { Icon } from './icons.jsx'
import { actions, useStore } from '../store/store.js'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'forecast', label: 'Forecast', soon: true },
  { id: 'simulate', label: 'Simulate' },
]

export default function TopBar({ at, source }) {
  const mode = useStore((s) => s.mode)
  const when = at
    ? new Date(at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    : '…'
  return (
    <header className="topbar">
      <div className="brand">The Living Grid <small>Europe</small></div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} disabled={t.soon} title={t.soon ? 'Coming soon' : undefined}
            className={`${mode === t.id ? 'on' : ''} ${t.id === 'simulate' ? 'sim' : ''}`}
            style={t.soon ? { opacity: 0.45, cursor: 'default' } : undefined}
            onClick={() => !t.soon && actions.setMode(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="top-right">
        <span className="chip" title={source === 'live' ? 'Live data from the API' : 'API unreachable: showing bundled fixture data'}>
          <span className={`dot ${source === 'live' ? '' : 'fixture'}`} />
          {source === 'live' ? 'Live' : 'Fixture data'}
        </span>
        <span className="chip num"><Icon name="calendar" size={15} /> {when} UTC</span>
        <button className="chip icon" title="Search"><Icon name="search" size={16} /></button>
      </div>
    </header>
  )
}
