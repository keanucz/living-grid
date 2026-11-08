import React from 'react'
import { interpolate, useCurrentFrame } from 'remotion'
import { F, fmt, wallet } from '../data'
import type { Fig } from '../data'
import { COLORS, FONT, MONO } from '../theme'
import { Bars, Big, Line, LineChart, Row, Title } from '../components/Parts'
import { Beats, Caption, EuropeMap, QR, QR_URL, Rise, ShotFull } from '../components/Extra'
import * as X from '../figs'

// The deck, about two minutes. Every number comes from the snapshot (src/data.ts and src/figs.ts). One idea per slide, a
// question as the title, two or three short lines, one picture. The 26 October reasons (demand and wind share at 01:00 and
// 17:00) come from /state for those hours and are said in words, not typed as figures.

export const CLIPS: Record<string, string | null> = { hidden: 'ghostwind', hormuz: 'hormuz', history: 'history', tonight: null, datacentre: null }

const gbpSeries = () => X.replaySeries('GB', 'price_da').map((p) => ({ x: p.hour, y: p.actual as number, lo: p.p10, hi: p.p90, mid: p.p50 }))
const asOf = (iso: string | null) => (iso ? `${iso.slice(11, 16)} UTC` : '–')

const fade = (frame: number, delay: number) => interpolate(frame, [delay, delay + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

/** A big card: a label on top, a large value, then one or two plain sentences. */
const Card: React.FC<{ top: string; value: string; children: React.ReactNode; delay: number; tone?: 'low' | 'high' }> = ({ top, value, children, delay, tone }) => {
  const frame = useCurrentFrame()
  const accent = tone === 'low' ? '#4fa36a' : tone === 'high' ? '#e0663a' : COLORS.text
  return (
    <div style={{ flex: 1, opacity: fade(frame, delay), transform: `translateY(${(1 - fade(frame, delay)) * 20}px)`, background: COLORS.panel, border: `1px solid ${COLORS.line2}`, borderRadius: 24, padding: '36px 40px' }}>
      <div style={{ fontFamily: MONO, fontSize: 30, color: COLORS.text2, letterSpacing: '0.04em' }}>{top}</div>
      <div style={{ fontSize: 132, fontWeight: 500, letterSpacing: '-0.04em', color: accent, lineHeight: 1.05, marginTop: 8 }}>{value}</div>
      <div style={{ fontSize: 38, lineHeight: 1.35, color: COLORS.text, marginTop: 18 }}>{children}</div>
    </div>
  )
}

/** Scotland, the full line south, England: three boxes and two arrows that build in turn. */
const LineSouth: React.FC = () => {
  const frame = useCurrentFrame()
  const box = (label: string, sub: string, d: number, colour: string) => (
    <div style={{ opacity: fade(frame, d), width: 380, background: COLORS.panel, border: `2px solid ${colour}`, borderRadius: 22, padding: '28px 30px' }}>
      <div style={{ fontSize: 46, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 32, color: COLORS.text2, marginTop: 8 }}>{sub}</div>
    </div>
  )
  const arrow = (d: number, text: string) => (
    <div style={{ opacity: fade(frame, d), textAlign: 'center', width: 230 }}>
      <div style={{ fontSize: 76, color: COLORS.text3, lineHeight: 1 }}>→</div>
      <div style={{ fontFamily: MONO, fontSize: 26, color: '#e0663a', marginTop: 6 }}>{text}</div>
    </div>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 50 }}>
      {box('Scotland', 'Too much wind', 6, '#4fa36a')}
      {arrow(16, 'line full')}
      {box('England', 'Needs the power', 26, '#e0663a')}
    </div>
  )
}

// 1. Hook (10 s)
export const Hook: React.FC = () => {
  const frame = useCurrentFrame()
  const reveal = interpolate(frame, [20, 100], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <Beats beats={[{
      seconds: 10, kicker: 'The Living Grid', sources: [X.stateSrc()], render: () => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 40, marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <Title size={150}>Electricity is invisible.</Title>
            <Line delay={20} size={50} color={COLORS.text}>So we built a daily weather report for it.</Line>
            <Line delay={34} size={40}>What power costs now, what happens next, and proof we got it right.</Line>
          </div>
          <EuropeMap prices={X.zonePriceList()} reveal={reveal} width={760} height={780} />
        </div>
      ),
    }]} />
  )
}

// 2. Why prices move (26 s): one day's swing, then wind paid to stop
export const Problem: React.FC = () => {
  const low = X.stormLow(), high = X.stormHigh(), bill = F.stormConstraintGbp()
  return (
    <Beats beats={[
      {
        seconds: 13, kicker: 'A case study · 26 October 2026', sources: [low, high], render: () => (
          <>
            <Title size={84}>{`One strange day: why did power cost ${fmt.gbp(low.v)}, then ${fmt.gbp(high.v)}?`}</Title>
            <Line delay={8} size={36}>On 26 October a storm hit Britain. Here is what happened to the price that day.</Line>
            <div style={{ display: 'flex', gap: 40, marginTop: 36 }}>
              <Card top="1AM" value={fmt.gbp(low.v)} delay={14} tone="low">Most of us were asleep, and the storm’s wind made most of Britain’s power. So it was nearly free.</Card>
              <Card top="5PM" value={fmt.gbp(high.v)} delay={40} tone="high">Everyone was home, using half as much again. Wind couldn’t cover it, so gas plants switched on, and gas sets the price.</Card>
            </div>
            <div style={{ fontSize: 28, color: COLORS.text3, marginTop: 24 }}>Price per megawatt-hour, Britain’s day-ahead auction.</div>
          </>
        ),
      },
      {
        seconds: 13, kicker: 'A case study · 26 October 2026', sources: [bill], render: () => (
          <>
            <Title size={92}>Why are wind farms paid to stop?</Title>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 80 }}>
              <div>
                <LineSouth />
                <Line delay={40} size={40} color={COLORS.text}>So wind farms in Scotland are paid to switch off, and gas plants in England are paid to switch on.</Line>
                <Line delay={56} size={40}>The price of that is in all our electricity bills.</Line>
              </div>
              <div style={{ marginTop: 70 }}><Big fig={bill} format={(v) => fmt.bigGbp(v)} label="on 26 October alone" delay={66} size={150} /></div>
            </div>
          </>
        ),
      },
    ]} />
  )
}

// 3. The forecast (11 s): the same day, forecast before it happened
export const Built: React.FC = () => (
  <Beats beats={[{
    seconds: 11, kicker: 'Our forecast', sources: [X.stormHigh()], render: () => (
      <>
        <Title size={92}>Could we have seen it coming?</Title>
        <Line delay={10} size={40}>Our model forecast 26 October without seeing any of it. The grey band is where we expected the price.</Line>
        <LineChart width={1300} height={360} series={gbpSeries()} unit="Britain, £ per MWh. White: what happened. Dashed: our best guess. Red rings: outside the band." draw={80} marks />
        <Caption delay={70}>It got the quiet night right. It missed the evening peak, every time too low.</Caption>
      </>
    ),
  }]} />
)

// 4. The product (27 s): three real screens, one question and one answer each
const Segment: React.FC<{ scene: string; title: string; answer: string; badge?: React.ReactNode }> = ({ scene, title, answer, badge }) => {
  const frame = useCurrentFrame()
  return (
    <div>
      <ShotFull scene={scene} />
      <div style={{ position: 'relative' }}><Title size={86}>{title}</Title></div>
      <div style={{ position: 'absolute', left: 120, right: 120, bottom: 90, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 60, opacity: fade(frame, 16) }}>
        <div style={{ maxWidth: 1050, background: 'rgba(10,10,10,0.82)', borderRadius: 20, padding: '22px 30px', fontSize: 44, lineHeight: 1.3 }}>{answer}</div>
        {badge && <div style={{ flex: 'none', background: 'rgba(10,10,10,0.82)', borderRadius: 20, padding: '22px 30px' }}>{badge}</div>}
      </div>
    </div>
  )
}

export const Product: React.FC = () => {
  const cost = X.hormuzCost()
  const first = X.householdWindows()[0]
  return (
    <Beats beats={[
      {
        seconds: 9, kicker: 'The app · Hidden grid', sources: [], render: () => (
          <Segment scene="hidden" title="What’s hidden on the grid?" answer="Wind paid to stop, carbon arriving by cable, and power lines that are full." />
        ),
      },
      {
        seconds: 9, kicker: 'The app · What if', sources: [cost], render: () => (
          <Segment scene="hormuz" title="What if the Strait of Hormuz closed for two weeks?" answer="Gas would cost 40% more, and Europe would pay this much more for electricity."
            badge={<Big fig={cost} format={(v) => fmt.bigGbp(v)} label="extra, modelled" size={120} />} />
        ),
      },
      {
        seconds: 9, kicker: 'The app · Tonight', sources: [], render: () => (
          <Segment scene="tonight" title="When is power cheapest tonight?" answer={first ? `Charge your car between ${first.start} and ${first.end}.` : 'The cheapest hours for your car and dishwasher.'} />
        ),
      },
    ]} />
  )
}

// 5. Proof (27 s): is it any good, then Monday's sealed forecast meeting the real auction
export const Proof: React.FC = () => {
  const six = F.six()
  const ours = six?.items.find((i) => i.key === 'lgbm_q'), stay = six?.items.find((i) => i.key === 'persistence')
  const at = ours?.fig.at ?? ''
  const imp: Fig = { v: ours?.fig.v != null && stay?.fig.v ? (1 - ours.fig.v / stay.fig.v) * 100 : null, unit: '%', src: 'backtest files', at }
  const cov: Fig = { v: ours?.cov != null ? ours.cov * 100 : null, unit: '%', src: 'backtest files', at }
  const live = F.coverage(), liveImp = F.maeImprovementPct()
  const share = F.batteryShare()
  const rev = X.revealGb()
  return (
    <Beats beats={[
      {
        seconds: 16, kicker: 'Proof', sources: [imp, cov, share, live], render: () => (
          <>
            <Title size={92}>Is it any good?</Title>
            <Row gap={90}>
              <Big fig={imp} format={(v) => fmt.pct(v)} label="less wrong than guessing the price stays put" delay={10} size={130} />
              <Big fig={cov} format={(v) => fmt.pct(v, 1)} label={`of real prices landed in our range (we aim for ${X.coverageTarget}%)`} delay={24} size={130} />
              <Big fig={share} format={(v) => fmt.pct(v)} label="of a perfect battery’s profit, trading on our forecast" delay={38} size={130} />
            </Row>
            {six && (
              <Rise delay={56}>
                <div style={{ marginTop: 50 }}>
                  <Bars compact width={1100} format={(v) => fmt.n(v, 1)} items={six.items.map((i) => ({ label: i.label, fig: i.fig, strong: i.key === 'lgbm_q' }))} />
                  <div style={{ fontSize: 28, color: COLORS.text3, marginTop: 8 }}>Average miss per MWh, six ways to forecast, the same 12 weeks.</div>
                </div>
              </Rise>
            )}
            <Caption delay={80}>{`Over 12 weeks of backtest. Live since Saturday: ${fmt.pct(liveImp.v)} less wrong, but only ${fmt.pct(live.v)} inside the range. Our live ranges are too narrow so far.`}</Caption>
          </>
        ),
      },
      {
        seconds: 11, kicker: 'Proof', sources: [X.commitmentCount(), X.revealSrc()], render: () => (
          <>
            <Title size={84}>Monday’s forecast, sealed before the auction</Title>
            <Line delay={10} size={40}>{`Frozen at ${asOf(X.frozenAt())} and fingerprinted on Solana, so anyone can check we didn’t change it.`}</Line>
            <LineChart width={1300} height={330} series={rev.map((p: any) => ({ x: p.hour, y: p.actual as number, lo: p.p10, hi: p.p90, mid: p.p50 }))} unit={`Britain, ${X.deliveryDate() ?? '–'}, £ per MWh. Band: our frozen range. White: the real auction result.`} draw={60} marks />
            <Caption delay={60}>{X.text('reveal', (b) => { const g = b.zones.find((z: any) => z.zone === 'GB'); return g?.mae != null && g?.baseline_mae != null ? `Our average miss: £${g.mae.toFixed(1)}. Repeating Sunday’s prices: £${g.baseline_mae.toFixed(1)}. Most hours still landed above our range.` : 'The other countries’ results arrive around midday.' }) ?? ''}</Caption>
          </>
        ),
      },
    ]} />
  )
}

// 6. How we built it (5 s)
export const How: React.FC = () => {
  const t = F.hubMerged(), a = F.hubAgents()
  return (
    <Beats beats={[{
      seconds: 5, kicker: 'How we built it', sources: [t, a], render: () => (
        <>
          <Title size={92}>Three people and a lot of Claudes.</Title>
          <Row gap={120}>
            <Big fig={t} format={(v) => fmt.n(v)} label="tasks merged through one queue" delay={0} size={150} />
            <Big fig={a} format={(v) => fmt.n(v)} label="AI agents that merged them" delay={8} size={150} />
          </Row>
        </>
      ),
    }]} />
  )
}

// 7. Close (10 s)
export const Close: React.FC = () => (
  <Beats beats={[{
    seconds: 10, kicker: 'Try it', sources: [], render: () => (
      <div style={{ display: 'flex', gap: 80, alignItems: 'center', marginTop: 20 }}>
        <div style={{ flex: 1 }}>
          <Title size={100}>Your daily weather report for power</Title>
          <Line delay={12} size={48} color={COLORS.text}>Beat our forecast? Scan and play.</Line>
          <Line delay={22} size={44} color={COLORS.text}>{QR_URL.replace('https://', '')}</Line>
          <div style={{ fontFamily: FONT, color: COLORS.text3, fontSize: 28, marginTop: 36 }}>{`${wallet ? `Frozen forecasts are fingerprinted on Solana (${wallet.slice(0, 6)}…${wallet.slice(-4)}). ` : ''}Built at HackTheBurgh XIII from public data.`}</div>
        </div>
        <Rise delay={6}><QR size={440} /></Rise>
      </div>
    ),
  }]} />
)
