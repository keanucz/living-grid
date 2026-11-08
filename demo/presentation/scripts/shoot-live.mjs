// Screenshots of the live site at 1920x1080 for the deck's product scene (#323).
// Usage: node scripts/shoot-live.mjs [--base https://htb.stefvuck.dev] [--only name,name]
// Read-only: the Hormuz shot answers the app's POST /intervene from the pre-computed GET /scenarios result inside the
// browser, so nothing is ever posted to the live API.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

// Playwright is not a dependency of this project; point PLAYWRIGHT_DIR at a folder whose node_modules has it.
const { chromium } = createRequire((process.env.PLAYWRIGHT_DIR ?? process.cwd()) + '/')('playwright')

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const BASE = arg('--base', 'https://htb.stefvuck.dev').replace(/\/$/, '') + '/'
const only = arg('--only', '')?.split(',').filter(Boolean)
const OUT = new URL('../public/shots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const scen = await (await fetch(BASE + 'api/scenarios')).json()
const hormuz = scen.scenarios.find((s) => s.key === 'hormuz').result

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await ctx.route('**/intervene', (r) => r.request().method() === 'POST'
  ? r.fulfill({ json: { ...hormuz, request: { type: 'hormuz', magnitude: hormuz.applied_magnitude ?? 40, hours: hormuz.applied_hours ?? 336 } } })
  : r.continue())
const page = await ctx.newPage()
const click = (sel, text) => page.evaluate(([s, t]) => { const el = [...document.querySelectorAll(s)].find((b) => b.textContent.trim().includes(t)); if (el) el.click(); return !!el }, [sel, text])
const settle = (ms = 6000) => page.waitForTimeout(ms)
const shot = async (name) => { await page.screenshot({ path: OUT + name + '.png', timeout: 150000 }); console.log('shot', name) }
const tab = (label) => click('nav.tabs button', label)

await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.goto(BASE, { waitUntil: 'load' }); await settle(5000)
// Intro film first (Skip), then the Where to? welcome (Skip, show me the map).
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => { for (const b of document.querySelectorAll('button, a')) if (/^Skip/.test(b.textContent.trim())) b.click() })
  await settle(2500)
  if (!(await page.evaluate(() => [...document.querySelectorAll('button, a')].some((b) => /^Skip/.test(b.textContent.trim()))))) break
}
await settle(3000)

const STATES = {
  'hidden-grid': async () => { await tab('Hidden grid'); await settle(); await click('button.story-tile', 'Scotland'); await settle(5000) },
  'whatif-hormuz': async () => { await tab('What if'); await settle(); await click('button', 'Strait of Hormuz'); await settle(9000) },
  'history-26oct': async () => {
    await tab('Forecast'); await settle()
    await page.fill('input.scrub-date', '2026-10-26'); await page.dispatchEvent('input.scrub-date', 'change'); await settle(8000)
  },
  tonight: async () => { await page.goto(BASE + '#/household'); await settle(8000) },
  datacentre: async () => { await tab('What if'); await settle(); await click('button', 'Strait of Hormuz'); await settle(6000)
    await click('button.ex-dbtn', 'For experts'); await settle(1500)
    await click('button.dc-toggle', 'Data centre builder'); await settle(9000)
    await page.evaluate(() => { const slot = document.querySelector('.slot-left'), t = document.querySelector('.dc-toggle'); if (slot && t) slot.scrollTop += t.getBoundingClientRect().top - 90 }); await settle(1500) },
  proof: async () => { await tab('Proof'); await settle(8000) },
  play: async () => { await tab('Play'); await settle(3000); await click('button, a', 'rehearsal day'); await settle(10000) },
}
for (const [name, fn] of Object.entries(STATES)) {
  if (only.length && !only.includes(name)) continue
  try { await fn(); await shot(name) } catch (e) { console.log('FAILED', name, e.message) }
}
await browser.close()
