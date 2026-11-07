import { useEffect, useMemo, useState } from 'react'
import MapView from './map/MapView.jsx'
import Rail from './shell/Rail.jsx'
import TopBar from './shell/TopBar.jsx'
import { Icon } from './shell/icons.jsx'
import { LAYERS } from './layers/registry.js'
import { PANELS } from './panels/registry.js'
import { api, useApi, overlayState, currentHour } from './api/client.js'
import { actions, setState, useStore } from './store/store.js'
import { PRICE_LEGEND } from './styles/tokens.js'
import { matchView } from './views/index.js'
import { sectionById } from './shell/sections.js'
import MobileShell from './shell/mobile/MobileShell.jsx'
import { useNarrow } from './shell/mobile/useNarrow.js'
import { normaliseResult } from './api/normalise.js'
import LensBar from './shell/lensBar/LensBar.jsx'
import Welcome from './shell/lensBar/Welcome.jsx'
import { activeMapView, initLens } from './shell/lensBar/lenses.js'

const ASSET_FOR = { hormuz: 'gas', nuclear_outage: 'nuclear', scottish_storm: 'wind', interconnector_trip: 'hydro' }
const SLOTS = ['left', 'bottomRight', 'bottom', 'right']

setState({ layers: Object.fromEntries(LAYERS.map((l) => [l.id, l.defaultOn !== false])) })
initLens(!matchView(location.hash))

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
    const on = () => setView(matchView(location.hash))
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return view
}

export default function App() {
  const view = useHashView()
  const lens = useStore((s) => s.lens)
  const narrow = useNarrow()
  if (view) {
    document.title = `${view.title} · The Living Grid`
    if (lens && !narrow) return <><LensBar page /><view.Component /></>
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

  const visibleLayers = LAYERS.filter((l) => l.modes.includes(ui.mode))
  const section = sectionById[ui.section] ?? sectionById.overview
  const lensView = activeMapView(ui)
  const simOnView = lensView && ui.mode === 'simulate' && lensView.section !== 'simulate'
  const panelIds = lensView?.panels ? [...lensView.panels, ...(simOnView ? ['simDock'] : [])] : section.panels
  const inSection = (p) => (panelIds ? panelIds.includes(p.id) : p.modes.includes(ui.mode))
  const title = lensView?.title ?? section.title
  if (narrow) return <MobileShell ctx={ctx} at={state.data?.at} source={state.source} />

  return (
    <div className={`app mode-${ui.mode}`}>
      <Rail />
      <main className="main">
        <MapView ctx={ctx} />
        <TopBar at={state.data?.at} source={state.source} />

        {title && !simOnView && (
          <div className="headline">
            <div className="kicker">{lensView?.label ?? section.label}</div>
            <h1>{title}</h1>
            <p>{lensView?.blurb ?? section.blurb}</p>
          </div>
        )}

        <div className="actions" style={ui.mode === 'simulate' ? { right: 100 } : undefined}>
          {visibleLayers.map((l) => (
            <button key={l.id} className={`chip ${ui.layers[l.id] === false ? 'off' : ''}`} onClick={() => actions.toggleLayer(l.id)}>
              <span className="swatch" style={{ background: ui.layers[l.id] === false ? 'var(--text-3)' : l.swatch }} />
              {l.label}
            </button>
          ))}
          <button className="chip" title="Share"><Icon name="share" size={15} /></button>
        </div>

        {SLOTS.map((slot) => (
          <div key={slot} className={`slot slot-${slot}`}>
            {PANELS.filter((p) => p.slot === slot && inSection(p)).map((p) => (
              <p.Component key={p.id} ctx={ctx} />
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
