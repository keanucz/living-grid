import React from 'react'
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { F, fmt, wallet } from '../data'
import type { Fig } from '../data'
import { COLORS, FONT, MONO } from '../theme'
import { Bars, Big, Line, LineChart, Row, Title } from '../components/Parts'
import { Beats, Caption, EuropeMap, QR, QR_URL, Rise, ShotFrame, ShotFull } from '../components/Extra'
import * as X from '../figs'

// The deck, about three minutes. Every number comes from the snapshot (src/data.ts and src/figs.ts); the words are plain
// British English and say what the figure is. Beats inside a scene change on a timer; the Player moves between scenes on a click.

// The tour step whose recording (public/clips/main/<step>.mp4) each product segment plays. Steps recorded: prices, flows, forecast,
// history, explain, ghostwind, hormuz, proof, play. Cheapest hours and the data centre have no tour step, so they use a title card.
export const CLIPS: Record<string, string | null> = { hidden: 'ghostwind', hormuz: 'hormuz', history: 'history', tonight: null, datacentre: null }

const gbpSeries = () => X.replaySeries('GB', 'price_da').map((p) => ({ x: p.hour, y: p.actual as number, lo: p.p10, hi: p.p90, mid: p.p50 }))
const missed = () => { const s = gbpSeries(); const out = s.filter((p) => p.lo != null && p.hi != null && (p.y > p.hi! || p.y < p.lo!)); const peak = s.reduce((a, p) => (p.y > a.y ? p : a), s[0]); return { n: out.length, of: s.length, peak, high: out.filter((p) => p.y > p.hi!).length } }
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
            <Title size={150}>Electricity is invisible.</Title>
            <Line delay={20} size={44}>{`So we built a weather forecast for it. What it costs now, what happens next, and proof we got it right. This is the wholesale price across Europe at ${asOf(X.text('state', (b) => b.at))}. Coupled markets often clear at one price.`}</Line>
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
            <Title size={88}>Prices swing hard.</Title>
            <LineChart width={1300} height={420} series={gbpSeries()} unit="GB day-ahead price through 26 October, £ per MWh (solid line: what happened)" draw={70} />
            <Caption>{`In one day, Great Britain went from ${fmt.gbp(low.v)} to ${fmt.gbp(high.v)} per megawatt-hour.`}</Caption>
          </>
        ),
      },
      {
        seconds: 6.5, kicker: 'The problem', sources: [bill], render: () => (
          <>
            <Title size={88}>Wind gets paid to switch off.</Title>
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
            <Title size={88}>Clean at home, dirty by cable.</Title>
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
  const miss = missed()
  return (
    <Beats beats={[
      {
        seconds: 9, kicker: 'What we built', sources: [z, l], render: () => (
          <>
            <Title size={88}>The grid, made visible.</Title>
            <div style={{ display: 'flex', gap: 60, alignItems: 'center', marginTop: 20 }}>
              <div style={{ flex: 1 }}>
                {['Prices in every country, on one fixed scale', 'Power flowing along the cables between them', 'Wind that was paid to switch off', 'Carbon, counting what each country imports'].map((t, i) => (
                  <Rise key={t} delay={10 + i * 14}><div style={{ fontSize: 40, color: COLORS.soft, marginTop: 22 }}>{t}</div></Rise>
                ))}
                <Row gap={80}>
                  <Big fig={z} format={(v) => fmt.n(v)} label="Zones" delay={70} size={90} />
                  <Big fig={l} format={(v) => fmt.n(v)} label="Cables drawn" delay={78} size={90} />
                </Row>
              </div>
              <EuropeMap prices={X.zonePriceList()} width={640} height={660} dim />
            </div>
          </>
        ),
      },
      {
        seconds: 11, kicker: 'What we built', sources: [X.stormHigh()], render: () => (
          <>
            <Title size={76}>The outlook, made before the day, with its odds.</Title>
            <LineChart width={1300} height={340} series={gbpSeries()} unit="26 Oct: actual (solid), forecast (dashed), odds band (8 in 10). Red rings: outside it" draw={90} marks />
            <Caption>{`The range missed ${miss.n} of ${miss.of} hours${miss.high === miss.n ? ', every time with the price above it' : ''}, including the ${fmt.gbp(miss.peak.y)} peak. We show it.`}</Caption>
          </>
        ),
      },
    ]} />
  )
}

// 4. The product, from real screenshots of the app (65 s, five segments of 13 s, one number each)
const Segment: React.FC<{ scene: string; title: string; lines: string[]; clip: string; badge: React.ReactNode }> = ({ scene, title, lines, clip, badge }) => (
  <div>
    <ShotFull scene={scene} />
    <div style={{ position: 'relative' }}>
      <Title size={80}>{title}</Title>
    </div>
    <div style={{ position: 'absolute', left: 120, right: 120, bottom: 90, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 60 }}>
      <div style={{ maxWidth: 1000 }}>
        {lines.map((t, i) => <Rise key={t} delay={14 + i * 12}><div style={{ fontSize: 36, color: COLORS.text, marginTop: 12, lineHeight: 1.3, textShadow: '0 2px 12px #000' }}>{t}</div></Rise>)}
      </div>
      <div style={{ flex: 'none' }}>{badge}</div>
    </div>
  </div>
)
const Badge: React.FC<{ fig: Fig; format: (v: number | null) => string; label: string }> = ({ fig, format, label }) => <Big fig={fig} format={format} label={label} size={120} />

export const Product: React.FC = () => {
  const cost = X.hormuzCost(), lo = X.hormuzCostLow(), hi = X.hormuzCostHigh()
  const hw = X.householdWindows()
  const dcg = X.dcGpus(), flex = X.dcFlexPct()
  const bill = F.stormConstraintGbp()
  const sentence = X.hormuzSentence()
  const gap = X.dirtiestImportGap()
  const peak = X.stormHigh()
  const first = hw[0]
  return (
    <Beats beats={[
      {
        seconds: 13.6, kicker: 'The product · Hidden grid', sources: [bill, gap.used], render: () => (
          <Segment scene="hidden" title="See the hidden grid" clip="hidden" lines={['Wind paid to switch off, and the bill.', 'Carbon that arrives by cable.']}
            badge={<Badge fig={bill} format={(v) => fmt.bigGbp(v)} label="Constraint bill, 26 Oct" />} />
        ),
      },
      {
        seconds: 13.6, kicker: 'The product · What if', sources: [cost, lo, hi], render: () => (
          <Segment scene="hormuz" title="Close the Strait of Hormuz" clip="hormuz" lines={[sentence ?? 'Gas goes up; so does power.', `Odds: 8 in 10 between ${fmt.bigGbp2(lo.v)} and ${fmt.bigGbp2(hi.v)}.`]}
            badge={<Badge fig={cost} format={(v) => fmt.bigGbp2(v)} label="Extra cost to consumers" />} />
        ),
      },
      {
        seconds: 13.6, kicker: 'The product · History', sources: [peak], render: () => (
          <Segment scene="history" title="Replay 26 October" clip="history" lines={['The map plays the day.', 'The forecasts come from a model that had not seen it.']}
            badge={<Badge fig={peak} format={(v) => fmt.gbp(v)} label="GB peak, per MWh" />} />
        ),
      },
      {
        seconds: 13.6, kicker: 'The product · Tonight', sources: [], render: () => (
          <Segment scene="tonight" title="Cheapest hours tonight" clip="tonight" lines={first ? [`${first.label}: ${first.start} to ${first.end}.`, 'Wholesale price, before network costs and charges.'] : ['The cheapest hours for your car and dishwasher.']}
            badge={first ? <div style={{ fontSize: 56, fontWeight: 500 }}>{`${first.start} to ${first.end}`}</div> : null} />
        ),
      },
      {
        seconds: 13.6, kicker: 'The product · Data centres', sources: [dcg, flex], render: () => (
          <Segment scene="datacentre" title="Where to put a data centre" clip="datacentre" lines={[`A ${fmt.n(dcg.v)}-GPU site.`, 'Energy cost and carbon by country. Estimates, not quotes.']}
            badge={<Badge fig={flex} format={(v) => `${fmt.n(v)}%`} label="of the work can move within the day" />} />
        ),
      },
    ]} />
  )
}

// 5. Proof (34 s): one honest slide, then the frozen forecast
export const Proof: React.FC = () => {
  const m = F.maeModel(), pr = F.maePersistence(), imp = F.maeImprovementPct(), cov = F.coverage(), n = F.forecastsScored(), hrs = X.backtestHours()
  const share = F.batteryShare()
  const wp = F.weatherPriceCutPct(), ww = F.weatherWindCutPct(), six = F.six()
  const rev = X.revealGb(), c = X.latestCommit(), cc = X.commitmentCount()
  return (
    <Beats beats={[
      {
        seconds: 22, kicker: 'Proof', sources: [m, pr, imp, hrs, cov, n, share, wp, ww, ...(six ? [six.items[0].fig] : [])], render: () => (
          <>
            <Title size={76}>Scored in public. It wins, and it ties.</Title>
            <div style={{ display: 'flex', gap: 50, alignItems: 'flex-start' }}>
              <div>
                <Bars compact width={860} format={(v) => fmt.n(v, 1)} items={six ? six.items.map((i) => ({ label: i.label, fig: i.fig, strong: i.key === 'lgbm_q' })) : [{ label: 'Our model', fig: m, strong: true }, { label: 'Stays put', fig: pr }]} />
                <div style={{ fontSize: 28, color: COLORS.text3, marginTop: 8 }}>{`Error per MWh, pooled £ and €, ${fmt.n(hrs.v)} hours`}</div>
              </div>
              <Line delay={20} size={30} color={COLORS.text2}>{six ? `Six ways to forecast, tested on the same ${fmt.n(six.weeks)} weeks: ours has the ${six.lowest ? 'lowest' : 'a higher'} error (${fmt.n(m.v, 1)} per MWh vs ${fmt.n(pr.v, 1)} for persistence) and the ${six.calibrated ? 'best-calibrated' : 'a less well calibrated'} range (${fmt.pct(cov.v, 1)} inside its ${X.coverageTarget}% band); significantly better than persistence in ${six.sig} of ${six.zones} zones.` : `${fmt.pct(imp.v)} smaller error than assuming the price stays put.`}</Line>
            </div>
            <Row gap={90}>
              <Big fig={cov} format={(v) => fmt.pct(v, 1)} label={`Outcomes inside our forecast band. Aim: ${X.coverageTarget}% (8 in 10)`} delay={40} size={100} />
              <Big fig={n} format={(v) => fmt.n(v)} label="Scored live, logged first" delay={52} size={100} />
              <Big fig={share} format={(v) => fmt.pct(v)} label={`Battery vs perfect foresight (5 zones, ${fmt.n(F.batteryHours())} h)`} delay={64} size={100} />
            </Row>
            <Line delay={80} size={30} color={COLORS.text2}>{`Not live yet: gusts, cloud, rain and alert weather cut day-ahead price error ${fmt.n(wp.v, 1)}% and wind error ${fmt.n(ww.v, 1)}% (${F.weatherFolds() ?? '–'}-fold backtest, ${F.weatherWindow() ?? '–'}; price better in ${F.weatherPriceZones() ?? '–'} zones; narrower ranges).`}</Line>
            <Caption delay={90}>Against a strong day-ahead rival it is a tie. We say so.</Caption>
          </>
        ),
      },
      {
        seconds: 12, kicker: 'Proof', sources: [X.commitmentCount(), X.revealSrc()], render: () => (
          <>
            <Title size={72}>Monday’s forecast, frozen before the result.</Title>
            <div style={{ display: 'flex', gap: 50, alignItems: 'center' }}>
              <LineChart width={900} height={330} series={rev.map((p: any) => ({ x: p.hour, y: p.actual as number, lo: p.p10, hi: p.p90, mid: p.p50 }))} unit={`GB forecast for ${X.deliveryDate() ?? '–'} (dashed), odds band`} draw={60} />
              <div style={{ fontFamily: MONO, fontSize: 28, color: COLORS.text2, lineHeight: 1.6 }}>
                <div>{`Frozen: ${asOf(X.frozenAt())}`}</div>
                <div>{`Public commitments: ${fmt.n(cc.v)}`}</div>
                <div>{c ? `Latest hash: ${c.sha.slice(0, 10)}…` : ''}</div>
              </div>
            </div>
            <Caption>It is fingerprinted on a public chain, so anyone can check we did not change it, then compared with the real auction result.</Caption>
          </>
        ),
      },
    ]} />
  )
}

// 6. How we built it (8 s)
export const How: React.FC = () => {
  const t = F.hubMerged(), a = F.hubAgents()
  return (
    <Beats beats={[{
      seconds: 5, kicker: 'How we built it', sources: [t, a], render: () => (
        <>
          <Title size={88}>Three people and a lot of Claudes.</Title>
          <Row gap={120}>
            <Big fig={t} format={(v) => fmt.n(v)} label="Tasks merged through one queue" delay={0} size={140} />
            <Big fig={a} format={(v) => fmt.n(v)} label="Agents that merged them" delay={10} size={140} />
          </Row>
        </>
      ),
    }]} />
  )
}

// 7. Close (18 s): the play invitation and the QR
export const Close: React.FC = () => {
  const m = F.maeModel()
  return (
    <Beats beats={[{
      seconds: 18, kicker: 'Check it yourself', sources: [m], render: () => (
        <div style={{ display: 'flex', gap: 80, alignItems: 'center', marginTop: 20 }}>
          <div style={{ flex: 1 }}>
            <Title size={92}>Your daily weather report for power</Title>
            <Line delay={14} size={40}>{`What it costs now, what happens next, and proof we got it right. Can you beat our forecast? Call the grid on a real day with its date hidden. Our average error to beat: ${fmt.n(m.v, 1)} per MWh, six zones, pooled £ and €.`}</Line>
            <Line delay={28} size={40} color={COLORS.text}>{QR_URL.replace('https://', '')}</Line>
            <div style={{ fontFamily: FONT, color: COLORS.text3, fontSize: 28, marginTop: 36 }}>{`${wallet ? `Frozen forecasts are hashed on Solana (${wallet.slice(0, 6)}…${wallet.slice(-4)}). ` : ''}Built at HackTheBurgh XIII. Public data only.`}</div>
          </div>
          <Rise delay={8}><QR size={420} /></Rise>
        </div>
      ),
    }]} />
  )
}
