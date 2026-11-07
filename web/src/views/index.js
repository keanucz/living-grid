// Each folder in views/ registers a full-screen view by default-exporting { path, title, Component }.
// path is the hash route without '#', e.g. '/household'. '/' is the map and is not a view.
const mods = import.meta.glob('./*/index.jsx', { eager: true })

export const VIEWS = Object.values(mods)
  .map((m) => m.default)
  .filter(Boolean)

export function matchView(hash) {
  const path = (hash || '').replace(/^#/, '').split('?')[0] || '/'
  return VIEWS.find((v) => v.path === path) ?? null
}
