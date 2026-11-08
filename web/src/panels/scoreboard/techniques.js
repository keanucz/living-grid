// Pure helpers for the "six ways to forecast" block. Everything printed comes from /scores/techniques.
const EVEN = 0.8

export function significance(maxP) {
  if (maxP == null) return null
  return [0.001, 0.01, 0.05].find((b) => maxP < b) ?? null
}

export function techniqueSummary(t) {
  const models = t?.models ?? []
  if (models.length < 2) return null
  const ours = models.find((m) => m.ours)
  if (!ours) return null
  const covered = models.filter((m) => m.coverage_p10_p90 != null)
  const bestRange = covered.length ? covered.reduce((a, b) => (Math.abs(b.coverage_p10_p90 - EVEN) < Math.abs(a.coverage_p10_p90 - EVEN) ? b : a)) : null
  const lowestError = models[0].ours
  const bestCalibrated = bestRange?.ours ?? false
  const weeks = t.test_days ? Math.round((t.folds * t.test_days) / 7) : t.folds
  const dmP = (t.dm ?? []).find((d) => d.baseline === 'persistence') ?? null
  const dmY = (t.dm ?? []).find((d) => d.baseline === 'yesterday') ?? null
  const worst = Math.max(...models.map((m) => m.mae))
  return { models, ours, lowestError, bestCalibrated, weeks, dmP, dmY, worst, zones: t.zones, hours: t.hours }
}

export function headline(s) {
  const n = s.models.length
  const words = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']
  const count = n <= 8 ? words[n - 1] : String(n)
  const base = `${count === 'One' ? 'One way' : `${count} ways`} to forecast, tested on the same ${s.weeks} weeks`
  if (s.lowestError && s.bestCalibrated) return `${base}: ours has the lowest error and the best-calibrated range`
  if (s.lowestError) return `${base}: ours has the lowest error`
  return `${base}: ours is not the lowest error, and we say so`
}
