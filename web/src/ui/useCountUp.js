import { useEffect, useRef, useState } from 'react'
import { countUpValue } from './countUp.js'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Animate a figure to `target` whenever it (or `key`) changes. `fromZero` restarts at 0 each time (a result that
// visibly builds up); otherwise it moves on from the value currently shown. Reduced motion jumps straight there.
export function useCountUp(target, { ms = 1400, key, fromZero = false } = {}) {
  const [v, setV] = useState(() => (reduced() ? target : 0))
  const shown = useRef(v)
  useEffect(() => {
    if (reduced()) {
      shown.current = target
      setV(target)
      return undefined
    }
    const from = fromZero ? 0 : shown.current
    const start = performance.now()
    let raf
    const tick = (now) => {
      const cur = countUpValue(from, target, now - start, ms)
      shown.current = cur
      setV(cur)
      if (cur !== target) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, key, ms, fromZero])
  return v
}
