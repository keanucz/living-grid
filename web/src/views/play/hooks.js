import { useEffect, useState } from 'react'

// Re-render a few times a second so timers count down; stops when the tab is hidden.
export function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => !document.hidden && setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
