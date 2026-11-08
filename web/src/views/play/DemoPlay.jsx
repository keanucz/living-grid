import { BeatRound } from './Round.jsx'
import { DEMO_BANNER, useDemo } from './demo.js'

// #/play?demo=1: the Beat the model screens on a scripted round with invented content. Labelled; no database.
export function DemoPlay() {
  const demo = useDemo(true)
  return (
    <BeatRound model={demo.model} banner={DEMO_BANNER} onAnswer={demo.answer} onAgain={demo.again} onLeave={() => { location.hash = '#/play' }} />
  )
}

export const isDemo = (hash = location.hash) => /[?&]demo=1(&|$)/.test(hash)
