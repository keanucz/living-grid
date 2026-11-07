// Rehearsal data for #/screen?demo=1: a scripted round so the big screen can be checked without a live room.
// Labelled as a rehearsal on screen. ?phase=waiting|playing|reveal holds one phase.
const NAMES = ['Ada', 'Grace', 'Linus', 'Hedy', 'Alan', 'Katherine', 'Tim', 'Margaret', 'Edsger', 'Barbara', 'Ken', 'Frances']
const BOTS = [
  { name: 'bot_yesterday', title: 'Yesterday', method: 'Same hour yesterday, band from its own recent errors.', kelly: 0.15 },
  { name: 'bot_last_week', title: 'Last week', method: 'Same hour seven days ago, band from its own recent errors.', kelly: 0.1 },
  { name: 'bot_engineer', title: 'The Engineer', method: 'Merit order: price from residual load, shifted by gas and carbon costs.', kelly: 0.35 },
  { name: 'bot_committee', title: 'The Committee', method: 'Quantile regression averaging of the others, then conformal.', kelly: 0.5 },
  { name: 'our_model', title: 'Our model', method: 'LightGBM quantile regression on 18 features.', kelly: 0.5 },
  { name: 'nowcaster', title: 'The Nowcaster', method: 'Our model, corrected by the hours already played.', kelly: 0.35 },
]
const QUESTIONS = [
  { id: 'q1', text: 'Will the GB price top £95/MWh at 18:00?', targetHour: 18, outcome: 'yes', actual: 101.4, unit: '£/MWh' },
  { id: 'q2', text: 'Will GB wind beat 12 GW at 14:00?', targetHour: 14, outcome: 'no', actual: 9.8, unit: 'GW' },
  { id: 'q3', text: 'Will France be cheaper than Germany at 12:00?', targetHour: 12, outcome: 'yes', actual: 0, unit: '' },
  { id: 'q4', text: 'Will the GB price go negative before 06:00?', targetHour: 6, outcome: 'no', actual: 12.1, unit: '£/MWh' },
]
const START = 0
const END = 23
const WAIT_S = 12
const PLAY_S = 72
const REVEAL_S = 25
const rand = (seed) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}
const price = (h) => 62 + 30 * Math.exp(-((h - 18) ** 2) / 6) + 14 * Math.exp(-((h - 8) ** 2) / 4) - 10 * Math.exp(-((h - 3) ** 2) / 5)

export function demoPhase() {
  const m = /[?&]phase=(waiting|playing|reveal)/.exec(location.hash)
  return m ? m[1] : null
}

export function demoState(elapsed, held = demoPhase()) {
  const cycle = WAIT_S + PLAY_S + REVEAL_S
  let t = held === 'waiting' ? 8 : held === 'playing' ? WAIT_S + PLAY_S * 0.62 : held === 'reveal' ? WAIT_S + PLAY_S + 2 : elapsed % cycle
  const phase = t < WAIT_S ? 'waiting' : t < WAIT_S + PLAY_S ? 'playing' : 'reveal'
  const joined = phase === 'waiting' ? Math.min(NAMES.length, 2 + Math.floor(t / 1.1)) : NAMES.length
  const players = NAMES.slice(0, joined).map((name, i) => ({ id: name, name, avatar: '', ready: true, at: i }))
  const progress = phase === 'waiting' ? 0 : phase === 'playing' ? (t - WAIT_S) / PLAY_S : 1
  const clock = START + Math.floor(progress * (END - START + 1))
  const questions = QUESTIONS.map((q, i) => {
    const settled = clock > q.targetHour
    const drift = progress * (q.outcome === 'yes' ? 0.35 : -0.3)
    const priceYes = Math.min(0.97, Math.max(0.03, 0.5 + drift + 0.12 * Math.sin(t / 3 + i)))
    return {
      ...q,
      status: settled ? 'settled' : 'open',
      outcome: settled ? q.outcome : '',
      priceYes,
      roomPClose: priceYes,
      modelP: q.outcome === 'yes' ? 0.64 - 0.05 * i : 0.38 + 0.04 * i,
    }
  })
  const botP = {}
  QUESTIONS.forEach((q, i) => {
    const lean = q.outcome === 'yes' ? 0.55 : 0.45
    botP[q.id] = Object.fromEntries(BOTS.map((b, j) => [b.name, Math.min(0.95, Math.max(0.05, lean + (rand(i * 7 + j) - 0.5) * 0.5))]))
  })
  const nSettled = questions.filter((q) => q.status === 'settled').length
  const people = players.map((p, i) => ({ name: p.name, isModel: false, points: 1000 + progress * (rand(i) - 0.4) * 420 + 30 * Math.sin(t / 2 + i) * progress }))
  const botRows = BOTS.map((b, j) => ({ name: b.title, isModel: true, points: 1000 + progress * (rand(40 + j) - 0.35) * 300 }))
  const leaderboard = [...people, ...botRows].sort((a, b) => b.points - a.points).map((r, i) => ({ ...r, rank: i + 1 }))
  const bots = BOTS.map((b, j) => ({
    ...b,
    brier: nSettled ? 0.14 + rand(80 + j) * 0.12 : null,
    n: nSettled,
    points: botRows[j].points,
  }))
  const feed = []
  for (let h = START; h < clock; h++) {
    feed.push({ key: `${h}|p`, hour: h, label: 'GB day-ahead price', value: price(h), unit: 'GBP/MWh' })
    feed.push({ key: `${h}|w`, hour: h, label: 'GB wind switched off so far', value: h * 1.9, unit: 'GWh' })
  }
  const round =
    phase === 'waiting'
      ? null
      : {
          id: 1,
          status: phase === 'reveal' ? 'done' : 'running',
          title: 'Mystery day',
          dayRevealed: phase === 'reveal' ? '2026-10-26' : '',
          clockHour: Math.min(clock, END + 1),
          startHour: START,
          endHour: END,
          secondsPerHour: 3,
          b: 100,
          roomBrier: nSettled ? 0.168 : -1,
          modelBrier: nSettled ? 0.191 : -1,
          nSettled,
        }
  const stamp = Math.floor(t)
  const event =
    phase === 'playing' && rand(stamp) > 0.45
      ? { kind: 'trade', who: NAMES[Math.floor(rand(stamp + 3) * NAMES.length)], side: rand(stamp + 5) > 0.5 ? 'yes' : 'no', shares: [10, 25, 50, 100][Math.floor(rand(stamp + 9) * 4)], question: QUESTIONS[Math.floor(rand(stamp + 11) * 4)].text, stamp }
      : null
  return {
    status: 'live',
    demo: true,
    lobby: { code: 'GRID', state: phase === 'waiting' ? 'waiting' : phase === 'playing' ? 'playing' : 'reveal' },
    players,
    bots,
    botP,
    round,
    questions,
    feed,
    leaderboard,
    event,
  }
}

export const DEMO_REPLAY = { title: 'The 26 October storm' }
