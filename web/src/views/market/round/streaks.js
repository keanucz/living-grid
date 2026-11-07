// Streaks and badges, computed on the phone from public data: my positions, the settled questions and the bots' points.
// Nothing here is stored; reload and it is recomputed from the same rows.

export const net = (q, pos) => {
  if (!pos || q.status !== 'settled') return 0
  const win = q.outcome === 'yes' ? pos.yes : q.outcome === 'no' ? pos.no : 0
  return win - pos.spent
}

const stakes = (pos) => (pos ? pos.yes + pos.no : 0)

// Settled questions I traded, in the order they settled (by target hour).
export function played(questions, positions) {
  return questions
    .filter((q) => q.status === 'settled' && stakes(positions?.[q.id]) > 0)
    .sort((a, b) => a.targetHour - b.targetHour || a.id.localeCompare(b.id))
}

// { current, best, last }: consecutive profitable settled questions; a loss resets it, an untraded question skips.
export function streak(questions, positions) {
  let cur = 0
  let best = 0
  for (const q of played(questions, positions)) {
    cur = net(q, positions[q.id]) > 0 ? cur + 1 : 0
    best = Math.max(best, cur)
  }
  return { current: cur, best }
}

const sideHeld = (q, pos) => (pos.yes === pos.no ? null : pos.yes > pos.no ? 'yes' : 'no')

export const BADGES = [
  { id: 'spike', label: 'Called the spike', why: 'Held YES on a price that finished at least a quarter above the line.' },
  { id: 'engineer', label: 'Beat the Engineer', why: 'Finished the round with more points than The Engineer.' },
  { id: 'contrarian', label: 'Contrarian win', why: 'Won on the side the room gave less than 30%.' },
  { id: 'streak3', label: 'Hot streak', why: 'Three profitable questions in a row.' },
]

export function badges({ questions, positions, bots, points, roundDone }) {
  const out = new Map()
  const grant = (id, q) => out.has(id) || out.set(id, { ...BADGES.find((b) => b.id === id), question: q?.id ?? null })
  for (const q of played(questions, positions)) {
    const pos = positions[q.id]
    const side = sideHeld(q, pos)
    const won = net(q, pos) > 0
    if (won && side === 'yes' && q.outcome === 'yes' && q.threshold > 0 && q.actual >= q.threshold * 1.25 && q.kind === 'price') grant('spike', q)
    const roomOnMySide = side === 'yes' ? q.roomPClose : 1 - q.roomPClose
    if (won && side && q.roomPClose >= 0 && roomOnMySide < 0.3) grant('contrarian', q)
  }
  if (streak(questions, positions).best >= 3) grant('streak3')
  const engineer = bots?.find((b) => b.name === 'bot_engineer')
  if (roundDone && played(questions, positions).length > 0 && engineer?.points != null && points > engineer.points) grant('engineer')
  return [...out.values()]
}
