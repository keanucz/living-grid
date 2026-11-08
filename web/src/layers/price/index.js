import { GeoJsonLayer, PathLayer } from 'deck.gl'
import { priceColor, COLORS } from '../../styles/tokens.js'

export const GLASS = { ambient: 0.72, diffuse: 0.32, shininess: 120, specularColor: [70, 70, 66] }

// Extruded polygons get no stroke in deck.gl, so outlines are drawn as paths on the slab's top face.
const outlineCache = new WeakMap()
export function outlines(features, z) {
  const key = outlineCache.get(features)?.[z]
  if (key) return key
  const paths = []
  for (const f of features) {
    const g = f.geometry
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    for (const poly of polys)
      for (const ring of poly) {
        // Split where a ring wraps the antimeridian, or the jump draws a line across the map.
        let cur = []
        for (const [x, y] of ring) {
          if (cur.length && Math.abs(x - cur[cur.length - 1][0]) > 30) {
            if (cur.length > 1) paths.push({ zone: f.properties.zone, path: cur })
            cur = []
          }
          cur.push([x, y, z])
        }
        if (cur.length > 1) paths.push({ zone: f.properties.zone, path: cur })
      }
  }
  outlineCache.set(features, { ...(outlineCache.get(features) ?? {}), [z]: paths })
  return paths
}

// Simulate: each country is a 3D bar with its own outline as the footprint. Heights span today's price range
// (cheapest zone ~25 km, dearest ~300 km) so small differences show; the range comes from pre-scenario prices,
// so a scenario visibly lifts or lowers bars against it. Set each build from the current state.
let range = { lo: 0, hi: 400 }
export function setRange(prices) {
  const v = prices.filter((p) => Number.isFinite(p))
  if (!v.length) return
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const pad = Math.max(10, (hi - lo) * 0.15)
  range = { lo: lo - pad, hi: hi + pad }
}
export const slabHeight = (eur) => {
  if (eur == null || !Number.isFinite(eur)) return 15000
  const t = (eur - range.lo) / Math.max(1, range.hi - range.lo)
  return 15000 + Math.max(0, Math.min(1.25, t)) * 300000
}
export const priceRange = () => range
// Change colour for the What if map: grey at no change, red for the biggest rise, blue for a fall (EUR/MWh).
const NONE = [60, 60, 58]
const RISE = [214, 64, 48]
const FALL = [70, 120, 190]
export function changeColor(eur, max) {
  const t = Math.min(1, Math.abs(eur) / Math.max(1, max))
  const to = eur < 0 ? FALL : RISE
  return [...NONE.map((c, i) => Math.round(c + (to[i] - c) * t)), 255]
}
// Walls need real diffuse light to read as solid bars; the glass look stays on the flat overview.
const BAR = { ambient: 0.42, diffuse: 0.78, shininess: 40, specularColor: [90, 90, 84] }
// Kept for the map callout, which anchors to the top of the focus zone.
export const towerHeight = slabHeight

// Desaturate towards the colour's own brightness, keeping a trace of the price scale.
const mute = ([r, g, b, a]) => {
  const l = 0.3 * r + 0.59 * g + 0.11 * b
  const k = 0.05
  return [r, g, b].map((v) => Math.round((l + (v - l) * k) * 0.7)).concat(a)
}

export default {
  id: 'price',
  label: 'Price',
  swatch: '#c9a13a',
  order: 10,
  modes: ['overview', 'simulate'],
  defaultOn: true,
  build({ data, ui, priceOf, scenario }) {
    if (!data.geo) return []
    const sim = ui.mode === 'simulate'
    // With a world event up, each country is coloured by how much its price moved (the What if key: "Redder =
    // bigger rise"); heights still show the new price.
    const change = sim && scenario ? (zone) => (scenario.price_delta_eur?.[zone] ?? 0) * (scenario.scale ?? 1) : null
    const changeMax = change ? Math.max(10, ...Object.keys(scenario.price_delta_eur ?? {}).map((z) => Math.abs(change(z)))) : 0
    // While the Sun layer is on, the price fill goes grey (labels keep the numbers) so the sunshine is not lost in orange.
    const muted = !sim && ui.layers?.solar === true
    const zoneFeatures = data.geo.features.filter((f) => f.properties.zone)
    if (sim) setRange((data.state?.zones ?? []).map((z) => z.price_eur))
    return [
      new GeoJsonLayer({
        id: 'price-zones',
        data: zoneFeatures,
        filled: true,
        stroked: false,
        // Thin glossy slab: the scene's point light slides a specular highlight across it (epoxy look).
        extruded: true,
        getElevation: (f) => (sim ? slabHeight(priceOf(f.properties.zone)) : 2500),
        material: sim ? BAR : GLASS,
        getFillColor: (f) => {
          if (change) return changeColor(change(f.properties.zone), changeMax)
          const p = priceOf(f.properties.zone)
          const on = f.properties.zone === ui.selectedZone
          if (p == null) return COLORS.land
          const c = priceColor(p, sim ? 255 : on ? 240 : 218)
          return muted ? mute(c) : c
        },
        getLineColor: (f) => (f.properties.zone === ui.selectedZone ? [...COLORS.accent, 220] : [255, 255, 255, 46]),
        getLineWidth: (f) => (f.properties.zone === ui.selectedZone ? 2 : 1),
        lineWidthUnits: 'pixels',
        pickable: true,
        // No autoHighlight: on some GPUs the hover-highlight pass hid this whole layer except while dragging.
        // No attribute transitions here: on some GPUs an extruded polygon layer with transitions does not draw at all.
        updateTriggers: {
          getFillColor: [ui.selectedZone, ui.scenario?.ranAt, sim, ui.liveResult, !!change, muted],
          getElevation: [sim, ui.scenario?.ranAt, data.state],
          getLineColor: [ui.selectedZone],
          getLineWidth: [ui.selectedZone],
        },
      }),
      new PathLayer({
        id: 'price-zone-borders',
        // Borders sit on each zone's own top face, so they ride up with it.
        data: sim
          ? zoneFeatures.flatMap((f) => outlines([f], Math.round(slabHeight(priceOf(f.properties.zone))) + 60))
          : outlines(zoneFeatures, 2560),
        getPath: (d) => d.path,
        getColor: (d) => (d.zone === ui.selectedZone ? [...COLORS.accent, 255] : [250, 250, 250, 120]),
        getWidth: (d) => (d.zone === ui.selectedZone ? 2 : 1),
        widthUnits: 'pixels',
        jointRounded: true,
        updateTriggers: { getColor: [ui.selectedZone, ui.scenario?.ranAt, data.state], getWidth: [ui.selectedZone] },
      }),
    ].filter(Boolean)
  },
}
