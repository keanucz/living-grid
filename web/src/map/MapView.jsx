import { useEffect, useMemo, useRef, useState } from 'react'
import { DeckGL, GeoJsonLayer, PathLayer, FlyToInterpolator, LightingEffect, AmbientLight, PointLight, DirectionalLight } from 'deck.gl'
import { LAYERS } from '../layers/registry.js'
import { actions, useStore } from '../store/store.js'
import { COLORS, fmt } from '../styles/tokens.js'
import { Icon, ASSET_ICON } from '../shell/icons.jsx'
import { towerHeight, GLASS, outlines } from '../layers/price/index.js'

// Soft ambient plus a high point light over the North Sea: flat country slabs pick up a moving
// specular sheen as the map pans, which reads as glass/epoxy rather than flat paint.
const LIGHTING = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.0 }),
  sheen: new PointLight({ color: [255, 250, 240], intensity: 0.9, position: [4, 56, 1600000] }),
  key: new DirectionalLight({ color: [255, 255, 255], intensity: 0.25, direction: [-2, -3, -6] }),
})

const VIEWS = {
  overview: { longitude: 6.5, latitude: 54.4, zoom: 4.05, pitch: 0, bearing: 0 },
  simulate: { longitude: 4.2, latitude: 51.4, zoom: 4.35, pitch: 56, bearing: -16 },
}
// Phones frame the same zones in a short, narrow map.
if (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches) {
  VIEWS.overview = { longitude: 3.6, latitude: 54.2, zoom: 3.15, pitch: 0, bearing: 0 }
  VIEWS.simulate = { longitude: 3.8, latitude: 52.6, zoom: 3.35, pitch: 50, bearing: -12 }
}

const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches
// Bounded zoom and pan; the default views below still frame our six zones in Europe.
// The whole world is drawn (grey context); zoom out far enough to see it, but no further than one world.
const LIMITS = { minZoom: PHONE ? 0.3 : 1.1, maxZoom: 7.5, lon: [-180, 180], lat: [-58, 78] }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
function clampView(v) {
  return {
    ...v,
    minZoom: LIMITS.minZoom,
    maxZoom: LIMITS.maxZoom,
    zoom: clamp(v.zoom, LIMITS.minZoom, LIMITS.maxZoom),
    longitude: clamp(v.longitude, ...LIMITS.lon),
    latitude: clamp(v.latitude, ...LIMITS.lat),
  }
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
  const [viewState, setViewState] = useState(() => clampView(VIEWS.overview))
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

  // The tour's camera moves (tour/engine.js): a smooth fly-to to { longitude, latitude, zoom, pitch?, bearing?, duration? }.
  useEffect(() => {
    const on = (e) => {
      const { duration = 2200, ...to } = e.detail ?? {}
      setViewState((v) => clampView({ ...v, ...to, transitionDuration: duration, transitionInterpolator: new FlyToInterpolator({ speed: 1.2 }) }))
    }
    addEventListener('lg-camera', on)
    return () => removeEventListener('lg-camera', on)
  }, [])

  const zoom = (d) =>
    setViewState((v) => clampView({ ...v, zoom: v.zoom + d, transitionDuration: 300, transitionInterpolator: new FlyToInterpolator() }))
  const north = () =>
    setViewState((v) => ({ ...v, bearing: 0, pitch: ui.mode === 'simulate' ? 52 : 0, transitionDuration: 500, transitionInterpolator: new FlyToInterpolator() }))

  const base = useMemo(
    () =>
      ctx.data.geo && [
      new GeoJsonLayer({
        id: 'base-land',
        // The whole world in grey for context; only our zones get price colour (price layer).
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
      new PathLayer({
        id: 'base-borders',
        data: outlines(ctx.data.geo.features, 860),
        getPath: (d) => d.path,
        getColor: [64, 64, 62, 255],
        getWidth: 1,
        widthUnits: 'pixels',
      }),
    ],
    [ctx.data.geo],
  )

  const layerCtx = { ...ctx, time }
  const layers = [
    ...(base ?? []),
    ...LAYERS.filter((l) => l.modes.includes(ui.mode) && ui.layers[l.id] !== false).flatMap((l) => l.build(layerCtx)),
  ].filter(Boolean)

  return (
    <DeckGL
      viewState={viewState}
      onViewStateChange={({ viewState: v }) => setViewState(clampView(v))}
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

// Labels that would sit under the layer chips, the top bar or the phone's selected-zone chip, or past the
// map's edge, are skipped rather than hidden behind them or spilling onto the sheet below.
function underControls(x, y, viewport) {
  if (typeof document === 'undefined') return false
  if (x < 24 || x > viewport.width - 24 || y < 14 || y > viewport.height - 20) return true
  const box = (document.querySelector('.main') ?? document.querySelector('.m-map'))?.getBoundingClientRect()
  const px = x + (box?.left ?? 0)
  const py = y + (box?.top ?? 0)
  return [...document.querySelectorAll('.actions, .topbar, .m-layers, .m-sel')].some((el) => {
    const r = el.getBoundingClientRect()
    return px > r.left - 24 && px < r.right + 24 && py > r.top - 14 && py < r.bottom + 14
  })
}

function Overlay({ viewport, ctx }) {
  const { ui, data, zoneById, priceOf, scenario } = ctx
  if (!viewport || !data.zones) return null
  const project = (c) => viewport.project(c)
  const sim = ui.mode === 'simulate'

  return (
    <div className="overlay">
      {!sim && ui.section !== 'hidden' && viewport.zoom >= 3 &&
        data.zones.zones.map((z) => {
          const [x, y] = project(z.label_at)
          const st = ctx.stateByZone[z.id]
          if (!st) return null
          if (underControls(x, y, viewport)) return null
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
