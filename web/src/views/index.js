// Each folder in views/ registers a full-screen view by default-exporting { path, title, Component }.
// path is the hash route without '#', e.g. '/household'. '/' is the map and is not a view.
// A view with prefix: true also matches deeper paths, e.g. '/play' matches '/play/ABCD' (the view reads the rest itself).
const mods = import.meta.glob('./*/index.jsx', { eager: true })

export const VIEWS = Object.values(mods)
  .map((m) => m.default)
  .filter(Boolean)

export function matchView(hash) {
  const path = (hash || '').replace(/^#/, '').split('?')[0] || '/'
  return VIEWS.find((v) => v.path === path || (v.prefix && path.startsWith(`${v.path}/`))) ?? null
}

// One game entrance: the old market and room-game pages now live behind #/play.
export const REDIRECTS = { '/market': '#/play', '/game': '#/play' }

export function redirectOf(hash) {
  const path = (hash || '').replace(/^#/, '').split('?')[0]
  // The debug page opens from #debug or from ?debug=1 on any address.
  if (path === 'debug' || (path !== '/debug' && new URLSearchParams(location.search).get('debug'))) return `${location.pathname}#/debug`
  return REDIRECTS[path] ?? null
}
