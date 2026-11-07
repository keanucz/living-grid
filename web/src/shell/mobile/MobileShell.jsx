import { useEffect, useState } from 'react'
import MapView from '../../map/MapView.jsx'
import { PANELS } from '../../panels/registry.js'
import { VIEWS } from '../../views/index.js'
import { actions } from '../../store/store.js'
import { Icon } from '../icons.jsx'
import '../../styles/mobile.css'

// Phone layout (< 700 px): map on top, a bottom sheet with tabs that reuse the desktop panels.
// Tap a zone (or its label) to select it; the Map tab then shows its chart and the "why" card.
const TABS = [
  { id: 'map', label: 'Map', icon: 'globe', mode: 'overview', panels: ['zoneList', 'explain', 'zoneChart', 'constraintBill'] },
  { id: 'events', label: 'Events', icon: 'sim', mode: 'simulate', panels: ['simDock', 'statTiles'] },
  { id: 'scores', label: 'Scores', icon: 'chart', mode: 'overview', panels: ['kpis', 'scoreboard', 'botLeague', 'battery', 'compute', 'leaderboard'] },
  { id: 'tonight', label: 'Tonight', icon: 'phone', mode: 'overview', view: '/household' },
]

const byId = Object.fromEntries(PANELS.map((p) => [p.id, p]))

export default function MobileShell({ ctx, at, source }) {
  const [tab, setTab] = useState(() => (ctx.ui.mode === 'simulate' ? 'events' : 'map'))
  const t = TABS.find((x) => x.id === tab)
  useEffect(() => {
    if (ctx.ui.mode !== t.mode) actions.setMode(t.mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])
  const View = t.view && VIEWS.find((v) => v.path === t.view)?.Component
  const when = at ? new Date(at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '…'
  const sel = ctx.zoneById[ctx.ui.selectedZone]
  const st = ctx.stateByZone[ctx.ui.selectedZone]

  return (
    <div className={`m-app mode-${ctx.ui.mode}`}>
      <header className="m-top">
        <div className="m-brand"><span className="m-logo"><Icon name="bolt" size={14} stroke={2.4} /></span>The Living Grid</div>
        <span className={`chip m-live`}>
          <span className={`dot ${source === 'live' ? '' : source ? 'fixture' : 'loading'}`} />
          {source === 'live' ? 'Live' : source ? 'Fixture' : 'Loading'} · {when}
        </span>
      </header>

      {!View && (
        <section className="m-map">
          <MapView ctx={ctx} />
          {sel && st && tab === 'map' && (
            <div className="m-sel">
              <b>{sel.name}</b>
              <span className="num">{st.currency === 'GBP' ? '£' : '€'}{Math.round(st.price)}/MWh</span>
            </div>
          )}
        </section>
      )}

      <section className={`m-sheet ${View ? 'full' : ''}`}>
        {View ? <View /> : t.panels.map((id) => {
          const P = byId[id]
          return P ? <P.Component key={id} ctx={ctx} /> : null
        })}
      </section>

      <nav className="m-tabs" aria-label="Sections">
        {TABS.map((x) => (
          <button key={x.id} className={x.id === tab ? 'on' : ''} onClick={() => setTab(x.id)} aria-current={x.id === tab}>
            <Icon name={x.icon} size={18} />
            <span>{x.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
