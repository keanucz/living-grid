import { useEffect, useState } from 'react'

export const REGIONS = {
  A: 'East England', B: 'East Midlands', C: 'London', D: 'North Wales and Merseyside', E: 'West Midlands', F: 'North East England',
  G: 'North West England', H: 'Southern England', J: 'South East England', K: 'South Wales', L: 'South West England', M: 'Yorkshire',
  N: 'South and Central Scotland', P: 'North Scotland',
}
const ZONES = { GB: 'Great Britain', FR: 'France', 'DE-LU': 'Germany and Luxembourg', NL: 'the Netherlands', BE: 'Belgium', NO2: 'Southern Norway' }
export const label = (loc) => (REGIONS[loc] ? `${REGIONS[loc]} (GB ${loc})` : ZONES[loc] ?? loc)

export function money(v, sym = '€') {
  const a = Math.abs(v)
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}m` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0)
  return `${v < 0 ? '−' : ''}${sym}${s}`
}
export const tonnes = (t) => (t >= 1e4 ? `${(t / 1e3).toFixed(1)}k t` : `${t.toFixed(0)} t`)
export const mwh = (v) => (v >= 1e3 ? `${(v / 1e3).toFixed(1)} GWh` : `${v.toFixed(0)} MWh`)

export function useReducedMotion() {
  const [r, setR] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return undefined
    const m = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setR(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return r
}

// Eases from the last shown value to `target` over `ms`; jumps straight there when motion is reduced.
export function useCountUp(target, reduced, ms = 1100) {
  const [v, setV] = useState(target)
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame === 'undefined') { setV(target); return undefined }
    let raf
    const from = v
    const t0 = performance.now()
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(from + (target - from) * (1 - (1 - k) ** 3))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduced])
  return v
}
