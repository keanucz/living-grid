import React from 'react'
import { Composition, Series } from 'remotion'
import { VIDEO } from './theme'
import { SCENES, TOTAL_FRAMES, frames } from './scenes/registry'
import { Test } from './Test'

const Deck: React.FC = () => (
  <Series>
    {SCENES.map((s) => (
      <Series.Sequence key={s.id} durationInFrames={frames(s)}>
        <s.Component />
      </Series.Sequence>
    ))}
  </Series>
)

export const Root: React.FC = () => (
  <>
    <Composition id="Test" component={Test} durationInFrames={10 * VIDEO.fps} {...VIDEO} />
    <Composition id="Deck" component={Deck} durationInFrames={TOTAL_FRAMES} {...VIDEO} />
    {SCENES.map((s) => (
      <Composition key={s.id} id={`Scene-${s.id}`} component={s.Component} durationInFrames={frames(s)} {...VIDEO} />
    ))}
  </>
)
