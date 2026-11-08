import { useState } from 'react'
import { PmGame } from './pm/PmGame.jsx'
import { DEMO_BANNER, usePmDemo } from './pm/demo.js'

// #/play?demo=1: the market feed on a scripted day of invented markets. Labelled; no database.
export function DemoPlay() {
  const demo = usePmDemo()
  const [err, setErr] = useState(null)
  return (
    <PmGame
      model={demo.model}
      banner={DEMO_BANNER}
      rehearsal
      error={err}
      clearError={() => setErr(null)}
      onTrade={async (action, marketId, side, shares) => {
        setErr(null)
        try {
          await demo.trade(action, marketId, side, shares)
          return true
        } catch (e) {
          setErr(e.message)
          return false
        }
      }}
      onAgain={demo.again}
      onLeave={() => {
        location.hash = '#/play'
      }}
    />
  )
}

export const isDemo = (hash = location.hash) => /[?&]demo=1(&|$)/.test(hash)
