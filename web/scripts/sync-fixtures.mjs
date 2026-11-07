// Single source of truth for offline data: engine/contract/fixtures/*.json (validated against the engine's
// schemas by `uv run python -m engine.contract.make_fixtures`).
//
//   node scripts/sync-fixtures.mjs           copy and derive, writing only files that changed
//   node scripts/sync-fixtures.mjs --check   write nothing; exit 1 if anything is out of date
//
// 1. Every contract fixture is copied byte for byte to src/fixtures/contract/.
// 2. zones.json, state.json and scenarios.json (the UI-shaped fixtures the API client falls back to) are
//    derived from those copies with the same normalisers the client applies to live responses, so the app
//    sees the same shape whether the API is up or down. They are generated: do not edit them by hand.
// assets.json is not part of the engine contract and stays hand-written.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normaliseScenarios, normaliseState, normaliseZones } from '../src/api/normalise.js'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '../../engine/contract/fixtures')
const OUT = join(here, '../src/fixtures')
const COPY = join(OUT, 'contract')
const check = process.argv.includes('--check')

const stale = []
const same = (path, data) => existsSync(path) && readFileSync(path).equals(data)

function put(path, data) {
  if (same(path, data)) return
  stale.push(path.replace(join(here, '..') + '/', ''))
  if (!check) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, data)
  }
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.json')).sort()
if (!files.length) {
  console.error(`sync-fixtures: no fixtures in ${SRC}`)
  process.exit(2)
}
for (const f of files) put(join(COPY, f), readFileSync(join(SRC, f)))

const raw = (name) => JSON.parse(readFileSync(join(SRC, `${name}.json`), 'utf8'))
const json = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`)
const zones = normaliseZones(raw('zones'))
put(join(OUT, 'zones.json'), json(zones))
put(join(OUT, 'state.json'), json(normaliseState(raw('state'), zones)))
put(join(OUT, 'scenarios.json'), json(normaliseScenarios(raw('scenarios'))))

if (check) {
  if (stale.length) {
    console.error(`sync-fixtures: out of date, run "node scripts/sync-fixtures.mjs":\n  ${stale.join('\n  ')}`)
    process.exit(1)
  }
  console.log('sync-fixtures: up to date')
} else {
  console.log(stale.length ? `sync-fixtures: wrote ${stale.length} file(s)\n  ${stale.join('\n  ')}` : 'sync-fixtures: already up to date')
}
