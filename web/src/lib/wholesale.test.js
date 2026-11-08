// node --test web/src/lib/wholesale.test.js   (Node's built-in runner; no extra dependency)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fmtPence, pencePerKwh } from './wholesale.js'

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`)

test('£ per MWh to pence per kWh divides by 10', () => {
  close(pencePerKwh(38.33), 3.833)
  assert.equal(pencePerKwh(100), 10)
  assert.equal(pencePerKwh(0), 0)
  assert.equal(pencePerKwh(-12), -1.2)
})

test('formats pence: one decimal below 10p, whole pence above, no sign', () => {
  assert.equal(fmtPence(38.33), '3.8p')
  assert.equal(fmtPence(4), '0.4p')
  assert.equal(fmtPence(150), '15p')
  assert.equal(fmtPence(-38.33), '3.8p')
})
