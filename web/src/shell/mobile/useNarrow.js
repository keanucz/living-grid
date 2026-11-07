import { useEffect, useState } from 'react'

export const NARROW = '(max-width: 700px)'

export function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(NARROW).matches)
  useEffect(() => {
    const mq = matchMedia(NARROW)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}
