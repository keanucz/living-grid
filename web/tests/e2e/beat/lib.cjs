// Helpers for the Beat the model end-to-end run: browser launch, WebSocket frame capture, leak checks, issue log.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const OUT = process.env.OUT || path.join(process.cwd(), 'beat-e2e-out')
fs.mkdirSync(OUT, { recursive: true })

function playwright() {
  const where = [process.env.PLAYWRIGHT_MODULE, 'playwright-core', 'playwright'].filter(Boolean)
  for (const w of where) {
    try {
      return require(w)
    } catch {
      /* try the next */
    }
  }
  throw new Error('playwright-core not found: set PLAYWRIGHT_MODULE to its path')
}

const chromePath = () => process.env.CHROME || path.join(process.env.HOME, '.cache/ms-playwright/chromium-1254/chrome-linux64/chrome')

async function launch() {
  const { chromium } = playwright()
  return chromium.launch({
    executablePath: chromePath(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  })
}

const IPHONE = {
  viewport: { width: 390, height: 664 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
}
const DESKTOP = { viewport: { width: 1280, height: 800 } }

// ---- issues: every problem is recorded with a screenshot, then filed as its own hub task by hand
const issues = []
async function issue(page, key, title, detail) {
  const shot = path.join(OUT, `issue-${String(issues.length + 1).padStart(2, '0')}-${key}.png`)
  try {
    await page.screenshot({ path: shot, timeout: 15000 })
  } catch {
    /* no screenshot */
  }
  issues.push({ key, title, detail, shot })
  console.log(`ISSUE ${key}: ${title}${detail ? ` (${detail})` : ''}`)
}

// ---- WebSocket capture. SpacetimeDB frames start with a compression tag (0 none, 1 brotli, 2 gzip); the rest is
// binary rows whose strings are plain UTF-8, so a secret string shows up as readable text once decompressed.
function capture(page, label) {
  const frames = []
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      const raw = typeof f.payload === 'string' ? Buffer.from(f.payload) : f.payload
      let body = raw
      try {
        if (raw[0] === 2) body = zlib.gunzipSync(raw.subarray(1))
        else if (raw[0] === 1) body = zlib.brotliDecompressSync(raw.subarray(1))
      } catch {
        /* keep the raw bytes */
      }
      frames.push({ t: Date.now(), text: body.toString('latin1') })
    })
  })
  return { label, frames, firstSeen: (needle) => frames.find((f) => f.text.includes(needle))?.t ?? null }
}

// Public-table view of the world, as any anonymous client sees it (the strongest check of what can leak).
async function anon(base) {
  const id = await (await fetch(`${base}/v1/identity`, { method: 'POST' })).json()
  return async (sql) => {
    const r = await fetch(`${base}/v1/database/living-grid/sql`, { method: 'POST', headers: { Authorization: `Bearer ${id.token}` }, body: sql })
    return { status: r.status, body: r.ok ? await r.json() : await r.text() }
  }
}

const rowsOf = (res) => {
  const t = res.body?.[0]
  if (!t) return []
  const names = t.schema.elements.map((e) => e.name?.some ?? e.name)
  return t.rows.map((r) => Object.fromEntries(r.map((v, i) => [names[i], v])))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
module.exports = { OUT, launch, IPHONE, DESKTOP, issue, issues, capture, anon, rowsOf, sleep, playwright }
