import { useEffect, useRef, useState } from 'react'
import { actions, getState, setState, useStore } from '../../store/store.js'
import { WINDOWS, getGhostWind, load as loadGhostWind } from '../../layers/ghostWind/data.js'

// One playhead for the whole replay page: the shared store's `ui.at` (the hour the map shows), the same value the history
// scrubber (#223) moves. This file only translates between that ISO hour and an index into the replayed window.
export const HOUR = 3600e3
export const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z')
const floorH = (ms) => Math.floor(ms / HOUR) * HOUR

// The window to replay: hourly for up to a week, every 6 h up to a month, daily beyond (so a long event still plays in a minute).
export function windowFor(startIso, endIso) {
  const start = floorH(Date.parse(startIso))
  const end = Math.max(start + HOUR, floorH(Date.parse(endIso)))
  const span = end - start
  const stepH = span <= 7 * 24 * HOUR ? 1 : span <= 31 * 24 * HOUR ? 6 : 24
  const n = Math.min(400, Math.floor(span / (stepH * HOUR)) + 1)
  return { start, stepH, n }
}

export const atIndex = (win, i) => iso(win.start + Math.max(0, Math.min(win.n - 1, i)) * win.stepH * HOUR)
export const indexOf = (win, at) => (at ? Math.max(0, Math.min(win.n - 1, Math.round((Date.parse(at) - win.start) / (win.stepH * HOUR)))) : 0)

export const SPEEDS = [1, 2, 4]

// `ready(iso)` says whether an hour's data is on hand; while playing, the playhead waits on an hour that is not, so the
// map and the readout never fall behind the clock.
export function usePlayhead(win, ready = () => true) {
  const at = useStore((s) => s.at)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const i = indexOf(win, at)
  const inWindow = at != null && Date.parse(at) >= win.start - HOUR && Date.parse(at) <= win.start + win.n * win.stepH * HOUR
  const ref = useRef({ i, win, ready })
  ref.current = { i, win, ready }

  // Ghost wind only where the map has that day's data: the 26 October storm window, never today's last 24 hours (#312).
  useEffect(() => {
    const storm = iso(win.start).slice(0, 10) === WINDOWS.storm.from.slice(0, 10)
    if (storm && getGhostWind().window !== 'storm') loadGhostWind('storm')
    setState((s) => ({ layers: { ...s.layers, ghostWind: storm } }))
  }, [win.start])

  // Land on the first hour when the window changes or the playhead is somewhere else entirely.
  useEffect(() => {
    if (!inWindow) actions.setAt(atIndex(win, 0))
    setPlaying(false)
  }, [win.start, win.n]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return undefined
    const id = setInterval(() => {
      const { i: cur, win: w, ready: ok } = ref.current
      if (cur >= w.n - 1) return setPlaying(false)
      const next = atIndex(w, cur + 1)
      if (ok(next)) actions.setAt(next)
    }, 800 / speed)
    return () => clearInterval(id)
  }, [playing, speed])

  return {
    at: at ?? atIndex(win, 0),
    i,
    n: win.n,
    playing,
    speed,
    setSpeed,
    seek: (idx) => (setPlaying(false), actions.setAt(atIndex(win, idx))),
    toggle: () => {
      if (!playing && i >= win.n - 1) actions.setAt(atIndex(win, 0))
      setPlaying((p) => !p)
    },
  }
}

// While the replay page is open the map is in its plain overview with the layers a replay needs, none of today's
// overlays (boundary labels, weather): the previous mode, layers and hour come back when the page closes (#312).
// Ghost wind is switched on by the page only for a day it has data for (useReplayGhostWind).
export function useReplayShell() {
  useEffect(() => {
    const before = getState()
    const gwBefore = getGhostWind().window
    setState((s) => ({ mode: 'overview', layers: { ...s.layers, price: true, flows: true, ghostWind: false, carbon: false, ghost: false, wind: false, solar: false, boundaries: false } }))
    return () => {
      setState({ mode: before.mode, layers: before.layers, at: before.at })
      if (gwBefore && gwBefore !== getGhostWind().window) loadGhostWind(gwBefore)
    }
  }, [])
}
