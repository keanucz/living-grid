import { ColumnLayer, GeoJsonLayer, PathLayer } from 'deck.gl'
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

export const towerHeight = (eur) => 20000 + Math.max(0, eur ?? 0) * 700

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
        getElevation: sim ? 6000 : 2500,
        material: GLASS,
        getFillColor: (f) => {
          const p = priceOf(f.properties.zone)
          const on = f.properties.zone === ui.selectedZone
          return p == null ? COLORS.land : priceColor(p, sim ? 150 : on ? 235 : 205)
        },
        getLineColor: (f) => (f.properties.zone === ui.selectedZone ? [...COLORS.accent, 220] : [255, 255, 255, 46]),
        getLineWidth: (f) => (f.properties.zone === ui.selectedZone ? 2 : 1),
        lineWidthUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 28],
        transitions: { getFillColor: 600 },
        updateTriggers: {
          getFillColor: [ui.selectedZone, ui.scenario?.ranAt, sim],
          getElevation: [sim],
          getLineColor: [ui.selectedZone],
          getLineWidth: [ui.selectedZone],
        },
      }),
      new PathLayer({
        id: 'price-zone-borders',
        data: outlines(zoneFeatures, (sim ? 6000 : 2500) + 60),
        getPath: (d) => d.path,
        getColor: (d) => (d.zone === ui.selectedZone ? [...COLORS.accent, 255] : [236, 236, 228, 210]),
        getWidth: (d) => (d.zone === ui.selectedZone ? 2.2 : 1.3),
        widthUnits: 'pixels',
        jointRounded: true,
        updateTriggers: { getColor: [ui.selectedZone], getWidth: [ui.selectedZone] },
      }),
      sim &&
        new ColumnLayer({
          id: 'price-towers',
          data: data.zones?.zones ?? [],
          diskResolution: 6,
          radius: 32000,
          extruded: true,
          getPosition: (z) => z.centroid,
          getElevation: (z) => towerHeight(priceOf(z.id)),
          getFillColor: (z) => priceColor(priceOf(z.id) ?? 0, 255),
          material: { ambient: 0.55, diffuse: 0.5, shininess: 72, specularColor: [255, 245, 230] },
          pickable: true,
          transitions: { getElevation: { duration: 1200, easing: (t) => 1 - Math.pow(1 - t, 3) }, getFillColor: 900 },
          updateTriggers: { getElevation: [ui.scenario?.ranAt], getFillColor: [ui.scenario?.ranAt] },
        }),
    ].filter(Boolean)
  },
}
