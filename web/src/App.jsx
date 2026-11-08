import { useEffect, useMemo, useState } from 'react'
import MapView from './map/MapView.jsx'
import TopBar from './shell/TopBar.jsx'
import { LAYERS } from './layers/registry.js'
import { PANELS } from './panels/registry.js'
import { api, useApi, overlayState, currentHour } from './api/client.js'
import { setState, useStore } from './store/store.js'
import { PRICE_LEGEND } from './styles/tokens.js'
import { matchView, redirectOf } from './views/index.js'
import { SECTIONS, sectionById, sectionOfPath, openSection } from './shell/sections.js'
import MobileShell from './shell/mobile/MobileShell.jsx'
import PhoneNav from './shell/mobile/PhoneNav.jsx'
import { useNarrow } from './shell/mobile/useNarrow.js'
import { normaliseResult } from './api/normalise.js'
import Welcome, { initWelcome } from './shell/Welcome.jsx'
import { Tour } from './tour/index.js'

const ASSET_FOR = { hormuz: 'gas', nuclear_outage: 'nuclear', scottish_storm: 'wind', interconnector_trip: 'hydro' }
const SLOTS = ['left', 'bottomRight', 'bottom', 'right']

setState({ layers: { ...Object.fromEntries(LAYERS.map((l) => [l.id, l.defaultOn !== false])), ...SECTIONS[0].layers } })
initWelcome(!matchView(location.hash) && !redirectOf(location.hash))

function useGeo() {
  const [geo, setGeo] = useState(null)
  useEffect(() => {
    fetch('/geo/europe.json').then((r) => r.json()).then(setGeo).catch(() => setGeo(null))
  }, [])
  return geo
}

function useHashView() {
  const [view, setView] = useState(() => matchView(location.hash))
  useEffect(() => {
    const on = () => {
      const to = redirectOf(location.hash)
      if (to) location.replace(to)
      else setView(matchView(location.hash))
    }
    on()
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return view
}

export default function App() {
  return <><Screen /><Tour /></>
}

function Screen() {
  const view = useHashView()
  const narrow = useNarrow()
  if (view) {
    document.title = `${view.title} · The Living Grid`
    const owner = sectionOfPath(view.path)
    if (owner && !narrow && !view.bare) {
      return (
        <div className="page-frame">
          <TopBar page={owner} />
          <div className="page-body"><view.Component /></div>
        </div>
      )
    }
    if (owner && narrow && owner !== 'play') {
      return (
        <div className="m-page">
          <div className="m-page-body"><view.Component /></div>
          <PhoneNav current={owner} onSelect={openSection} />
        </div>
      )
    }
    return <view.Component />
  }
  return <MapApp />
}

function MapApp() {
  const ui = useStore()
  const narrow = useNarrow()
  const geo = useGeo()
  const zones = useApi(api.zones)
  // /state takes seconds, so fetch it only when the hour changes (or a new hour starts); live table updates are
  // overlaid in the browser. Refetching on every SpacetimeDB bump cancelled each response before it landed.
  const hour = ui.at ?? currentHour()
  const apiState = useApi(() => api.state(ui.at), [hour])
  const state = useMemo(() => overlayState(apiState, ui.at), [apiState, ui.at, ui.live?.version])
  const scenarios = useApi(api.scenarios)
  const assets = useApi(api.assets)

  const ctx = useMemo(() => {
    const data = { geo, zones: zones.data, state: state.data, scenarios: scenarios.data, assets: assets.data }
    const zoneById = Object.fromEntries((zones.data?.zones ?? []).map((z) => [z.id, z]))
    const stateByZone = Object.fromEntries((state.data?.zones ?? []).map((z) => [z.zone, z]))
    const base = scenarios.data?.[ui.scenario?.id]
    const live = ui.scenario && ui.liveResult && ui.liveResult.id === ui.scenario.id ? normaliseResult(ui.liveResult.result) : null
    const scenario = base && {
      ...base,
      ...(live ?? {}),
      // A live /intervene result is already at the chosen magnitude; the precomputed one is scaled.
      scale: live ? 1 : ui.scenario.magnitude / base.magnitude,
      assetType: ASSET_FOR[base.type],
    }
    const priceOf = (id) => {
      const s = stateByZone[id]
      if (!s) return null
      return s.price_eur + (scenario ? (scenario.price_delta_eur[id] ?? 0) * scenario.scale : 0)
    }
    return { data, ui, zoneById, stateByZone, scenario, priceOf, source: state.source }
  }, [geo, zones.data, state.data, scenarios.data, assets.data, ui])

  const section = sectionById[ui.section] ?? sectionById.now
  // The scenario card's back arrow leaves simulate mode: that means leaving What if, so go back to Now.
  useEffect(() => {
    if (ui.section === 'whatif' && ui.mode === 'overview') openSection('now')
  }, [ui.section, ui.mode])
  const inSection = (p) => (section.panels ? section.panels.includes(p.id) : p.modes.includes(ui.mode))
  if (narrow) return <MobileShell ctx={ctx} at={state.data?.at} source={state.source} />

  return (
    <div className={`app mode-${ui.mode}`}>
      <main className="main">
        <MapView ctx={ctx} />
        <TopBar at={state.data?.at} source={state.source} />

        {section.title && ui.mode !== 'simulate' && (
          <div className="headline">
            <div className="kicker">{section.label}</div>
            <h1>{section.title}</h1>
            <p>{section.blurb}</p>
            {section.pages?.map((pg) => <a key={pg.href} className="headline-link" href={pg.href}>{pg.label} →</a>)}
          </div>
        )}


        {SLOTS.map((slot) => (
          <div key={slot} className={`slot slot-${slot}`}>
            {PANELS.filter((p) => p.slot === slot && inSection(p)).map((p) => (
              <div key={p.id} data-tour={p.id} style={{ display: 'contents' }}><p.Component ctx={ctx} /></div>
            ))}
          </div>
        ))}

        <div className="legend panel">
          <span className="muted">€/MWh</span>
          <div>
            <div className="bar" style={{ background: `linear-gradient(90deg, ${PRICE_LEGEND.map((s) => s.c).join(',')})` }} />
            <div className="ticks num">{PRICE_LEGEND.map((s) => <span key={s.v}>{s.v}</span>)}</div>
          </div>
        </div>
      </main>
      {ui.welcome && <Welcome />}
    </div>
  )
}
