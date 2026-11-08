import { useEffect, useState } from 'react'
import MapView from '../../map/MapView.jsx'
import { PANELS } from '../../panels/registry.js'
import { setState } from '../../store/store.js'
import { Icon } from '../icons.jsx'
import { SECTIONS, sectionById } from '../sections.js'
import PhoneNav from './PhoneNav.jsx'
import PlayHub from './PlayHub.jsx'
import LayerSwitch from './LayerSwitch.jsx'
import '../../styles/mobile.css'

// Phone layout (< 700 px): map on top, a bottom sheet with one tab per section (shell/sections.js, the same six as the
// desktop tabs and the welcome doors). Tap a zone (or its label) to select it; the sheet then shows its chart and the "why" card.
// Panels come from the section; the phone keeps the zone chart and the "why" card on the Now tab so a tap has an answer.
const PHONE_PANELS = { now: ['zoneList', 'explain', 'zoneChart', 'kpis'] }
const TABS = SECTIONS.map((s) => ({ ...s, panels: PHONE_PANELS[s.id] ?? s.panels ?? [] }))

const byId = Object.fromEntries(PANELS.map((p) => [p.id, p]))

export default function MobileShell({ ctx, at, source }) {
  const [tab, setTab] = useState(() => (sectionById[ctx.ui.section] ? ctx.ui.section : 'now'))
  const t = TABS.find((x) => x.id === tab)
  useEffect(() => {
    if (!t.mode) return
    setState((st) => ({ mode: t.mode, section: t.id, layers: { ...st.layers, ...t.layers } }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])
  const View = t.href ? PlayHub : null
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
          {tab !== 'play' && <LayerSwitch layers={ctx.ui.layers} />}
          {sel && st && tab !== 'play' && (
            <div className="m-sel">
              <b>{sel.name}</b>
              <span className="num">{st.currency === 'GBP' ? '£' : '€'}{Math.round(st.price)}/MWh</span>
            </div>
          )}
        </section>
      )}

      <section className={`m-sheet ${View ? 'full' : ''}`}>
        {View ? <View /> : (
          <>
            {t.title && <div className="m-head"><b>{t.title}</b><span>{t.blurb}</span></div>}
            {t.panels.map((id) => {
              const P = byId[id]
              return P ? <P.Component key={id} ctx={ctx} /> : null
            })}
            {t.pages?.map((pg) => <a key={pg.href} className="m-link" href={pg.href}>{pg.label} <Icon name="arrowUpRight" size={14} /></a>)}
          </>
        )}
      </section>

      <PhoneNav current={tab} onSelect={setTab} />
    </div>
  )
}
