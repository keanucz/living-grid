// Each folder in layers/ registers itself by default-exporting
//   { id, label, swatch?, order, modes: ['overview','simulate'], defaultOn, build(ctx) => Layer[] }
// ctx = { data: { zones, state, geo, assets, scenarios }, ui: store state, time (s), zoneById, priceOf(zone) }
// Folders starting with _ are ignored. Never edit this file to add a layer.
const mods = import.meta.glob('./*/index.js', { eager: true })

export const LAYERS = Object.entries(mods)
  .filter(([path]) => !path.startsWith('./_'))
  .map(([, m]) => m.default)
  .filter(Boolean)
  .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
