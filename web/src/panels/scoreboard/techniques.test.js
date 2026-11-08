// node --test web/src/panels/scoreboard/techniques.test.js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { headline, significance, techniqueSummary } from './techniques.js'

const m = (name, mae, cov, ours = false) => ({ name, title: name, mae, coverage_p10_p90: cov, ours })
const base = { zones: 6, hours: 100, folds: 12, test_days: 7, dm: [{ baseline: 'persistence', better: 5, zones: 6, max_p: 2e-4, not_significant: ['NO2'] }],
  models: [m('a', 30, 0.79, true), m('b', 33, 0.7), m('c', 50, null)] }

test('headline claims only what the numbers show', () => {
  const s = techniqueSummary(base)
  assert.equal(s.weeks, 12)
  assert.equal(headline(s), 'Three ways to forecast, tested on the same 12 weeks: ours has the lowest error and the best-calibrated range')
  const worseRange = techniqueSummary({ ...base, models: [m('a', 30, 0.6, true), m('b', 33, 0.8)] })
  assert.equal(headline(worseRange), 'Two ways to forecast, tested on the same 12 weeks: ours has the lowest error')
  const notBest = techniqueSummary({ ...base, models: [m('b', 29, 0.8), m('a', 30, 0.8, true)] })
  assert.match(headline(notBest), /not the lowest error/)
})

test('significance picks the tightest honest bound', () => {
  assert.equal(significance(2e-4), 0.001)
  assert.equal(significance(0.004), 0.01)
  assert.equal(significance(0.2), null)
  assert.equal(techniqueSummary({ models: [m('a', 1, 0.8, true)] }), null)
})
