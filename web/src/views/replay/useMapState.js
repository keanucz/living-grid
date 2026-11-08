import { useEffect, useState } from 'react'
import { api } from '../../api/client.js'

// The /state for the playhead hour, keeping the last good one on screen while the next loads (the client already caches
// per hour and prefetches the neighbours). Returns { data, at, loading, missing }.
export function useMapState(at) {
  const [res, setRes] = useState({ data: null, at: null, source: null })
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let live = true
    let timer = 0
    setLoading(true)
    const attempt = (n) => {
      api.state(at).then((r) => {
        if (!live || r.source === 'superseded') return
        // Only the real API's answer for this hour counts. The client falls back to committed sample data when the API is
        // slow or down; a replay must not show that as if it were the hour being played. Try again a few times first.
        if (r.source === 'live' && r.data?.zones?.length) {
          setLoading(false)
          setRes({ data: r.data, at, source: r.source })
          setMissing(false)
        } else if (n < 3) timer = setTimeout(() => attempt(n + 1), 1500 * (n + 1))
        else (setLoading(false), setMissing(true))
      }).catch(() => (n < 3 ? (timer = setTimeout(() => attempt(n + 1), 1500 * (n + 1))) : live && (setLoading(false), setMissing(true))))
    }
    attempt(0)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [at])
  return { ...res, loading, missing }
}

export function useGeo() {
  const [geo, setGeo] = useState(null)
  useEffect(() => {
    fetch('/geo/europe.json').then((r) => r.json()).then(setGeo).catch(() => setGeo(null))
  }, [])
  return geo
}
