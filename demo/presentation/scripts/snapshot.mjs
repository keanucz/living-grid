// Pulls every figure the deck shows from the live API into data/snapshot.json, with the source URL and the time of
// each fetch, so no number in the deck is typed by hand. Read-only: it only issues GET requests (never /intervene,
// which publishes to the shared SpacetimeDB). Usage:
//   node scripts/snapshot.mjs [--api https://htb.stefvuck.dev/api]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../data/snapshot.json')
const argi = process.argv.indexOf('--api')
const API = (argi > 0 ? process.argv[argi + 1] : process.env.LG_API ?? 'https://htb.stefvuck.dev/api').replace(/\/$/, '')

// name -> path. Each name is what the scenes ask for in src/data.ts.
const ENDPOINTS = {
  zones: '/zones',
  state: '/state',
  scores: '/scores',
  replay: '/replay?event=2026-10-26',
  scenarios: '/scenarios', // pre-computed Hormuz, Norway link, French nuclear and Scottish storm results
  ghostWind: '/unseen/ghost-wind',
  carbon: '/unseen/carbon',
  carbonCosts: '/carbon/costs',
  infrastructure: '/infrastructure',
  renewables: '/impact/renewables?zone=GB',
  household: '/household',
  savings: '/household/savings?region=C',
  datacentre: '/datacentre',
  commitments: '/commitments',
  reveal: '/reveal',
}

async function get(name, path) {
  const url = `${API}${path}`
  const t0 = Date.now()
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
  const text = await res.text()
  const item = { url, status: res.status, fetched_at: new Date().toISOString(), ms: Date.now() - t0 }
  if (!res.ok) return { ...item, error: text.slice(0, 200) }
  return { ...item, body: JSON.parse(text) }
}

async function hubFacts() {
  // How the thing was built: counted from the hub's own database (read-only), when it is readable here.
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(process.env.LG_HUB_DB ?? '/srv/hack/hub.db', { readOnly: true })
    const merged = db.prepare("select count(*) n from tasks where status='merged'").get().n
    const agents = db.prepare("select count(distinct agent) n from tasks where status='merged' and agent is not null").get().n
    const span = db.prepare("select min(ts) a, max(ts) b from events where kind='merged'").get()
    return { source: 'hub.db (read-only)', fetched_at: new Date().toISOString(), merged_tasks: merged, agents, first_merge: span.a, last_merge: span.b }
  } catch (e) {
    return { source: 'hub.db', error: String(e.message ?? e).slice(0, 120) }
  }
}

const items = {}
const failed = []
for (const [name, path] of Object.entries(ENDPOINTS)) {
  try {
    items[name] = await get(name, path)
  } catch (e) {
    items[name] = { url: `${API}${path}`, status: 0, fetched_at: new Date().toISOString(), error: String(e.message ?? e).slice(0, 120) }
  }
  if (items[name].error) failed.push(`${name} (${items[name].status || 'no answer'})`)
  console.log(`${items[name].error ? 'FAIL' : 'ok  '} ${name.padEnd(15)} ${path}`)
}
const hub = await hubFacts()
const snapshot = { generated_at: new Date().toISOString(), api: API, items, hub }
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(snapshot))
console.log(`wrote ${out}${failed.length ? `\nMISSING: ${failed.join(', ')}` : ''}`)
process.exit(failed.length ? 1 : 0)
