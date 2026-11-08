import React from 'react'
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { F, fmt, wallet } from '../data'
import { COLORS, FONT, MONO } from '../theme'
import { Bars, Big, Line, LineChart, Row, Title } from '../components/Parts'
import { Beats, Caption, ClipFrame, EuropeMap, QR, QR_URL, Rise } from '../components/Extra'
import * as X from '../figs'

// The deck, about three minutes. Every number comes from the snapshot (src/data.ts and src/figs.ts); the words are plain
// British English and say what the figure is. Beats inside a scene change on a timer; the Player moves between scenes on a click.

// The tour step whose recording (public/clips/main/<step>.mp4) each product segment plays. Steps recorded: prices, flows, forecast,
// history, explain, ghostwind, hormuz, proof, play. Cheapest hours and the data centre have no tour step, so they use a title card.
export const CLIPS: Record<string, string | null> = { hidden: 'ghostwind', hormuz: 'hormuz', history: 'history', tonight: null, datacentre: null }

const gbpSeries = () => X.replaySeries('GB', 'price_da').map((p) => ({ x: p.hour, y: p.actual as number, lo: p.p10, hi: p.p90, mid: p.p50 }))
const asOf = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '–')

// 1. Hook (15 s)
export const Hook: React.FC = () => {
  const frame = useCurrentFrame()
  const prices = X.zonePriceList()
  const reveal = interpolate(frame, [30, 120], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <Beats beats={[{
      seconds: 15, kicker: 'The Living Grid', sources: [X.stateSrc()], render: () => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 40, marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <Title size={140}>Electricity is invisible.</Title>
            <Line delay={20} size={40}>You cannot see what it costs, where it flows or where its carbon comes from. This is the price across Europe right now.</Line>
          </div>
          <EuropeMap prices={prices} reveal={reveal} width={760} height={780} />
        </div>
      ),
    }]} />
  )
}

// 2. The problem (20 s)
export const Problem: React.FC = () => {
  const low = X.stormLow(), high = X.stormHigh(), bill = F.stormConstraintGbp()
  const gap = X.dirtiestImportGap()
  return (
    <Beats beats={[
      {
        seconds: 6.5, kicker: 'The problem', sources: [low, high], render: () => (
          <>
            <Title size={84}>Prices swing hard.</Title>
            <LineChart width={1300} height={420} series={gbpSeries()} unit="GB day-ahead price through 26 October, £ per MWh (solid line: what happened)" draw={70} />
            <Caption>{`In one day, Great Britain went from ${fmt.gbp(low.v)} to ${fmt.gbp(high.v)} per megawatt-hour.`}</Caption>
          </>
        ),
      },
      {
        seconds: 6.5, kicker: 'The problem', sources: [bill], render: () => (
          <>
            <Title size={84}>Wind gets paid to switch off.</Title>
            <Row gap={120}>
              <Big fig={bill} format={(v) => fmt.bigGbp(v)} label="GB grid-constraint bill, 26 Oct" delay={12} size={170} />
              <div style={{ marginBottom: 10 }}><EuropeMap prices={[]} labels={false} glowScotland width={420} height={430} /></div>
            </Row>
            <Caption>The grid could not carry a storm’s power south. Part of the bill pays Scottish wind farms to switch off.</Caption>
          </>
        ),
      },
      {
        seconds: 7, kicker: 'The problem', sources: [gap.made, gap.used, gap.share], render: () => (
          <>
            <Title size={84}>Clean at home, dirty by cable.</Title>
            <Row gap={110}>
              <Big fig={gap.made} format={(v) => `${fmt.n(v)} g`} label={`${gap.zone}: made at home, per kWh`} delay={8} size={130} />
              <Big fig={gap.used} format={(v) => `${fmt.n(v)} g`} label="Used, counting imports, per kWh" delay={22} size={130} />
              <Big fig={gap.share} format={(v) => `${fmt.n(v)}%`} label="Share of power imported" delay={36} size={90} />
            </Row>
            <Caption>A country’s own grid can look cleaner than the power it actually uses.</Caption>
          </>
        ),
      },
    ]} />
  )
}

// 3. What we built (20 s)
export const Built: React.FC = () => {
  const z = X.zoneCount(), l = X.linkCount()
  const p50 = F.gbForecastP50(), p10 = F.gbForecastP10(), p90 = F.gbForecastP90()
  return (
    <Beats beats={[
      {
        seconds: 9, kicker: 'What we built', sources: [z, l], render: () => (
          <>
            <Title size={84}>The grid, made visible.</Title>
            <div style={{ display: 'flex', gap: 60, alignItems: 'center', marginTop: 20 }}>
              <div style={{ flex: 1 }}>
                {['Prices in every country, on one fixed scale', 'Power flowing along the cables between them', 'Wind that was paid to switch off', 'Carbon, counting what each country imports'].map((t, i) => (
                  <Rise key={t} delay={10 + i * 14}><div style={{ fontSize: 40, color: COLORS.soft, marginTop: 22 }}>{t}</div></Rise>
                ))}
                <Row gap={80}>
                  <Big fig={z} format={(v) => fmt.n(v)} label="Zones" delay={70} size={90} />
                  <Big fig={l} format={(v) => fmt.n(v)} label="Interconnectors" delay={78} size={90} />
                </Row>
              </div>
              <EuropeMap prices={X.zonePriceList()} width={640} height={660} dim />
            </div>
          </>
        ),
      },
      {
        seconds: 11, kicker: 'What we built', sources: [p10, p50, p90], render: () => (
          <>
            <Title size={84}>Then forecast, and say how sure we are.</Title>
            <LineChart width={1300} height={380} series={gbpSeries()} unit="GB price on 26 October: actual, our forecast (dashed) and its P10 to P90 band, made with data from before the day" draw={90} />
            <Caption>{`Next hour in Great Britain: ${fmt.gbp(p50.v)}, probably between ${fmt.gbp(p10.v)} and ${fmt.gbp(p90.v)}.`}</Caption>
          </>
        ),
      },
    ]} />
  )
}

// 4. The product, in short real clips (65 s, five clips of 13 s)
const Segment: React.FC<{ title: string; lines: string[]; clip: string; stand: React.ReactNode }> = ({ title, lines, clip, stand }) => (
  <div style={{ display: 'flex', gap: 56, alignItems: 'center', marginTop: 10 }}>
    <div style={{ width: 640 }}>
      <Title size={64}>{title}</Title>
      {lines.map((t, i) => <Rise key={t} delay={14 + i * 12}><div style={{ fontSize: 32, color: COLORS.text2, marginTop: 18, lineHeight: 1.35 }}>{t}</div></Rise>)}
    </div>
    <ClipFrame step={CLIPS[clip]} title={title} width={1000}>{stand}</ClipFrame>
  </div>
)

export const Product: React.FC = () => {
  const cost = X.hormuzCost(), lo = X.hormuzCostLow(), hi = X.hormuzCostHigh()
  const hw = X.householdWindows()
  const dcg = X.dcGpus(), flex = X.dcFlexPct()
  const bill = F.stormConstraintGbp()
  const sentence = X.hormuzSentence()
  const gap = X.dirtiestImportGap()
  return (
    <Beats beats={[
      {
        seconds: 13, kicker: 'The product · Hidden grid', sources: [bill, gap.used], render: () => (
          <Segment title="See the hidden grid" clip="hidden" lines={['Wind switched off, with the bill.', 'Carbon that arrives by cable.', 'Where the grid is full.']}
            stand={<Big fig={bill} format={(v) => fmt.bigGbp(v)} label="Constraint bill, 26 Oct" size={110} />} />
        ),
      },
      {
        seconds: 13, kicker: 'The product · What if', sources: [cost, lo, hi], render: () => (
          <Segment title="Close the Strait of Hormuz" clip="hormuz" lines={[sentence ?? 'Gas goes up; so does power.', 'The cost counts up in pounds, with a range.']}
            stand={<><Big fig={cost} format={(v) => fmt.bigGbp(v)} label="Extra cost to consumers (central)" size={110} /><div style={{ fontSize: 24 }}>{`range ${fmt.bigGbp(lo.v)} to ${fmt.bigGbp(hi.v)}`}</div></>} />
        ),
      },
      {
        seconds: 13, kicker: 'The product · History', sources: [X.stormHigh()], render: () => (
          <Segment title="Replay 26 October" clip="history" lines={['The map plays the day.', 'Forecasts come from a model that had not seen it.']}
            stand={<LineChart width={800} height={300} series={gbpSeries()} unit="GB price, £ per MWh" draw={90} />} />
        ),
      },
      {
        seconds: 13, kicker: 'The product · Tonight', sources: [], render: () => (
          <Segment title="Cheapest hours tonight" clip="tonight" lines={hw.length ? hw.map((w) => `${w.label}: ${w.start} to ${w.end}, about ${fmt.n(w.pence, 1)}p per kWh.`) : ['The cheapest hours for your car and dishwasher.']}
            stand={<div style={{ fontSize: 30, lineHeight: 1.6 }}>{hw.map((w) => <div key={w.label}>{`${w.label}: ${w.start} to ${w.end}`}</div>)}</div>} />
        ),
      },
      {
        seconds: 13, kicker: 'The product · Data centres', sources: [dcg, flex], render: () => (
          <Segment title="Where to put a data centre" clip="datacentre" lines={[`A ${fmt.n(dcg.v)}-GPU site, ${fmt.n(flex.v)}% of the work movable within the day.`, 'Energy cost and carbon, by country. Estimates, not quotes.']}
            stand={<Big fig={dcg} format={(v) => fmt.n(v)} label="GPUs in the example" size={110} />} />
        ),
      },
    ]} />
  )
}

// 5. Proof (25 s)
export const Proof: React.FC = () => {
  const m = F.maeModel(), pr = F.maePersistence(), imp = F.maeImprovementPct(), cov = F.coverage(), n = F.forecastsScored(), hrs = X.backtestHours()
  const share = F.batteryShare()
  const rev = X.revealGb(), c = X.latestCommit(), cc = X.commitmentCount()
  return (
    <Beats beats={[
      {
        seconds: 9, kicker: 'Proof', sources: [m, pr, imp, hrs], render: () => (
          <>
            <Title size={80}>Scored against simple guesses.</Title>
            <Bars format={(v) => fmt.n(v, 1)} items={[{ label: 'Our model, error', fig: m, strong: true }, { label: 'Persistence, error', fig: pr }]} />
            <Caption>{`${fmt.pct(imp.v)} smaller average error than repeating the last value, over ${fmt.n(hrs.v)} hours of testing. A significance test agrees: it is not luck. Against a strong day-ahead rival it is a tie, and we say so.`}</Caption>
          </>
        ),
      },
      {
        seconds: 7, kicker: 'Proof', sources: [cov, n, share], render: () => (
          <>
            <Title size={80}>Honest about the range.</Title>
            <Row gap={110}>
              <Big fig={cov} format={(v) => fmt.pct(v)} label={`Outcomes inside our band (aim: ${X.coverageTarget}%)`} delay={6} size={130} />
              <Big fig={n} format={(v) => fmt.n(v)} label="Forecasts scored live, each logged first" delay={18} size={110} />
              <Big fig={share} format={(v) => fmt.pct(v)} label="Battery profit vs perfect foresight" delay={30} size={110} />
            </Row>
          </>
        ),
      },
      {
        seconds: 9, kicker: 'Proof', sources: [X.commitmentCount(), X.revealSrc()], render: () => (
          <>
            <Title size={80}>Monday’s forecast, frozen before the result.</Title>
            <div style={{ display: 'flex', gap: 60, alignItems: 'center' }}>
              <LineChart width={900} height={340} series={rev.map((p: any) => ({ x: p.hour, y: p.actual as number, lo: p.p10, hi: p.p90, mid: p.p50 }))} unit={`GB day-ahead forecast for ${X.deliveryDate() ?? '–'} (dashed), P10 to P90 band`} draw={60} />
              <div style={{ fontFamily: MONO, fontSize: 24, color: COLORS.text2, lineHeight: 1.7 }}>
                <div>{`Frozen: ${asOf(X.frozenAt())}`}</div>
                <div>{`Commitments on Solana devnet: ${fmt.n(cc.v)}`}</div>
                <div>{c ? `Latest hash: ${c.sha.slice(0, 12)}…` : ''}</div>
              </div>
            </div>
            <Caption>Each frozen forecast is fingerprinted on a public chain, then compared with the real auction result.</Caption>
          </>
        ),
      },
    ]} />
  )
}

// 6. Play (15 s)
export const Play: React.FC = () => {
  const m = F.maeModel()
  return (
    <Beats beats={[{
      seconds: 15, kicker: 'Play', sources: [m], render: () => (
        <>
          <Title size={120}>Can you beat our model?</Title>
          <Line delay={16} size={44}>Call the grid on a real day with its date hidden. Buy and sell Yes or No on questions such as “will GB wind be switched off?”, against our forecasters.</Line>
          <Row><Big fig={m} format={(v) => fmt.n(v, 1)} label="Our average error to beat (£ per MWh, backtest)" delay={30} size={110} /></Row>
        </>
      ),
    }]} />
  )
}

// 7. How we built it (15 s)
export const How: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = F.hubMerged(), a = F.hubAgents()
  const N = Math.round(t.v ?? 0)
  const shown = Math.round(interpolate(frame, [20, 20 + 5 * fps], [0, N], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))
  return (
    <Beats beats={[{
      seconds: 15, kicker: 'How we built it', sources: [t, a], render: () => (
        <>
          <Title size={88}>Three people and a lot of Claudes.</Title>
          <div style={{ display: 'flex', gap: 80, marginTop: 40, alignItems: 'flex-start' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(26, 1fr)', gap: 6, width: 1000 }}>
              {Array.from({ length: N }).map((_, i) => <div key={i} style={{ aspectRatio: '1', borderRadius: 3, background: i < shown ? COLORS.accent : COLORS.card2 }} />)}
            </div>
            <div>
              <Big fig={t} format={() => fmt.n(shown)} label="Tasks merged through one queue" delay={0} size={120} />
              <div style={{ height: 40 }} />
              <Big fig={a} format={(v) => fmt.n(v)} label="Agents that merged them" delay={20} size={90} />
            </div>
          </div>
          <Caption>Python and LightGBM for the forecasts, FastAPI for the engine, React and deck.gl for the map, SpacetimeDB for shared live state.</Caption>
        </>
      ),
    }]} />
  )
}

// 8. Close (10 s)
export const Close: React.FC = () => (
  <Beats beats={[{
    seconds: 10, kicker: 'Check it yourself', render: () => (
      <div style={{ display: 'flex', gap: 80, alignItems: 'center', marginTop: 20 }}>
        <div style={{ flex: 1 }}>
          <Title size={110}>{QR_URL.replace('https://', '')}</Title>
          <Line delay={12} size={40}>{wallet ? `Every frozen forecast is hashed on Solana (${wallet.slice(0, 6)}…${wallet.slice(-4)}). Open it on your phone and call the grid yourself.` : 'Open it on your phone and call the grid yourself.'}</Line>
          <div style={{ fontFamily: FONT, color: COLORS.text3, fontSize: 28, marginTop: 40 }}>Built at HackTheBurgh XIII. Public data only.</div>
        </div>
        <Rise delay={8}><QR size={420} /></Rise>
      </div>
    ),
  }]} />
)
