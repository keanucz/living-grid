import React from 'react'
import { F, fmt } from './data'
import { Stage } from './components/Stage'
import { Bars, Big, Line, Row, Title } from './components/Parts'

// A 10 second check that the project, fonts, theme and snapshot all work: `npm run render:test` writes out/test.mp4.
export const Test: React.FC = () => {
  const gb = F.gbPrice(), m = F.maeModel(), p = F.maePersistence()
  return (
    <Stage kicker="Remotion test" sources={[gb, m, p]}>
      <Title>The Living Grid</Title>
      <Line delay={10}>A 10 second test composition: the site's look, with figures from data/snapshot.json.</Line>
      <Row gap={120}>
        <Big fig={gb} format={(v) => fmt.gbp(v)} label="GB price now, per MWh" delay={20} size={120} />
        <Bars items={[{ label: 'Our error', fig: m, strong: true }, { label: 'Persistence', fig: p }]} format={(v) => fmt.n(v, 1)} delay={60} />
      </Row>
    </Stage>
  )
}
