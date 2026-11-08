import { useEffect, useMemo, useRef, useState } from 'react'
import { DeckGL, GeoJsonLayer, PathLayer, FlyToInterpolator, LinearInterpolator, LightingEffect, AmbientLight, PointLight, DirectionalLight } from 'deck.gl'
import { LAYERS } from '../layers/registry.js'
import { actions, useStore } from '../store/store.js'
import { COLORS, fmt } from '../styles/tokens.js'
import { Icon, ASSET_ICON } from '../shell/icons.jsx'
import { towerHeight, GLASS, outlines } from '../layers/price/index.js'
import { onTop } from '../layers/scenarioFx/index.js'
import { fmtPence } from '../lib/wholesale.js'

// Short country names for the price labels on the map; the zone list and hover cards keep the full names.
const MAP_NAME = { GB: 'Britain', FR: 'France', 'DE-LU': 'Germany', NL: 'Netherlands', BE: 'Belgium', NO2: 'Norway' }

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
// On the small phone map Belgium's price label lands on Germany's: move it down and left, clear of both neighbours.
const PHONE_NUDGE = { BE: [-26, 18] }
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

const EASE_IN_OUT = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)

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
  // Read-only mirror of the camera for browser QA scripts (tour and intro camera checks); nothing reads it back.
  useEffect(() => { window.lgViewState = viewState }, [viewState])
  const first = useRef(true)

  // The view for a mode: simulate tilts and, during an event, centres on the zone it hits hardest (unless that is GB).
  const latest = useRef(ctx)
  latest.current = ctx
  const modeView = (mode) => {
    const c = latest.current
    const focus = c.scenario ? c.zoneById[c.scenario.focus] : null
    const target = { ...(VIEWS[mode] ?? VIEWS.overview) }
    if (mode === 'simulate' && focus && focus.id !== 'GB') {
      target.longitude = focus.centroid[0]
      target.latitude = focus.centroid[1] + 2
    }
    return target
  }

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setViewState((v) => ({ ...v, ...modeView(ui.mode), transitionDuration: 1600, transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.mode, ctx.scenario?.focus])

  // Camera requests (tour/engine.js, intro/Intro.jsx). detail is { to, from?, duration } where to and from are each a
  // camera { longitude, latitude, zoom, pitch?, bearing? }, 'home', or { mode }; or, older form, a camera plus duration.
  // With from, the view snaps there first and the move plays from it; without, it flies from wherever the camera is,
  // which also takes over cleanly from a move still running. Either way the move always runs to its end.
  // Until deck has loaded, a camera set here is overwritten by its first view report; hold requests until then.
  const loaded = useRef(false)
  const held = useRef(null)
  const onCamera = useRef(null)
  const onLoad = () => {
    window.lgMapReady = performance.now()
    setTimeout(() => {
      loaded.current = true
      if (held.current) onCamera.current?.(held.current)
      held.current = null
    }, 300)
  }
  useEffect(() => {
    const resolve = (x) => (x === 'home' ? VIEWS.overview : x?.mode ? modeView(x.mode) : x)
    const on = (e) => {
      if (!loaded.current) {
        held.current = e
        return
      }
      const d = e.detail ?? {}
      const { duration = 2200, from, to: target, interp: _interp, ...plain } = d
      const to = resolve(target ?? plain)
      if (!to) return
      // interp 'linear': one steady eased zoom (the intro's zoom-out); a fly-to arcs out and back in on long moves.
      const interp = d.interp === 'linear'
        ? { transitionInterpolator: new LinearInterpolator(['longitude', 'latitude', 'zoom', 'pitch', 'bearing']), transitionEasing: EASE_IN_OUT }
        : { transitionInterpolator: new FlyToInterpolator({ speed: 1.2 }) }
      const fly = () => setViewState((v) => clampView({ ...v, ...to, transitionDuration: duration, ...interp }))
      const start = resolve(from)
      if (start) {
        setViewState((v) => clampView({ ...v, ...start, transitionDuration: 0 }))
        requestAnimationFrame(() => requestAnimationFrame(fly))
      } else if (duration === 0) {
        setViewState((v) => clampView({ ...v, ...to, transitionDuration: 0 }))
      } else fly()
    }
    onCamera.current = on
    addEventListener('lg-camera', on)
    // A request made just before this map mounted (back from a page such as Play) still plays.
    const pending = window.lgPendingCamera
    if (pending && performance.now() - pending.at < 1500) on({ detail: pending.detail })
    return () => removeEventListener('lg-camera', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // The intro waits for this before its first cut: a camera set while deck is still starting up is overwritten.
      onLoad={onLoad}
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
  const net = st.net_import_mw == null ? '' : `<br/>Britain's cables: net ${st.net_import_mw >= 0 ? 'import' : 'export'} ${(Math.abs(st.net_import_mw) / 1000).toFixed(1)} GW`
  const fc = st.forecast?.p50 != null ? `<br/><span style="opacity:.6">Forecast P50 ${st.forecast.p50.toFixed(0)} (${st.forecast.p10.toFixed(0)}–${st.forecast.p90.toFixed(0)}), +${st.forecast.horizon_h} h</span>` : ''
  const lag = st.metered_as_of ? `<br/><span style="opacity:.6">Load and mix metered, about a day behind</span>` : ''
  const tag = ctx.scenario ? ' <span style="color:#ff8a1f">modelled</span>' : ''
  return `<b>${z.name}</b><br/><span style="font-size:18px;font-weight:600">${fmt.price(shown, st.currency)}</span>/MWh${tag}${mix ? `<br/>${mix}` : ''}${lag}${net}${fc}`
}

function tooltip({ object, layer }, ctx) {
  if (!object || !layer) return null
  const style = { background: '#1c1c1b', color: '#f2f2ef', borderRadius: '10px', border: '1px solid rgba(255,255,255,.12)', fontSize: '12px', padding: '8px 10px', lineHeight: '1.5', textTransform: 'none', zIndex: 30 }
  if (layer.id === 'price-zones' || layer.id === 'price-towers') {
    const html = zoneCard(object.properties?.zone ?? object.id, ctx)
    return html && { html, style }
  }
  if (typeof layer.props.tooltip === 'function') return { html: layer.props.tooltip(object), style }
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
      <style>{`.pin .pin-name { display: none; position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%); white-space: nowrap; padding: 3px 8px; border-radius: 6px; background: #1c1c1b; color: #f2f2ef; border: 1px solid rgba(255,255,255,.14); font-size: 11.5px; font-weight: 500; pointer-events: none; }
        .pin:hover .pin-name, .pin:focus-within .pin-name { display: block; }`}</style>
      {!sim && ui.section !== 'hidden' && viewport.zoom >= 3 &&
        data.zones.zones.map((z) => {
          const [dx, dy] = (PHONE && PHONE_NUDGE[z.id]) || [0, 0]
          const [px, py] = project(z.label_at)
          const [x, y] = [px + dx, py + dy]
          const st = ctx.stateByZone[z.id]
          if (!st) return null
          if (underControls(x, y, viewport)) return null
          return (
            <div key={z.id} className={`map-label ${ui.selectedZone === z.id ? 'on' : ''}`} style={{ left: x, top: y }}
              onClick={() => actions.selectZone(z.id)}>
              {MAP_NAME[z.id] ?? z.name} <b className="num">{fmt.price(st.price, st.currency)}</b>
            </div>
          )
        })}

      {/* Phones show plant pins only for a running scenario: at that size the full set crowds GB and NL. */}
      {sim && (scenario || !PHONE) &&
        data.assets
          ?.filter((a) => (scenario ? scenario.assetType === a.type && a.mw >= 900 : a.mw >= 2400))
          .map((a) => {
            // On the top of its own country's bar, so the pin reads as part of that country.
            const [x, y] = viewport.project(onTop(data, priceOf, a.coord, 4000))
            return (
              <div key={a.name} className="pin fade-in" title={`${a.name}, ${a.mw} MW (approximate)`}
                style={{ left: x, top: y - 22, background: `var(--${a.type})` }}>
                <Icon name={ASSET_ICON[a.type]} size={15} stroke={2.2} />
                <span className="pin-name">{a.name} · {a.mw.toLocaleString('en-GB')} MW</span>
              </div>
            )
          })}

      {sim && scenario && (() => {
        const z = zoneById[scenario.focus]
        const [x, y] = viewport.project([...z.centroid, towerHeight(priceOf(z.id))])
        const d = scenario.price_delta_eur[z.id] * scenario.scale
        return (
          // Phones: keep the callout (14 px offset, up to 220 px wide) inside the map's right edge, and below the
          // "Illustrative effect" label.
          <div className="callout fade-in" key={scenario.type}
            style={PHONE ? { left: Math.max(0, Math.min(x, viewport.width - 242)), top: y + 50 } : { left: x, top: y }}>
            <div className="ic"><Icon name="pound" size={18} stroke={2.2} /></div>
            <div>
              {/* Britain in the units on a bill (wholesale pence per kWh); other zones in euros per MWh. */}
              <b>{z.currency === 'GBP'
                ? `Britain ${d < 0 ? '−' : '+'}${fmtPence(d / 1.15)} per kWh wholesale`
                : `${z.name} ${d < 0 ? '−' : '+'}€${Math.abs(d).toFixed(1)} per MWh`}</b>
              <span>Modelled · {scenario.label}</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
