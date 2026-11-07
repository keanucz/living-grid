// Pure model behind the live day chart: which series exist, the revealed points, and each bot's fan at the question hours.
// Everything comes from public rows: market_feed (hours already played), questions, and market_bot_p notes, whose text is
// "median €109, 80% range €55 to €164" (written by engine.market.questions).
const TARGET_NAMES = { price_da: 'day-ahead price', gb_system_price: 'system price' }

export function seriesOfQuestion(q) {
  const m = String(q.id).split('|').pop().match(/^(.+?)-(price_da|gb_system_price)-\d+$/)
  return m ? `${m[1]} ${TARGET_NAMES[m[2]]}` : null
}

export function parseNote(note) {
  const m = String(note ?? '').match(/median\s*[^\d\-]*(-?[\d.,]+).*?range\s*[^\d\-]*(-?[\d.,]+)\s*to\s*[^\d\-]*(-?[\d.,]+)/)
  if (!m) return null
  const [p50, p10, p90] = [m[1], m[2], m[3]].map((x) => Number(x.replace(/,/g, '')))
  return [p50, p10, p90].every(Number.isFinite) ? { p10, p50, p90 } : null
}

// Series that have at least one price question or revealed hour, price series first.
export function seriesList(feed, questions) {
  const labels = new Set(questions.map(seriesOfQuestion).filter(Boolean))
  for (const f of feed) if (/price/.test(f.label)) labels.add(f.label)
  return [...labels].sort()
}

export function chartModel({ feed, questions, botP, series, clock, startHour, endHour }) {
  const points = feed.filter((f) => f.label === series && f.hour < clock).sort((a, b) => a.hour - b.hour).map((f) => ({ hour: f.hour, value: f.value }))
  const marks = []
  for (const q of questions) {
    if (seriesOfQuestion(q) !== series) continue
    const fans = []
    for (const [bot, v] of Object.entries(botP?.[q.id] ?? {})) {
      const band = parseNote(v.note)
      if (band) fans.push({ bot, ...band })
    }
    marks.push({ id: q.id, hour: q.targetHour, threshold: q.threshold, status: q.status, outcome: q.outcome, fans })
  }
  const ys = [...points.map((p) => p.value), ...marks.flatMap((m) => [m.threshold, ...m.fans.flatMap((f) => [f.p10, f.p90])])].filter(Number.isFinite)
  const lo = ys.length ? Math.min(...ys) : 0
  const hi = ys.length ? Math.max(...ys) : 1
  const pad = (hi - lo || 1) * 0.08
  return { points, marks, x: [startHour, Math.max(endHour, startHour + 1)], y: [lo - pad, hi + pad], unit: feed.find((f) => f.label === series)?.unit ?? '' }
}
