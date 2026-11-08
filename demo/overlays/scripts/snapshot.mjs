// Fetches the figures the Callout overlays show from the live API into data/numbers.json, with the time of each
// fetch. Read-only (GET only). The overlays read nothing else, so no number is typed by hand. Usage:
//   node scripts/snapshot.mjs [--api https://htb.stefvuck.dev/api]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../data/numbers.json')
const argi = process.argv.indexOf('--api')
const API = (argi > 0 ? process.argv[argi + 1] : process.env.LG_API ?? 'https://htb.stefvuck.dev/api').replace(/\/$/, '')

const ENDPOINTS = { scores: '/scores', scenarios: '/scenarios', replay: '/replay?event=2026-10-26' }

async function get(path) {
  const url = `${API}${path}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
    const text = await res.text()
    if (!res.ok) return { url, status: res.status, fetched_at: new Date().toISOString(), error: text.slice(0, 200) }
    return { url, status: res.status, fetched_at: new Date().toISOString(), body: JSON.parse(text) }
  } catch (e) {
    return { url, status: 0, fetched_at: new Date().toISOString(), error: String(e.message ?? e).slice(0, 200) }
  }
}

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const pick = (f) => { try { return f() } catch { return null } }

const raw = {}
for (const [name, path] of Object.entries(ENDPOINTS)) {
  raw[name] = await get(path)
  console.log(`${raw[name].error ? 'FAIL' : 'ok  '} ${name.padEnd(10)} ${path}`)
}
const scores = raw.scores.body
const head = scores?.headline
const hormuz = pick(() => raw.scenarios.body.scenarios.find((s) => s.key === 'hormuz' || s.result?.request?.type === 'hormuz').result)
const src = (name) => ({ source: raw[name].url.replace(API, '/api'), fetched_at: raw[name].fetched_at })

// Each value is a number or null. A null renders the label without a number.
const values = {
  'constraint-bill': { value: num(raw.replay.body?.constraint_cost_gbp), unit: 'gbp', ...src('replay') },
  hormuz: {
    value: num(hormuz?.cost_total_gbp?.p50),
    p10: num(hormuz?.cost_total_gbp?.p10),
    p90: num(hormuz?.cost_total_gbp?.p90),
    gas_pct: num(hormuz?.applied_magnitude),
    days: num(hormuz?.applied_hours) == null ? null : hormuz.applied_hours / 24,
    unit: 'gbp',
    ...src('scenarios'),
  },
  'less-wrong': {
    value: num(head?.mae_model) != null && num(head?.mae_persistence) ? (1 - head.mae_model / head.mae_persistence) * 100 : null,
    unit: 'pct',
    basis: head?.basis ?? null,
    ...src('scores'),
  },
  'in-range': { value: num(head?.coverage_p10_p90) == null ? null : head.coverage_p10_p90 * 100, unit: 'pct', basis: head?.basis ?? null, ...src('scores') },
  battery: {
    value: num(head?.battery_share_of_perfect) == null ? null : head.battery_share_of_perfect * 100,
    zones: num(Number(/over (\d+) zones/.exec(head?.battery_note ?? '')?.[1])),
    hours: num(head?.battery_hours),
    unit: 'pct',
    ...src('scores'),
  },
  scored: { value: num(head?.forecasts_scored), since: head?.since ?? null, unit: 'count', ...src('scores') },
}

const failed = Object.entries(raw).filter(([, v]) => v.error).map(([k, v]) => `${k} (${v.status || 'no answer'})`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ fetched_at: new Date().toISOString(), api: API, values }, null, 2) + '\n')
console.log(`wrote ${out}${failed.length ? `\nMISSING: ${failed.join(', ')}` : ''}`)
for (const [k, v] of Object.entries(values)) console.log(`  ${k.padEnd(16)} ${v.value == null ? 'missing' : v.value}`)
process.exit(failed.length ? 1 : 0)
