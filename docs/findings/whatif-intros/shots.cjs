// #374: press each What if card and screenshot its intro mid-animation (clock pinned with window.lgIntroAt).
// A fresh page per card: the software-rendered map is too slow to carry on after a screenshot.
const { chromium } = require(process.env.PW)
const OUT = process.env.OUT
const ONLY = process.env.ONLY
const CARDS = [['hormuz', 'Gas gets dearer'], ['cable', 'cable to Norway'], ['france', 'France loses'], ['storm', 'storm hits Scotland']]
;(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
  for (const dev of ['desktop', 'iphone']) {
    const mobile = dev === 'iphone'
    for (const [id, text] of CARDS) {
      if (ONLY && !ONLY.split(',').includes(id)) continue
      const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
      const p = await ctx.newPage()
      p.on('pageerror', (e) => console.log('PAGEERR', e.message))
      await p.addInitScript(() => { try { localStorage.setItem('lg-intro-seen', '1') } catch {} })
      await p.goto(process.env.BASE + '/', { waitUntil: 'load' })
      await p.waitForTimeout(4000)
      await p.evaluate(() => [...document.querySelectorAll('button,a')].find((x) => /skip, show me the map/i.test(x.textContent))?.click())
      await p.waitForTimeout(1500)
      await p.evaluate(() => [...document.querySelectorAll('button,a')].find((x) => x.textContent.trim() === 'What if' && x.getClientRects().length)?.click())
      await p.waitForSelector('.wi-card', { timeout: 60000 })
      await p.waitForTimeout(3000)
      await p.evaluate(() => { window.lgIntroAt = 900 })
      await p.evaluate((t) => [...document.querySelectorAll('.wi-card')].find((x) => x.textContent.includes(t))?.click(), text)
      await p.waitForSelector('.wi-intro', { timeout: 20000 })
      await p.waitForTimeout(2500)
      console.log(dev, id, 'caption:', await p.locator('.wi-intro-cap').innerText().catch(() => 'none'))
      await p.screenshot({ path: `${OUT}/${dev}-${id}.png`, timeout: 90000 })
      await ctx.close()
    }
  }
  await b.close()
})()
