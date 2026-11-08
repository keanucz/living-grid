import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client.js'
import { normaliseState } from '../../api/normalise.js'

const DAY_MS = 864e5
const dayOf = (iso) => new Date(Math.floor(Date.parse(iso) / DAY_MS) * DAY_MS).toISOString().slice(0, 10)
const hourIso = (iso) => new Date(Math.floor(Date.parse(iso) / 3600e3) * 3600e3).toISOString().replace('.000Z', 'Z')

async function fetchJson(path, ms) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(path, { signal: ctrl.signal })
    return r.ok ? await r.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

// GET /state/day: all 24 hours of a UTC day in one request, normalised exactly as /state is for the main map. Days are
// fetched once per page (one request per day instead of 24) and retried a few times when the API is slow.
const dayCache = new Map()
function loadDay(date) {
  if (dayCache.has(date)) return dayCache.get(date)
  const p = (async () => {
    const z = await api.zones()
    for (let n = 0; n < 3; n++) {
      const raw = await fetchJson(`/api/state/day?date=${date}`, 20000)
      if (raw?.hours?.length) {
        const out = {}
        for (const h of raw.hours) {
          const s = normaliseState(h, z.data)
          if (s.zones.length) out[hourIso(h.at)] = s
        }
        return out
      }
      await new Promise((r) => setTimeout(r, 1500 * (n + 1)))
    }
    return null
  })()
  dayCache.set(date, p)
  p.then((v) => v == null && dayCache.get(date) === p && dayCache.delete(date))
  return p
}

// The hours of the days around the playhead, keyed by ISO hour. `days` lists the UTC dates to hold (the playhead's day
// and the next, so playing across midnight does not wait). Returns { hours, failed }.
export function useDayStates(days) {
  const [hours, setHours] = useState({})
  const [failed, setFailed] = useState({})
  const key = days.join(',')
  useEffect(() => {
    let live = true
    for (const d of days) {
      loadDay(d).then((h) => {
        if (!live) return
        if (h) setHours((cur) => ({ ...cur, ...h }))
        else setFailed((cur) => ({ ...cur, [d]: true }))
      })
    }
    return () => {
      live = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return { hours, failed }
}

export const daysAround = (at, stepH = 1) => [dayOf(at), dayOf(new Date(Date.parse(at) + Math.max(stepH, 1) * 3600e3).toISOString())]
  .filter((d, i, a) => a.indexOf(d) === i)

// The state for the playhead hour: from the day's batch when it has the hour, else the per-hour /state (the client caches
// and prefetches), keeping the last good one on screen while the next loads. Returns { data, at, loading, missing }.
export function useMapState(at, dayHours = {}, dayFailed = false) {
  const fromDay = dayHours[hourIso(at)]
  const [res, setRes] = useState({ data: null, at: null, source: null })
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const lastGood = useRef(null)
  useEffect(() => {
    if (fromDay) {
      lastGood.current = { data: fromDay, at, source: 'live' }
      setRes(lastGood.current)
      setLoading(false)
      setMissing(false)
      return undefined
    }
    // Waiting for the day's batch: keep the last good hour on screen; only fall back per hour if the batch failed.
    if (!dayFailed) {
      setLoading(true)
      return undefined
    }
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
  }, [at, fromDay, dayFailed])
  return { ...res, loading, missing }
}

// Wind paid to switch off from the start of the playhead's day up to and including its hour: one /unseen/ghost-wind
// request for the whole day (hourly MW per mapped region), summed up to the playhead. Null while loading or unavailable.
const windCache = new Map()
function loadWindDay(date) {
  if (windCache.has(date)) return windCache.get(date)
  const p = fetchJson(`/api/unseen/ghost-wind?from=${date}T00:00:00Z&to=${date}T23:00:00Z`, 20000).then((d) => {
    if (!d?.regions) return null
    const byHour = {}
    for (const r of d.regions) for (const s of r.series ?? []) byHour[hourIso(s.ts)] = (byHour[hourIso(s.ts)] ?? 0) + (s.boalf_mw ?? 0)
    return byHour
  })
  windCache.set(date, p)
  p.then((v) => v == null && windCache.get(date) === p && windCache.delete(date))
  return p
}

export function windSoFar(byHour, at) {
  if (!byHour) return null
  const t = Date.parse(at)
  return Object.entries(byHour).reduce((a, [h, mw]) => (Date.parse(h) <= t ? a + mw : a), 0)
}

export function useDayWind(at) {
  const date = dayOf(at)
  const [byHour, setByHour] = useState({})
  useEffect(() => {
    let live = true
    loadWindDay(date).then((h) => live && setByHour((cur) => ({ ...cur, [date]: h })))
    return () => {
      live = false
    }
  }, [date])
  return windSoFar(byHour[date], at)
}

export function useGeo() {
  const [geo, setGeo] = useState(null)
  useEffect(() => {
    fetch('/geo/europe.json').then((r) => r.json()).then(setGeo).catch(() => setGeo(null))
  }, [])
  return geo
}
