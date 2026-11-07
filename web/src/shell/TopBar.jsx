import { Icon } from './icons.jsx'
import { actions, useStore } from '../store/store.js'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'simulate', label: 'Simulate' },
]

export default function TopBar({ at: stateAt, source }) {
  const mode = useStore((s) => s.mode)
  const at = useStore((s) => s.at)
  // Forecast = the overview map scrubbed ahead (ghost layer + scrubber), not a separate mode.
  const ahead = at && Date.parse(at) > Date.now()
  const tab = mode === 'overview' ? (ahead ? 'forecast' : 'overview') : mode
  const pick = (id) => {
    if (id === 'forecast') {
      const d = new Date(Date.now() + 6 * 3600e3)
      d.setUTCMinutes(0, 0, 0)
      actions.setMode('overview')
      return actions.setAt(d.toISOString().replace('.000Z', 'Z'))
    }
    if (id === 'overview') actions.setAt(null)
    actions.setMode(id)
  }
  const when = stateAt
    ? new Date(stateAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    : '…'
  return (
    <header className="topbar">
      <div className="brand">The Living Grid <small>Europe</small></div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} disabled={t.soon} title={t.soon ? 'Coming soon' : undefined}
            className={`${tab === t.id ? 'on' : ''} ${t.id === 'simulate' ? 'sim' : ''}`}
            style={t.soon ? { opacity: 0.45, cursor: 'default' } : undefined}
            onClick={() => !t.soon && pick(t.id)}>
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
