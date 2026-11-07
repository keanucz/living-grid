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

// Simulate: each country is a 3D bar with its own outline as the footprint; height ∝ price
// (650 m per €/MWh on a 10 km base, so €300 stands ~205 km tall).
export const slabHeight = (eur) => 10000 + Math.max(0, eur ?? 0) * 650
// Walls need real diffuse light to read as solid bars; the glass look stays on the flat overview.
const BAR = { ambient: 0.42, diffuse: 0.78, shininess: 40, specularColor: [90, 90, 84] }
// Kept for the map callout, which anchors to the top of the focus zone.
export const towerHeight = slabHeight

export default {
  id: 'price',
  label: 'Price',
  swatch: '#c9a13a',
  order: 10,
  modes: ['overview', 'simulate'],
  defaultOn: true,
  build({ data, ui, priceOf }) {
    if (!data.geo) return []
    const sim = ui.mode === 'simulate'
    const zoneFeatures = data.geo.features.filter((f) => f.properties.zone)
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
          const p = priceOf(f.properties.zone)
          const on = f.properties.zone === ui.selectedZone
          return p == null ? COLORS.land : priceColor(p, sim ? 255 : on ? 240 : 218)
        },
        getLineColor: (f) => (f.properties.zone === ui.selectedZone ? [...COLORS.accent, 220] : [255, 255, 255, 46]),
        getLineWidth: (f) => (f.properties.zone === ui.selectedZone ? 2 : 1),
        lineWidthUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 28],
        // No attribute transitions here: on some GPUs an extruded polygon layer with transitions does not draw at all.
        updateTriggers: {
          getFillColor: [ui.selectedZone, ui.scenario?.ranAt, sim],
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
