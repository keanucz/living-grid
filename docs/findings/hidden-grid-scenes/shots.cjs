const { chromium } = require(process.env.PW || 'playwright-core')
const OUT = process.env.OUT
;(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
  for (const dev of [{ n: 'desktop', vp: { width: 1440, height: 900 } }, { n: 'iphone', vp: { width: 390, height: 844 }, mobile: true }]) {
    for (const card of ['wind', 'bottleneck']) {
      const ctx = await b.newContext({ viewport: dev.vp, deviceScaleFactor: dev.mobile ? 2 : 1, isMobile: !!dev.mobile, hasTouch: !!dev.mobile })
      const p = await ctx.newPage()
      p.on('pageerror', (e) => console.log('PAGEERR', e.message))
      await p.addInitScript(() => { try { localStorage.setItem('lg-tour-done', '1'); localStorage.setItem('lg-intro-seen', '1') } catch {} })
      await p.goto(process.env.BASE + '/', { waitUntil: 'load' })
      await p.waitForTimeout(4000); await p.evaluate(() => { const el = [...document.querySelectorAll('.wel-t')].find((e) => e.textContent.includes('normally hidden')); if (el) (el.closest('button,a,[role=button]') || el).click(); else [...document.querySelectorAll('button,a')].find((b) => /hidden grid/i.test(b.textContent))?.click() }); await p.waitForTimeout(3000)
      await p.waitForTimeout(1000); const tile = p.locator('.story-tile', { hasText: card === 'wind' ? 'wind' : 'bottleneck' }).first()
      console.log(dev.n, card, 'tile', await tile.count())
      if (await tile.count() === 0) { await p.screenshot({ path: `${OUT}/${dev.n}-${card}-notile.png` }); await ctx.close(); continue }
      await tile.evaluate((e) => e.click())
      await p.evaluate(() => { window.lgSceneAt = 300 })
      for (const [name, ms] of [['start', 300], ['middle', card === 'wind' ? 6000 : 4800], ['end', 12000]]) {
        await p.evaluate((m) => { window.lgSceneAt = m }, ms)
        await p.waitForTimeout(name === 'start' ? 1500 : 3500)
        await p.screenshot({ path: `${OUT}/${dev.n}-${card}-${name}.png`, timeout: 90000 })
      }
      await p.evaluate(() => { delete window.lgSceneAt })
      console.log(dev.n, card, 'cap', await p.locator('.scene-cap').innerText().catch(() => 'none'), '|', await p.locator('.scene-num').innerText().catch(() => 'none'))
      await ctx.close()
    }
  }
  await b.close()
})()
