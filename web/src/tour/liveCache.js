// The tour's live caption figures: one request per API path per page load, shared by every step, prefetched when a
// tour starts. A busy page (the 3D map on a slow machine) can take seconds to handle a fast answer, so a request is
// only given up after 12 s. Failures are not cached, so a later step tries again; the caption keeps its fallback words.
export const TIMEOUT_MS = 12000
const pending = new Map() // path -> Promise of the JSON
const done = new Map() // path -> the JSON, once it has arrived

export function getJSON(path, { fetchImpl = fetch, timeout = TIMEOUT_MS } = {}) {
  if (!pending.has(path)) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    const p = fetchImpl(`/api${path}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { done.set(path, j); return j })
      .finally(() => clearTimeout(timer))
    p.catch(() => pending.delete(path))
    pending.set(path, p)
  }
  return pending.get(path)
}

// The JSON for a path if it has already arrived, so a cached figure is shown at once instead of its fallback.
export const peek = (path) => done.get(path)

// Start every request the steps' captions need; returns the paths.
export function prefetch(steps, opts) {
  const paths = [...new Set(steps.flatMap((s) => Object.values(s.live ?? {}).map((spec) => spec.path)))]
  for (const p of paths) getJSON(p, opts).catch(() => {})
  return paths
}
