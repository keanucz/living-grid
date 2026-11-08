// Pure helpers behind the scoreboard and backtest panels. Nothing here invents numbers: when live scoring has
// not produced outcomes yet, the walk-forward backtest figure is used and labelled as such.
const BASELINES = ['persistence', 'yesterday']
const isModel = (m) => !BASELINES.includes(m)

// Walk-forward rows -> one row per zone and target, n-weighted over folds, with ratios against both baselines.
export function backtestTable(rows = []) {
  const acc = new Map()
  for (const r of rows) {
    const key = `${r.zone}|${r.target}`
    const g = acc.get(key) ?? { zone: r.zone, target: r.target, mae: {}, n: {}, cov: 0, covN: 0 }
    const kind = isModel(r.model) ? 'model' : r.model
    g.mae[kind] = (g.mae[kind] ?? 0) + r.mae * r.n
    g.n[kind] = (g.n[kind] ?? 0) + r.n
    if (kind === 'model' && r.coverage_p10_p90 != null) {
      g.cov += r.coverage_p10_p90 * r.n
      g.covN += r.n
    }
    acc.set(key, g)
  }
  return [...acc.values()]
    .filter((g) => g.n.model && g.n.persistence)
    .map((g) => {
      const mae = (k) => (g.n[k] ? g.mae[k] / g.n[k] : null)
      const model = mae('model')
      const vsP = model / mae('persistence') - 1
      const y = mae('yesterday')
      const vsY = y != null ? model / y - 1 : null
      const losses = [vsP > 0 && 'persistence', vsY != null && vsY > 0 && 'yesterday'].filter(Boolean)
      return {
        zone: g.zone,
        target: g.target,
        model,
        persistence: mae('persistence'),
        yesterday: y,
        vsPersistence: vsP,
        vsYesterday: vsY,
        coverage: g.covN ? g.cov / g.covN : null,
        n: g.n.model,
        losses,
      }
    })
}

export function backtestSummary(table) {
  const wins = table.filter((r) => !r.losses.length).length
  const lossP = table.filter((r) => r.losses.includes('persistence')).length
  const lossY = table.filter((r) => r.losses.includes('yesterday')).length
  const covN = table.reduce((a, r) => a + (r.coverage != null ? r.n : 0), 0)
  const coverage = covN ? table.reduce((a, r) => a + (r.coverage ?? 0) * (r.coverage != null ? r.n : 0), 0) / covN : null
  const meanVs = table.length ? table.reduce((a, r) => a + r.vsPersistence, 0) / table.length : null
  return { total: table.length, wins, lossP, lossY, coverage, meanVsPersistence: meanVs }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function batteryShares(battery = [], headline = {}) {
  const by = (s) => mean(battery.filter((b) => b.strategy === s && b.share_of_perfect != null).map((b) => b.share_of_perfect))
  const risk = by('risk_aware')
  const median = by('median_only')
  const out = { risk, median }
  if (risk == null && median == null && headline?.battery_share_of_perfect != null && battery.length) out.risk = headline.battery_share_of_perfect
  out.present = out.risk != null || out.median != null
  return out
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// "Since Saturday" for the first scored forecast, in UTC to match storage; falls back to the date.
export function sinceLabel(since, now = new Date()) {
  const d = new Date(since)
  if (Number.isNaN(d.getTime())) return 'the start'
  const days = (now - d) / 864e5
  return days < 6 ? DAYS[d.getUTCDay()] : d.toISOString().slice(0, 10)
}

// The headline says where its figures come from (`basis`, engine #285): live scored forecasts, or the walk-forward
// backtest while too few are scored. The label follows that, never the bare count of forecasts scored.
export function headlineBasis(h = {}) {
  if (h.basis === 'live' || h.basis === 'backtest') return { basis: h.basis, n: h.basis_n ?? 0 }
  return { basis: (h.forecasts_scored ?? 0) > 0 ? 'live' : 'backtest', n: h.forecasts_scored ?? 0 } // older API
}

export function scoreboard(scores, now = new Date()) {
  const h = scores?.headline ?? {}
  const table = backtestTable(scores?.backtest)
  const bt = backtestSummary(table)
  const { basis, n } = headlineBasis(h)
  const label = basis === 'live' ? 'Live' : 'Backtest'
  const ratio = h.mae_persistence > 0 ? h.mae_model / h.mae_persistence - 1 : null
  const live = (h.forecasts_scored ?? 0) > 0
  return {
    live,
    basis,
    basisN: n,
    // Negative is better: how much smaller the model's error is than persistence's.
    error: ratio != null ? { value: ratio, source: label } : bt.meanVsPersistence != null ? { value: bt.meanVsPersistence, source: 'Backtest' } : null,
    coverage: h.coverage_p10_p90 > 0 ? { value: h.coverage_p10_p90, source: label } : bt.coverage != null ? { value: bt.coverage, source: 'Backtest' } : null,
    scored: h.forecasts_scored ?? 0,
    since: live ? sinceLabel(h.since, now) : null,
    battery: batteryShares(scores?.battery, h),
    backtest: bt,
  }
}

export const pct = (v, d = 0) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v * 100).toFixed(d)}%`
