// Checks the tour content: every step names real ids, every token has a resolver, every live caption has a fallback,
// and each order runs for about three minutes. With --live it also prints every caption filled from the live API.
//   node web/scripts/check-tour.mjs [--live [https://htb.stefvuck.dev]]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'src')
const live = process.argv.includes('--live')
const base = process.argv[process.argv.indexOf('--live') + 1]?.startsWith('http') ? process.argv[process.argv.indexOf('--live') + 1] : 'https://htb.stefvuck.dev'

// sections.js imports the store; read its ids from the source instead of importing the browser code.
const sectionsSrc = readFileSync(join(src, 'shell/sections.js'), 'utf8')
const sections = [...sectionsSrc.matchAll(/\{ id: '(\w+)'(?:[^]*?)(?=\n  \{ id: '|\n\]\n)/g)].map((m) => {
  const body = m[0]
  const list = (k) => (body.match(new RegExp(`${k}: \\[([^\\]]*)\\]`)) ?? [, ''])[1].match(/'(\w+)'/g)?.map((x) => x.slice(1, -1)) ?? []
  return {
    id: m[1], panels: list('panels'), more: list('more'),
    paths: [...body.matchAll(/paths: \['([^']+)'\]/g)].map((x) => x[1]), href: (body.match(/href: '#([^']+)'/) ?? [])[1],
  }
})
const layerIds = readdirSync(join(src, 'layers'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
  const f = join(src, 'layers', d.name, 'index.js')
  return existsSync(f) ? (readFileSync(f, 'utf8').match(/^\s+id: '(\w+)'/m) ?? [])[1] : null
}).filter(Boolean)
const panelIds = readdirSync(join(src, 'panels'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
  const f = join(src, 'panels', d.name, 'index.jsx')
  return existsSync(f) ? (readFileSync(f, 'utf8').match(/export default \{ id: '(\w+)'/) ?? [])[1] : null
}).filter(Boolean)
const pages = new Set(sections.flatMap((s) => [...s.paths, ...(s.href ? [s.href] : [])]))
for (const s of sections) for (const m of sectionsSrc.matchAll(/href: '#(\/[\w/-]+)'/g)) pages.add(m[1])

const { CHAPTERS, ORDERS, stepsFor, seconds } = await import(join(src, 'tour/chapters.js'))
const { TOKENS, tokensIn, fill, loadTourData } = await import(join(src, 'tour/numbers.js'))

const errs = []
const seen = new Set()
for (const c of CHAPTERS) {
  for (const s of c.steps) {
    const at = `${s.id}`
    if (seen.has(s.id)) errs.push(`${at}: duplicate id`)
    seen.add(s.id)
    const sec = s.section ? sections.find((x) => x.id === s.section) : null
    if (s.section && !sec) errs.push(`${at}: no section '${s.section}'`)
    for (const l of Object.keys(s.layers ?? {})) if (!layerIds.includes(l)) errs.push(`${at}: no layer '${l}'`)
    if (s.panel) {
      if (!panelIds.includes(s.panel) && s.panel !== 'stories') errs.push(`${at}: no panel '${s.panel}'`)
      if (sec && sec.panels.length && ![...sec.panels, ...sec.more].includes(s.panel)) errs.push(`${at}: panel '${s.panel}' is not in section '${s.section}'`)
    }
    if (s.page && !pages.has(s.page)) errs.push(`${at}: no page '${s.page}'`)
    for (const t of tokensIn(s.caption)) if (!TOKENS[t]) errs.push(`${at}: token {${t}} has no resolver`)
    if (tokensIn(s.caption).length && !s.fallback) errs.push(`${at}: live caption without a fallback`)
    if (s.caption.split(/(?<=[.!?])\s+/).length > 3 && !tokensIn(s.caption).length) errs.push(`${at}: caption longer than two or three sentences`)
    for (const o of s.for ?? []) if (!ORDERS[o]) errs.push(`${at}: unknown order '${o}'`)
  }
}
for (const [name, o] of Object.entries(ORDERS)) {
  for (const id of o.chapters) if (!CHAPTERS.some((c) => c.id === id)) errs.push(`order ${name}: no chapter '${id}'`)
  const sec = seconds(name)
  console.log(`${name}: ${stepsFor(name).length} steps, ${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`)
  if (sec < 130 || sec > 220) errs.push(`order ${name}: ${sec}s is not about three minutes`)
}

if (live) {
  const realFetch = globalThis.fetch
  globalThis.fetch = (u, o) => realFetch(String(u).startsWith('/') ? base + u : u, o)
  const data = await loadTourData()
  for (const s of stepsFor('story')) {
    const f = fill(s, data)
    console.log(`${f.live ? 'LIVE    ' : tokensIn(s.caption).length ? 'FALLBACK' : 'static  '} ${s.id}: ${f.text}`)
  }
}
console.log(errs.length ? errs.join('\n') : 'tour content ok')
process.exit(errs.length ? 1 : 0)
