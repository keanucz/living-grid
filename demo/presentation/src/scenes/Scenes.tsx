import React from 'react'
import { F, fmt, replaySeries, wallet, commitments, zonePrices } from '../data'
import { Stage } from '../components/Stage'
import { Bars, Big, LineChart, Line, Row, Title } from '../components/Parts'

// Starter scenes for the deck. Each one is a real composition that reads its figures from the snapshot, so the Player and
// the render both work end to end. Presentation 2 (#253) rewrites the wording and layout; the figures keep coming from
// data.ts, and the clips in the product scene come from #254.

export const Hook: React.FC = () => {
  const gb = F.gbPrice()
  return (
    <Stage kicker="The Living Grid" sources={[gb]}>
      <Title size={150}>Electricity is invisible.</Title>
      <Line delay={20}>You cannot see what it costs to waste it, or where its carbon comes from.</Line>
      <Row><Big fig={gb} format={(v) => fmt.gbp(v)} label="Great Britain, day-ahead price now (per MWh)" delay={24} /></Row>
    </Stage>
  )
}

export const Problem: React.FC = () => {
  const bill = F.stormConstraintGbp()
  const cg = F.gbCarbonConsumed(), cp = F.gbCarbonProduced()
  return (
    <Stage kicker="The problem" sources={[bill, cg, cp]}>
      <Title>Wind gets paid to switch off.</Title>
      <Line delay={16}>On 26 October a storm hit Scotland and the grid could not carry the power south.</Line>
      <Row gap={140}>
        <Big fig={bill} format={(v) => fmt.bigGbp(v)} label="Constraint cost that day" delay={26} />
        <Big fig={cg} format={(v) => `${fmt.n(v)} g`} label="GB carbon consumed, per kWh, imports counted" delay={40} size={110} />
      </Row>
    </Stage>
  )
}

export const Built: React.FC = () => {
  const p50 = F.gbForecastP50(), p10 = F.gbForecastP10(), p90 = F.gbForecastP90()
  return (
    <Stage kicker="What we built" sources={[p50, p10, p90]}>
      <Title>The grid, made visible, then forecast.</Title>
      <Line delay={16}>Prices, flows, wind paid to switch off and carbon in imports on one map, with a forecast and its honest range.</Line>
      <Row gap={110}>
        <Big fig={p50} format={(v) => fmt.gbp(v)} label="GB forecast, next hour" delay={26} />
        <Big fig={p10} format={(v) => fmt.gbp(v)} label="Low end (P10)" delay={34} size={100} />
        <Big fig={p90} format={(v) => fmt.gbp(v)} label="High end (P90)" delay={42} size={100} />
      </Row>
    </Stage>
  )
}

export const Product: React.FC = () => {
  const cost = F.hormuzCostGbp(), d = F.hormuzGbDelta(), pct = F.hormuzGasPct(), days = F.hormuzDays()
  return (
    <Stage kicker="The product" sources={[cost, d, pct, days]}>
      <Title>Close the Strait of Hormuz.</Title>
      <Line delay={16}>{`Gas up ${fmt.n(pct.v)}% for ${fmt.n(days.v)} days. Screen clips of the live site go here (Presentation 3).`}</Line>
      <Row gap={140}>
        <Big fig={cost} format={(v) => fmt.bigGbp(v)} label="Extra cost to consumers" delay={26} />
        <Big fig={d} format={(v) => `+${fmt.n(v)}`} label="GB price change, £ per MWh" delay={38} size={110} />
      </Row>
    </Stage>
  )
}

export const Proof: React.FC = () => {
  const m = F.maeModel(), pr = F.maePersistence(), imp = F.maeImprovementPct(), cov = F.coverage(), n = F.forecastsScored()
  return (
    <Stage kicker="Proof" sources={[m, pr, imp, cov, n]}>
      <Title size={80}>Scored against simple guesses.</Title>
      <Bars format={(v) => fmt.n(v, 1)} items={[{ label: 'Our model, error', fig: m, strong: true }, { label: 'Persistence, error', fig: pr }]} />
      <Line delay={30} size={32}>{`${fmt.pct(imp.v)} smaller error. ${fmt.pct(cov.v)} of outcomes inside our P10 to P90 band, ${fmt.n(n.v)} forecasts scored, all logged before their outcome.`}</Line>
    </Stage>
  )
}

export const Play: React.FC = () => {
  const share = F.batteryShare()
  return (
    <Stage kicker="Play" sources={[share]}>
      <Title size={120}>Can you beat our model?</Title>
      <Line delay={18}>Call the grid on a real day with its date hidden, against our forecasters.</Line>
      <Row><Big fig={share} format={(v) => fmt.pct(v)} label="Battery profit as a share of perfect foresight" delay={28} size={110} /></Row>
    </Stage>
  )
}

export const How: React.FC = () => {
  const t = F.hubMerged(), a = F.hubAgents()
  return (
    <Stage kicker="How we built it" sources={[t, a]}>
      <Title size={88}>Three people and a lot of Claudes.</Title>
      <Row gap={140}>
        <Big fig={t} format={(v) => fmt.n(v)} label="Tasks merged through one queue" delay={14} />
        <Big fig={a} format={(v) => fmt.n(v)} label="Agents that merged them" delay={26} size={110} />
      </Row>
    </Stage>
  )
}

export const Close: React.FC = () => {
  const gbSeries = replaySeries('GB', 'price_da')
  return (
    <Stage kicker="Check it yourself" sources={[]}>
      <Title size={96}>htb.stefvuck.dev</Title>
      <Line delay={12}>{wallet ? `Every frozen forecast is hashed on Solana (${commitments.length} commitments from ${wallet.slice(0, 6)}…${wallet.slice(-4)}).` : 'Every frozen forecast is hashed on Solana.'}</Line>
      <LineChart width={1100} height={300} series={gbSeries.map((p) => ({ x: p.hour, y: p.actual, lo: p.p10, hi: p.p90, mid: p.p50 }))} unit="GB price on 26 October (£/MWh): actual, our as-of forecast and its band" />
    </Stage>
  )
}

export { zonePrices }
