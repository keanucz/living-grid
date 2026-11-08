// Beat the model, end to end, against a running stack (default: the live site).
//   BASE=https://htb.stefvuck.dev PLAYWRIGHT_MODULE=/path/to/playwright-core nice -n 10 node web/tests/e2e/beat/beat.e2e.cjs [solo|room|demo]...
// Solo: a full round on iPhone 13 emulation, timed. Room: a desktop host, the big screen and two phones. Every run also
// checks that no answer, reason or date reaches a client before its reveal (WebSocket frames and anonymous SQL).
// Problems go to beat-e2e-out/report.json with screenshots; nothing here asserts by throwing, so one failure does not hide the next.
const fs = require('fs')
const path = require('path')
const { OUT, launch, IPHONE, DESKTOP, issue, issues, capture, anon, rowsOf, sleep } = require('./lib.cjs')

const BASE = (process.env.BASE || 'https://htb.stefvuck.dev').replace(/\/$/, '')
const STDB_HTTP = (process.env.STDB_HTTP || BASE).replace(/\/$/, '')
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['solo', 'room']
const T = { step: 30000 }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function ctxPage(browser, opts) {
  const ctx = await browser.newContext(opts)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => log('pageerror', e.message))
  return { ctx, page }
}

const text = async (loc) => ((await loc.first().textContent({ timeout: 2000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim()

// Play one call on a phone: pick an option, set the slider, lock in. Returns what was chosen.
async function answerCall(page, k, { pick = 0, confidence = 75 } = {}) {
  const card = page.locator(`section[aria-label="Call ${k + 1} of 5"]`)
  await card.waitFor({ timeout: T.step })
  const opts = card.locator('[role="radio"]')
  const n = await opts.count()
  const idx = pick < 0 ? n + pick : Math.min(pick, n - 1)
  const label = await text(opts.nth(idx))
  await opts.nth(idx).click()
  await card.locator('input[type="range"]').fill(String(confidence))
  await card.getByRole('button', { name: /Lock in/ }).click()
  return { n, label, card }
}

// The reveal card of call k: returns the parts the UI shows.
async function readReveal(page) {
  const rv = page.locator('section.bm-reveal')
  await rv.waitFor({ timeout: T.step })
  return {
    verdict: await text(rv.locator('.bm-verdict')),
    happened: await text(rv.locator('.bm-happened')),
    reason: await text(rv.locator('.bm-reason')),
    rows: await rv.locator('.bm-rows li').allTextContents(),
  }
}

function leakCheck(page, cap, events, label, since = 0) {
  // events: [{ k, revealAt, happened, reason }]; the strings that appear at a reveal must not have been received earlier.
  return Promise.all(events.map(async (e) => {
    for (const [what, s] of [['what happened', e.happened.replace(/^What happened\s*/, '').slice(-40)], ['reason', e.reason.slice(-40)]]) {
      if (!s || s.length < 20) continue
      const first = cap.firstSeen(s, since)
      if (first !== null && first < e.revealAt - 2500) {
        await issue(page, `leak-${label}-call${e.k + 1}-${what.replace(' ', '-')}`, `${label}: ${what} of call ${e.k + 1} reached the client before its reveal`, `"${s}" arrived ${((e.revealAt - first) / 1000).toFixed(1)} s before the reveal was shown`)
      }
    }
  }))
}

const SOLO_NAME = `E2E Solo ${Date.now() % 100000}`
const num = (t) => Number(String(t).replace(/[^\d.\-−]/g, '').replace('−', '-'))

// Exact numbers from the public tables (the screen rounds to one decimal).
async function myGame() {
  const q = await anon(STDB_HTTP)
  const accts = rowsOf(await q('SELECT game_id, name, points, equity, is_bot FROM pm_account')).filter((a) => a.name === SOLO_NAME)
  const g = accts.length ? Math.max(...accts.map((a) => a.game_id)) : null
  return { q, g, acct: accts.find((a) => a.game_id === g) }
}
const lastTrade = async (g, q) => rowsOf(await q(`SELECT seq, market_id, side, action, shares, price FROM pm_trade WHERE game_id = ${g}`)).filter((t) => !(typeof t.identity === 'string' && 0)).sort((a, b) => b.seq - a.seq)

// One solo markets round on a phone. opts.rounds > 1 plays "Play again" and collects the dates for the variety check.
async function soloRound(page, cap, label, { first = true } = {}) {
  const t0 = Date.now()
  const feed = page.locator('section.pm-feed')
  await feed.waitFor({ timeout: 40000 }).catch(() => issue(page, `${label}-no-feed`, `${label}: the market feed never appeared`, ''))
  if (!(await feed.count())) return null
  const cards = page.locator('article.pm-card')
  const nMarkets = await cards.count()
  if (nMarkets < 2) await issue(page, `${label}-few-markets`, `${label}: only ${nMarkets} market(s) in the feed`, '')
  await page.screenshot({ path: path.join(OUT, `${label}-01-feed.png`), fullPage: true })
  const vw = page.viewportSize().width
  const clipped = await page.evaluate((w) => [...document.querySelectorAll('.pm-stand li')].filter((li) => li.getBoundingClientRect().right > w + 1).length, vw)
  if (clipped) await issue(page, `${label}-standings-clipped`, `${label}: ${clipped} entr${clipped > 1 ? 'ies' : 'y'} of the standings strip run off the right edge of a ${vw}px phone`, 'only visible by scrolling sideways, no hint')
  const equity = async () => num(await text(page.locator('.pm-eq b')))
  const clock = async () => await text(page.locator('.pm-clock b'))
  const log0 = { equity: await equity(), clock: await clock() }
  if (Math.abs(log0.equity - 1000) > 0.01) await issue(page, `${label}-start-equity`, `${label}: starting equity is ${log0.equity}, expected 1,000`, '')

  // every open card: a probability 1-99%, Yes and No asks one cent either side, a close time
  for (let i = 0; i < nMarkets; i++) {
    const c = cards.nth(i)
    const price = num(await text(c.locator('.pm-prob b')))
    const yes = num(await text(c.locator('.pm-yes b')))
    const no = num(await text(c.locator('.pm-no b')))
    if (!(price >= 1 && price <= 99)) await issue(page, `${label}-price-range-${i}`, `${label}: market ${i + 1} shows a price of ${price}%`, await text(c))
    else if (yes !== Math.min(99, price + 1) || no !== 100 - Math.max(1, price - 1)) await issue(page, `${label}-quote-${i}`, `${label}: market ${i + 1} quotes Yes ${yes} / No ${no} at ${price}% (expected ${Math.min(99, price + 1)} / ${100 - Math.max(1, price - 1)})`, '')
    if (!/Closes \d\d:00/.test(await text(c.locator('.pm-close')))) await issue(page, `${label}-close-${i}`, `${label}: market ${i + 1} shows no close time`, '')
  }

  // Trade 1: buy Yes with 50 points on the first market, check the sheet's numbers, then sell it straight back.
  const c0 = cards.first()
  const q0 = await text(c0.locator('.pm-q'))
  const price0 = num(await text(c0.locator('.pm-prob b')))
  await c0.locator('.pm-yes').click()
  const sheet = page.locator('[role="dialog"]')
  await sheet.waitFor({ timeout: 5000 }).catch(() => issue(page, `${label}-no-sheet`, `${label}: tapping Yes opens no trade sheet`, ''))
  await page.screenshot({ path: path.join(OUT, `${label}-02-sheet.png`) })
  await sheet.getByRole('button', { name: '50', exact: true }).click()
  const sum = await text(sheet.locator('.pm-sum'))
  const shares = Number(sum.match(/Shares\s*(\d+)/)?.[1])
  const cost = num(sum.match(/Cost\s*([\d.,]+)/)?.[1])
  const ask = price0 + 1
  if (shares !== Math.floor(50 / (ask / 100))) await issue(page, `${label}-shares-math`, `${label}: 50 points at ${ask}¢ buys ${shares} shares, expected ${Math.floor(50 / (ask / 100))}`, sum)
  if (Math.abs(cost - shares * ask / 100) > 0.06) await issue(page, `${label}-cost-math`, `${label}: cost ${cost} is not shares x ask (${(shares * ask / 100).toFixed(2)})`, sum)
  const clockAtSheet = await clock()
  const g0 = await myGame()
  const points0 = g0.acct?.points
  await sheet.getByRole('button', { name: /^Buy Yes/ }).click()
  await sheet.waitFor({ state: 'detached', timeout: 8000 }).catch(() => issue(page, `${label}-sheet-stays`, `${label}: the trade sheet stayed open after a buy`, ''))
  await sleep(1200)
  const clockAfter = await clock()
  const g1 = await myGame()
  if (g1.g && points0 != null) {
    const trades = (await lastTrade(g1.g, g1.q)).filter((t) => t.market_id && t.side === 'yes' && t.action === 'buy' && t.shares === shares)
    const t = trades[0]
    if (!t) await issue(page, `${label}-trade-missing`, `${label}: no pm_trade row for the ${shares}-share buy`, '')
    else if (clockAtSheet === clockAfter && t.price !== ask) await issue(page, `${label}-fill-price`, `${label}: bought at ${t.price}¢ but the sheet quoted ${ask}¢ in the same game hour`, '')
    const paid = points0 - g1.acct.points
    if (t && Math.abs(paid - shares * t.price / 100) > 0.006) await issue(page, `${label}-paid`, `${label}: points fell by ${paid.toFixed(2)}, shares x price is ${(shares * t.price / 100).toFixed(2)}`, '')
  }
  if (clockAtSheet !== clockAfter) log(`${label}: the hour ticked while the sheet was open (price may legitimately differ)`)
  const pos = page.locator('section[aria-label="Your positions"]')
  if (!(await pos.count()) || !(await text(pos)).includes(q0.slice(0, 20))) await issue(page, `${label}-position-missing`, `${label}: the bought position is not listed under Your positions`, await text(pos))
  await page.screenshot({ path: path.join(OUT, `${label}-03-position.png`), fullPage: true })
  // Sell it back from the position row: the round trip costs 2 cents a share unless the hour ticked over.
  const tickBefore = await clock()
  const pointsMid = (await myGame()).acct?.points
  await pos.getByRole('button', { name: 'Sell' }).first().click()
  const sheet2 = page.locator('[role="dialog"]')
  await sheet2.getByRole('button', { name: /^Sell Yes/ }).click({ timeout: 5000 }).catch(() => issue(page, `${label}-sell-button`, `${label}: no Sell button in the trade sheet`, ''))
  await sheet2.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  await sleep(1200)
  const g2 = await myGame()
  if (g2.acct && points0 != null && (await clock()) === tickBefore && clockAtSheet === clockAfter) {
    const loss = points0 - g2.acct.points
    if (Math.abs(loss - shares * 0.02) > 0.011) await issue(page, `${label}-spread`, `${label}: a buy-then-sell round trip lost ${loss.toFixed(2)} points, expected the 2-cent spread (${(shares * 0.02).toFixed(2)})`, '')
  }
  const sold = (await lastTrade(g2.g, g2.q)).find((t) => t.action === 'sell')
  if (sold && sold.shares !== shares) await issue(page, `${label}-sold-shares`, `${label}: Sell all sold ${sold.shares} of ${shares} shares`, '')

  // Trade 2 and 3: hold No on the second market and Yes on the third until they close; remember what the sheet promised.
  const holds = []
  for (const [idx, side] of [[1, 'no'], [2, 'yes']]) {
    if (idx >= nMarkets) continue
    const c = cards.nth(idx)
    const q = await text(c.locator('.pm-q'))
    const clock0 = await clock()
    const price1 = num(await text(c.locator('.pm-prob b')))
    await c.locator(side === 'yes' ? '.pm-yes' : '.pm-no').click()
    const sh = page.locator('[role="dialog"]')
    await sh.getByRole('button', { name: '25', exact: true }).click()
    const s2 = await text(sh.locator('.pm-sum'))
    const profit = num(s2.match(/Profit if \w+\s*\+?([\d.,]+)/)?.[1])
    const cst = num(s2.match(/Cost\s*([\d.,]+)/)?.[1])
    await sh.getByRole('button', { name: new RegExp(`^Buy ${side === 'yes' ? 'Yes' : 'No'}`) }).click()
    await sh.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
    await sleep(1000)
    const clock1 = await clock()
    const gx = await myGame()
    const bought = gx.g ? (await lastTrade(gx.g, gx.q)).find((t) => t.side === side && t.action === 'buy') : null
    const quoted = side === 'yes' ? Math.min(99, price1 + 1) : 100 - Math.max(1, price1 - 1)
    if (bought && clock0 === clock1 && bought.price !== quoted) await issue(page, `${label}-fill-${side}`, `${label}: bought ${side.toUpperCase()} at ${bought.price}¢ but the card quoted ${quoted}¢ and the hour had not changed`, '')
    if (bought && clock0 !== clock1) log(`${label}: the hour ticked during the ${side.toUpperCase()} trade; filled at ${bought.price}¢, card said ${quoted}¢`)
    holds.push({ q, side, profit, cost: cst, ticked: clock0 !== clock1 })
  }

  // Play out the day: watch the clock, check prices only ever move by the model path and that resolved cards fill in.
  const seenClosed = new Set()
  const events = []
  let lastClock = await clock()
  const deadline = Date.now() + 130000
  while (Date.now() < deadline) {
    const doneBtn = page.getByRole('button', { name: /The day is over/ })
    for (let i = 0, n = await cards.count(); i < n; i++) {
      const c = cards.nth(i)
      if (!(await c.getAttribute('class'))?.includes('pm-closed')) continue
      const qt = await text(c.locator('.pm-q'))
      if (seenClosed.has(qt)) continue
      seenClosed.add(qt)
      const happened = await text(c.locator('.pm-what'))
      const why = await text(c.locator('.pm-why'))
      const outcome = await text(c.locator('.pm-outcome b'))
      const rows = await c.locator('.pm-pnl li').allTextContents()
      events.push({ at: Date.now(), q: qt, happened, why, outcome })
      if (!/YES|NO/.test(outcome)) await issue(page, `${label}-outcome`, `${label}: a resolved card shows no YES/NO outcome`, qt)
      if (!happened.replace('What happened', '').trim()) await issue(page, `${label}-happened`, `${label}: resolved card has no "what happened"`, qt)
      if (!why.replace(/Why the model said.*?%/, '').trim()) await issue(page, `${label}-why`, `${label}: resolved card has no reason`, qt)
      if (rows.length < 5) await issue(page, `${label}-pnl-rows`, `${label}: resolved card lists ${rows.length} profit rows (you + 4 bots expected)`, rows.join(' | '))
      const h = holds.find((x) => x.q === qt)
      if (h) {
        const won = outcome.includes(h.side.toUpperCase())
        const mine = num(rows.find((r) => /^You/.test(r)) ?? '')
        const want = won ? h.profit : -h.cost
        if (!h.ticked && !(Math.abs(mine - want) <= 0.15)) await issue(page, `${label}-pnl-${h.side}`, `${label}: held ${h.side.toUpperCase()}, outcome ${outcome}: card shows ${mine}, expected ${want.toFixed(2)}`, rows.join(' | '))
      }
      if (seenClosed.size === 1) await page.screenshot({ path: path.join(OUT, `${label}-04-first-resolved.png`), fullPage: true })
      // nothing about this outcome may have reached the client earlier
      const s1 = happened.replace(/^What happened\s*/, '').slice(0, 30)
      const first = s1.length > 12 ? cap.firstSeen(s1) : null
      if (first !== null && first < Date.now() - 12000) await issue(page, `${label}-leak-actual`, `${label}: the "what happened" text of a market reached the client ${((Date.now() - first) / 1000).toFixed(0)} s before it resolved`, s1)
    }
    if (await doneBtn.count()) break
    const cl = await clock()
    if (cl !== lastClock) lastClock = cl
    await sleep(500)
  }
  const doneBtn = page.getByRole('button', { name: /The day is over/ })
  const finished = await doneBtn.count()
  if (!finished) {
    await issue(page, `${label}-no-end`, `${label}: the day never ended within the time allowed`, `clock ${await clock()}`)
    return null
  }
  await sleep(800)
  const equityBefore = await equity()
  await doneBtn.click()
  const end = page.locator('section.pm-end')
  await end.waitFor({ timeout: 5000 })
  const covered = await page.evaluate(() => {
    const toast = document.querySelector('.pm-toast')
    const btn = [...document.querySelectorAll('.pm-end button')].find((b) => /Play again/.test(b.textContent))
    if (!toast || !btn) return false
    const a = toast.getBoundingClientRect(); const b = btn.getBoundingClientRect()
    return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right
  })
  if (covered) { await page.screenshot({ path: path.join(OUT, `${label}-end-toast.png`) }); await issue(page, `${label}-toast-covers-again`, `${label}: the "Resolved..." toast covers the Play again button on the end screen`, 'for up to 5 s after the last market closes') }
  const endAt = Date.now()
  await page.screenshot({ path: path.join(OUT, `${label}-05-end.png`), fullPage: true })
  const et = await text(end)
  const day = et.match(/\b20\d\d-\d\d-\d\d\b/)?.[0] ?? null
  if (!day) await issue(page, `${label}-end-day`, `${label}: the end screen does not reveal the date`, et.slice(0, 200))
  const pnl = num(await text(end.locator('.pm-bigpnl')))
  const res = rowsOf(await (await anon(STDB_HTTP))("SELECT name, points, mode FROM game_result WHERE mode = 'pm'")).filter((r) => r.name === SOLO_NAME)
  const exact = res.length ? res.at(-1).points : null
  if (exact !== null && Math.abs(pnl - exact) > 0.06) await issue(page, `${label}-end-pnl`, `${label}: the end screen shows ${pnl}, the recorded result is ${exact}`, '')
  if (exact !== null && Math.abs(equityBefore - 1000 - exact) > 0.55) await issue(page, `${label}-header-equity-stale`, `${label}: the header showed equity ${equityBefore} when the day ended but the final result is ${(1000 + exact).toFixed(2)}`, 'the header lags the last settlement')
  const beats = await end.locator('.pm-beats li').count()
  if (beats !== 4) await issue(page, `${label}-end-bots`, `${label}: the end screen compares you with ${beats} bots, expected 4`, '')
  if (!/#\d+ of 5/.test(et)) await issue(page, `${label}-end-rank`, `${label}: the end screen shows no rank "#n of 5"`, et.slice(0, 160))
  if (!(await end.getByRole('button', { name: 'Play again' }).count())) await issue(page, `${label}-end-again`, `${label}: no Play again button`, '')
  if (day) {
    const early = cap.frames.filter((f) => f.t < endAt - 15000 && f.text.includes(day))
    if (early.length) await issue(page, `${label}-leak-day`, `${label}: the date reached the client well before the end`, `${early.length} frame(s) contained ${day}`)
  }
  const secs = (Date.now() - t0) / 1000
  log(`${label}: ${secs.toFixed(0)} s, day ${day}, profit ${pnl}`)
  return { day, pnl, secs }
}

// What anonymous clients can read mid-game: no outcome, no day, no price beyond the game clock.
async function anonChecks(page, label) {
  const q = await anon(STDB_HTTP).catch(() => null)
  if (!q) return
  const open = rowsOf(await q("SELECT outcome, actual_text FROM pm_market WHERE status = 'open'")).filter((r) => r.outcome || r.actual_text)
  if (open.length) await issue(page, `${label}-sql-open-outcome`, 'An open pm_market row carries an outcome or actual text', JSON.stringify(open[0]).slice(0, 200))
  const early = rowsOf(await q("SELECT day_revealed FROM pm_game WHERE state = 'running'")).filter((r) => r.day_revealed)
  if (early.length) await issue(page, `${label}-sql-day`, 'A running pm_game has day_revealed set', '')
  const oldCalls = rowsOf(await q('SELECT game_id, text, answer FROM beat_call WHERE revealed = true'))
  const oldMarkets = rowsOf(await q("SELECT game_id, market_id, outcome FROM pm_market WHERE status = 'closed'"))
  if (oldCalls.length || oldMarkets.length) {
    await issue(page, 'sql-finished-games-public', 'Revealed answers of other (finished) games are readable by every client', `${oldCalls.length} beat_call and ${oldMarkets.length} closed pm_market rows, with outcomes; a day's questions repeat between games, so a player can look up an answer before their own reveal`)
  }
  for (const t of ['pm_day', 'pm_secret', 'beat_pick', 'beat_day']) {
    const r = await q(`SELECT * FROM ${t}`)
    if (r.status === 200) await issue(page, `${label}-sql-${t}`, `Anonymous clients can read ${t}`, '')
  }
  const games = Object.fromEntries(rowsOf(await q('SELECT id, clock_hour FROM pm_game')).map((g) => [g.id, g.clock_hour]))
  for (const p of rowsOf(await q('SELECT game_id, hour FROM pm_price'))) {
    if (games[p.game_id] !== undefined && p.hour > games[p.game_id]) { await issue(page, `${label}-sql-future-price`, 'A pm_price row is ahead of the game clock', JSON.stringify(p)); break }
  }
}

async function solo(browser) {
  const rounds = Number(process.env.ROUNDS || 1)
  log(`solo markets: ${rounds} round(s)`)
  const { ctx, page } = await ctxPage(browser, IPHONE)
  const cap = capture(page, 'solo')
  await page.goto(`${BASE}/#/play`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const skip = page.getByText('Skip, show me the map')
  if (await skip.count()) await skip.first().click().catch(() => {})
  const name = page.locator('.lb-field input').first()
  await name.waitFor({ timeout: 30000 })
  await name.fill(SOLO_NAME)
  await page.screenshot({ path: path.join(OUT, 'solo-00-landing.png') })
  await page.getByRole('button', { name: 'Play solo' }).click()
  const days = []
  for (let r = 0; r < rounds; r++) {
    const label = `solo${r + 1}`
    if (r === 0) setTimeout(() => anonChecks(page, label).catch(() => {}), 20000)
    const res = await soloRound(page, cap, label)
    if (!res) break
    days.push(res.day)
    if (res.secs > 135) await issue(page, `${label}-slow`, `${label}: a round took ${res.secs.toFixed(0)} s`, '')
    if (r < rounds - 1) {
      await page.locator('section.pm-end').getByRole('button', { name: 'Play again' }).click()
      await sleep(1500)
    }
  }
  if (days.length > 1) {
    const uniq = new Set(days.filter(Boolean))
    log('solo days:', days.join(', '))
    if (uniq.size < Math.min(days.length, 3)) await issue(page, 'variety', `Rounds repeat days: ${days.join(', ')}`, 'the same player should be dealt unseen days from the pool first')
  }
  await ctx.close()
}

async function room(browser) {
  log('room: start')
  const host = await ctxPage(browser, DESKTOP)
  const hcap = capture(host.page, 'host')
  await host.page.goto(`${BASE}/#/play`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await host.page.locator('.lb-field input').first().fill('E2E Host')
  await host.page.getByRole('button', { name: 'Host a room' }).click()
  await host.page.getByRole('button', { name: 'Create game' }).click()
  const codeEl = host.page.locator('.lb-code')
  await codeEl.waitFor({ timeout: T.step })
  const code = (await text(codeEl)).replace(/\s/g, '')
  log('room: code', code)
  await host.page.screenshot({ path: path.join(OUT, 'room-00-host-waiting.png') })

  const screenCtx = await ctxPage(browser, { viewport: { width: 1920, height: 1080 } })
  const scap = capture(screenCtx.page, 'screen')
  await screenCtx.page.goto(`${BASE}/#/screen?code=${code}`, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const phones = []
  for (const [i, nm] of ['E2E Ann', 'E2E Ben'].entries()) {
    const p = await ctxPage(browser, IPHONE)
    p.cap = capture(p.page, `phone${i + 1}`)
    await p.page.goto(`${BASE}/#/play`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await p.page.locator('.lb-code-in').fill(code)
    await p.page.getByRole('button', { name: 'Continue' }).click()
    await p.page.locator('.lb-field input').first().fill(nm)
    await p.page.getByRole('button', { name: 'Join', exact: true }).click()
    await p.page.getByRole('button', { name: /^Ready/ }).click().catch(() => issue(p.page, `room-ready-${i + 1}`, `Room: phone ${i + 1} has no Ready button after joining`, ''))
    phones.push(p)
  }
  await host.page.waitForTimeout(1500)
  await host.page.screenshot({ path: path.join(OUT, 'room-01-host-two-joined.png') })
  const names = await host.page.locator('.lb-players, .lb-faces').allTextContents()
  if (!/Ann/.test(names.join(' ')) || !/Ben/.test(names.join(' '))) await issue(host.page, 'room-players-not-shown', 'Room: the host does not see both phones in the waiting room', names.join(' | ').slice(0, 200))
  await screenCtx.page.screenshot({ path: path.join(OUT, 'room-02-screen-waiting.png') })

  const t0 = Date.now()
  const startedAt = t0 - 500
  await host.page.getByRole('button', { name: 'Start game' }).click()
  const events = []
  for (let k = 0; k < 5; k++) {
    try {
      const [a, b] = await Promise.all([answerCall(phones[0].page, k, { pick: 0, confidence: 80 }), answerCall(phones[1].page, k, { pick: -1, confidence: 60 })])
      if (a.label === b.label && a.n > 1) await issue(phones[0].page, `room-pick-${k + 1}`, 'Room: the two phones picked the same option (test script)', '')
    } catch (e) {
      await issue(phones[0].page, `room-call${k + 1}-missing`, `Room: call ${k + 1} never appeared on a phone`, e.message.split('\n')[0])
      break
    }
    if (k === 1) {
      await sleep(700)
      await screenCtx.page.screenshot({ path: path.join(OUT, 'room-03-screen-answers.png') })
    }
    let rv
    try {
      rv = await readReveal(phones[0].page)
    } catch (e) {
      await issue(phones[0].page, `room-reveal${k + 1}`, `Room: no reveal after call ${k + 1}`, e.message.split('\n')[0])
      break
    }
    events.push({ k, revealAt: Date.now(), happened: rv.happened, reason: rv.reason })
    if (k === 0) {
      await sleep(500)
      await screenCtx.page.screenshot({ path: path.join(OUT, 'room-04-screen-reveal.png') })
      await phones[1].page.screenshot({ path: path.join(OUT, 'room-05-phone2-reveal.png') })
    }
    if (k < 4) await phones[0].page.locator(`section[aria-label="Call ${k + 2} of 5"]`).waitFor({ timeout: 20000 }).catch(() => issue(phones[0].page, `room-next${k + 2}`, `Room: call ${k + 2} did not open`, ''))
  }
  for (const p of phones) await p.page.getByRole('button', { name: 'See your result' }).click({ timeout: 15000 }).catch(() => {})
  const done = await Promise.all(phones.map((p) => p.page.locator('section.bm-end').waitFor({ timeout: 20000 }).then(() => true).catch(() => false)))
  log(`room: ${done.every(Boolean) ? 'both phones finished' : 'a phone did not reach the end'} in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  if (!done.every(Boolean)) await issue(phones[done.indexOf(false)].page, 'room-no-end', 'Room: a phone never showed the end card', '')
  else {
    await phones[0].page.screenshot({ path: path.join(OUT, 'room-06-phone1-end.png') })
    const t = await text(phones[0].page.locator('section.bm-end'))
    if (!/#\d+ of \d+/.test(t)) await issue(phones[0].page, 'room-rank', 'Room: the end card shows no rank in the room ("#n of N")', t.slice(0, 200))
  }
  await screenCtx.page.screenshot({ path: path.join(OUT, 'room-07-screen-end.png') })
  const st = await text(screenCtx.page.locator('body'))
  if (!/E2E Ann/.test(st) && !/E2E Ben/.test(st)) await issue(screenCtx.page, 'room-screen-leaderboard', 'Room: the big screen shows no player names at the end (leaderboard)', st.slice(0, 200))
  // meta leaderboard (profile ratings) as any client sees it
  const q = await anon(STDB_HTTP).catch(() => null)
  if (q) {
    const meta = rowsOf(await q('SELECT name, rating, games FROM meta_leaderboard'))
    const have = ['E2E Ann', 'E2E Ben'].filter((n) => meta.some((r) => r.name === n))
    if (have.length < 2) await issue(phones[0].page, 'room-meta', 'Room: the meta leaderboard is missing a player after the round', JSON.stringify(meta).slice(0, 200))
  }
  await leakCheck(phones[0].page, phones[0].cap, events, 'room', startedAt)
  const endAt = Date.now()
  const day = (await text(phones[0].page.locator('section.bm-end'))).match(/\b20\d\d-\d\d-\d\d\b/)?.[0]
  if (day) for (const c of [hcap, scap, phones[0].cap, phones[1].cap]) {
    const early = c.frames.filter((f) => f.t < endAt - 20000 && f.text.includes(day))
    if (early.length) await issue(host.page, `leak-day-${c.label}`, `Room: the date reached ${c.label} well before the end`, `${early.length} frame(s)`)
  }
  for (const x of [host, screenCtx, ...phones]) await x.ctx.close()
}

async function demo(browser) {
  log('demo: start')
  const { ctx, page } = await ctxPage(browser, IPHONE)
  await page.goto(`${BASE}/#/play?demo=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  for (let k = 0; k < 5; k++) {
    await answerCall(page, k, { pick: 0, confidence: 70 })
    const rv = await readReveal(page)
    if (k === 0) await page.screenshot({ path: path.join(OUT, 'demo-reveal-1.png') })
    if (!rv.reason) await issue(page, `demo-reason${k + 1}`, `Demo: reveal ${k + 1} has no reason`, '')
    if (k < 4) await page.locator(`section[aria-label="Call ${k + 2} of 5"]`).waitFor({ timeout: 25000 }).catch(() => issue(page, `demo-next${k + 2}`, `Demo: call ${k + 2} did not open`, ''))
  }
  await page.getByRole('button', { name: 'See your result' }).click({ timeout: 20000 }).catch(() => {})
  await page.locator('section.bm-end').waitFor({ timeout: 20000 }).then(() => page.screenshot({ path: path.join(OUT, 'demo-end.png') })).catch(() => issue(page, 'demo-end', 'Demo: no end card', ''))
  await ctx.close()
}

;(async () => {
  const browser = await launch()
  for (const w of WANT) {
    try {
      await { solo, room, demo }[w](browser)
    } catch (e) {
      console.log(`RUN ERROR in ${w}:`, e.message)
      issues.push({ key: `run-${w}`, title: `The ${w} run stopped with an error`, detail: e.message.split('\n')[0], shot: null })
    }
  }
  await browser.close()
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), issues }, null, 2))
  console.log(`\n${issues.length} issue(s); report and screenshots in ${OUT}`)
})()
