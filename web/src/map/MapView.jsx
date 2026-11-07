import { useEffect, useMemo, useRef, useState } from 'react'
import { DeckGL, GeoJsonLayer, FlyToInterpolator, LightingEffect, AmbientLight, PointLight, DirectionalLight } from 'deck.gl'
import { LAYERS } from '../layers/registry.js'
import { actions, useStore } from '../store/store.js'
import { COLORS, fmt } from '../styles/tokens.js'
import { Icon, ASSET_ICON } from '../shell/icons.jsx'
import { towerHeight, GLASS } from '../layers/price/index.js'

// Soft ambient plus a high point light over the North Sea: flat country slabs pick up a moving
// specular sheen as the map pans, which reads as glass/epoxy rather than flat paint.
const LIGHTING = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.0 }),
  sheen: new PointLight({ color: [255, 250, 240], intensity: 0.9, position: [4, 56, 1600000] }),
  key: new DirectionalLight({ color: [255, 255, 255], intensity: 0.25, direction: [-2, -3, -6] }),
})

const VIEWS = {
  overview: { longitude: 6.5, latitude: 53.2, zoom: 4.15, pitch: 0, bearing: 0 },
  simulate: { longitude: 2.2, latitude: 54.2, zoom: 4.85, pitch: 52, bearing: -14 },
}

// ?still freezes animation (screenshots, slow software GL).
const STILL = new URLSearchParams(location.search).has('still')

function useClock() {
  const [t, setT] = useState(2.3)
  useEffect(() => {
    if (STILL) return
    let raf
    const start = performance.now()
    const tick = (now) => {
      setT((now - start) / 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return t
}

export default function MapView({ ctx }) {
  const ui = ctx.ui
  const time = useClock()
  const [viewState, setViewState] = useState(VIEWS.overview)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const focus = ctx.scenario ? ctx.zoneById[ctx.scenario.focus] : null
    const target = { ...VIEWS[ui.mode] }
    if (ui.mode === 'simulate' && focus && focus.id !== 'GB') {
      target.longitude = focus.centroid[0]
      target.latitude = focus.centroid[1] + 2
    }
    setViewState((v) => ({ ...v, ...target, transitionDuration: 1600, transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }) }))
  }, [ui.mode, ctx.scenario?.focus])

  const zoom = (d) =>
    setViewState((v) => ({ ...v, zoom: v.zoom + d, transitionDuration: 300, transitionInterpolator: new FlyToInterpolator() }))
  const north = () =>
    setViewState((v) => ({ ...v, bearing: 0, pitch: ui.mode === 'simulate' ? 52 : 0, transitionDuration: 500, transitionInterpolator: new FlyToInterpolator() }))

  const base = useMemo(
    () =>
      ctx.data.geo &&
      new GeoJsonLayer({
        id: 'base-land',
        data: ctx.data.geo,
        filled: true,
        stroked: true,
        getFillColor: COLORS.land,
        getLineColor: COLORS.border,
        extruded: true,
        getElevation: 800,
        material: { ambient: 0.85, diffuse: 0.2, shininess: 80, specularColor: [34, 34, 32] },
        getLineWidth: 0.8,
        lineWidthUnits: 'pixels',
      }),
    [ctx.data.geo],
  )

  const layerCtx = { ...ctx, time }
  const layers = [
    base,
    ...LAYERS.filter((l) => l.modes.includes(ui.mode) && ui.layers[l.id] !== false).flatMap((l) => l.build(layerCtx)),
  ].filter(Boolean)

  return (
    <DeckGL
      viewState={viewState}
      onViewStateChange={({ viewState: v }) => setViewState(v)}
      controller={{ dragRotate: ui.mode === 'simulate', touchRotate: ui.mode === 'simulate' }}
      layers={layers}
      effects={[LIGHTING]}
      onClick={(info) => info.object?.properties?.zone && actions.selectZone(info.object.properties.zone)}
      getTooltip={(info) => tooltip(info, ctx)}
      getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
    >
      {({ viewport }) => (
        <>
          <Overlay viewport={viewport} ctx={ctx} />
          <div className="slot slot-right" style={{ display: ui.mode === 'simulate' ? 'flex' : 'none' }}>
            <div className="map-controls">
              <button className="round-btn" onClick={() => zoom(0.5)} title="Zoom in"><Icon name="plus" /></button>
              <button className="round-btn" onClick={() => zoom(-0.5)} title="Zoom out"><Icon name="minus" /></button>
              <button className="round-btn" onClick={north} title="Reset view" style={{ color: 'var(--hot)' }}>
                <Icon name="compass" fill="currentColor" />
              </button>
            </div>
          </div>
        </>
      )}
    </DeckGL>
  )
}

function zoneCard(id, ctx) {
  const z = ctx.zoneById[id]
  const st = ctx.stateByZone[id]
  if (!z || !st) return null
  const p = ctx.priceOf(id)
  const shown = st.currency === 'GBP' ? p / 1.15 : p
  const mix = Object.entries(st.mix ?? {}).slice(0, 3).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(' · ')
  const net = st.net_import_mw == null ? '' : `<br/>Net ${st.net_import_mw >= 0 ? 'import' : 'export'} ${(Math.abs(st.net_import_mw) / 1000).toFixed(1)} GW`
  const fc = st.forecast?.p50 != null ? `<br/><span style="opacity:.6">Forecast P50 ${st.forecast.p50.toFixed(0)} (${st.forecast.p10.toFixed(0)}–${st.forecast.p90.toFixed(0)}), +${st.forecast.horizon_h} h</span>` : ''
  const tag = ctx.scenario ? ' <span style="color:#ff8a1f">modelled</span>' : ''
  return `<b>${z.name}</b><br/><span style="font-size:18px;font-weight:600">${fmt.price(shown, st.currency)}</span>/MWh${tag}${mix ? `<br/>${mix}` : ''}${net}${fc}`
}

function tooltip({ object, layer }, ctx) {
  if (!object || !layer) return null
  const style = { background: '#1c1c1b', color: '#f2f2ef', borderRadius: '10px', border: '1px solid rgba(255,255,255,.12)', fontSize: '12px', padding: '8px 10px', lineHeight: '1.5', textTransform: 'none' }
  if (layer.id === 'price-zones' || layer.id === 'price-towers') {
    const html = zoneCard(object.properties?.zone ?? object.id, ctx)
    return html && { html, style }
  }
  if (layer.id === 'assets-blocks') return { html: `<b>${object.name}</b><br/>${object.type} · ${object.mw.toLocaleString('en-GB')} MW<br/><span style="opacity:.6">Approximate location</span>`, style }
  if (layer.id === 'flows-line') return { html: `<b>${object.name}</b><br/>${object.mw ? `${Math.abs(object.mw).toLocaleString('en-GB')} MW ${object.mw > 0 ? `${object.from} → ${object.to}` : `${object.to} → ${object.from}`}` : 'No flow'} · ${object.capacity_mw.toLocaleString('en-GB')} MW cap`, style }
  return null
}

function Overlay({ viewport, ctx }) {
  const { ui, data, zoneById, priceOf, scenario } = ctx
  if (!viewport || !data.zones) return null
  const project = (c) => viewport.project(c)
  const sim = ui.mode === 'simulate'

  return (
    <div className="overlay">
      {!sim &&
        data.zones.zones.map((z) => {
          const [x, y] = project(z.label_at)
          const st = ctx.stateByZone[z.id]
          if (!st) return null
          return (
            <div key={z.id} className={`map-label ${ui.selectedZone === z.id ? 'on' : ''}`} style={{ left: x, top: y }}
              onClick={() => actions.selectZone(z.id)}>
              {z.id} <b className="num">{fmt.price(st.price, st.currency)}</b>
            </div>
          )
        })}

      {sim &&
        data.assets
          ?.filter((a) => (scenario ? scenario.assetType === a.type && a.mw >= 900 : a.mw >= 2400))
          .map((a) => {
            const [x, y] = viewport.project([...a.coord, 8000 + a.mw * 16])
            return (
              <div key={a.name} className="pin fade-in" title={`${a.name}, ${a.mw} MW (approximate)`}
                style={{ left: x, top: y - 22, background: `var(--${a.type})` }}>
                <Icon name={ASSET_ICON[a.type]} size={15} stroke={2.2} />
              </div>
            )
          })}

      {sim && scenario && (() => {
        const z = zoneById[scenario.focus]
        const [x, y] = viewport.project([...z.centroid, towerHeight(priceOf(z.id))])
        const d = scenario.price_delta_eur[z.id] * scenario.scale
        return (
          <div className="callout fade-in" key={scenario.type} style={{ left: x, top: y }}>
            <div className="ic"><Icon name="pound" size={18} stroke={2.2} /></div>
            <div>
              <b>{z.name} {fmt.signed(z.currency === 'GBP' ? d / 1.15 : d)} {z.currency === 'GBP' ? '£' : '€'}/MWh</b>
              <span>Modelled · {scenario.label}</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
