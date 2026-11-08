import React from 'react'
import { Composition } from 'remotion'
import { seconds } from './list'
import { Beat, Callout, EndCard, LowerThird, Title } from './Overlays'
import { VIDEO } from './theme'

const BEATS = ['now', 'hidden-grid', 'what-if', 'forecast', 'proof', 'tonight', 'meter', 'play', 'reveal']
const CALLOUTS = ['constraint-bill', 'hormuz', 'less-wrong', 'in-range', 'battery', 'scored']
const PEOPLE = [['Keanu', 'keanu'], ['Stefan', 'stefan'], ['Manu', 'manu']] as const

const base = (id: string) => ({ id, ...VIDEO, durationInFrames: seconds(id) * VIDEO.fps })

// Every composition except Title and EndCard has no background, so it renders with an alpha channel.
export function Root() {
  return (
    <>
      <Composition {...base('Title')} component={Title} />
      {PEOPLE.map(([label, who]) => (
        <Composition key={label} {...base(`LowerThird-${label}`)} component={LowerThird} defaultProps={{ who }} />
      ))}
      {BEATS.map((b) => <Composition key={b} {...base(`Beat-${b}`)} component={Beat} defaultProps={{ id: b }} />)}
      {CALLOUTS.map((c) => <Composition key={c} {...base(`Callout-${c}`)} component={Callout} defaultProps={{ id: c }} />)}
      <Composition {...base('EndCard')} component={EndCard} />
    </>
  )
}
