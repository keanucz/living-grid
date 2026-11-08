// #368: start the wind scene, leave the section after 3 s, check and screenshot the camera 2 s later.
const { chromium } = require(process.env.PW)
const OUT = process.env.OUT
;(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
  const cases = [['desktop', 'Now'], ['desktop', 'Forecast'], ['iphone', 'Now']]
  for (const [dev, tab] of cases) {
    const mobile = dev === 'iphone'
    const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => console.log('PAGEERR', e.message))
    await p.addInitScript(() => { try { localStorage.setItem('lg-intro-seen', '1') } catch {} })
    await p.goto(process.env.BASE + '/', { waitUntil: 'load' })
    await p.waitForTimeout(4000)
    await p.evaluate(() => { const el = [...document.querySelectorAll('.wel-t')].find((e) => e.textContent.includes('normally hidden')); if (el) (el.closest('button,a,[role=button]') || el).click(); else [...document.querySelectorAll('button,a')].find((x) => x.textContent.trim() === 'Hidden grid' && x.getClientRects().length)?.click() })
    await p.waitForTimeout(3000)
    await p.evaluate(() => [...document.querySelectorAll('.story-tile')][0].click())
    await p.waitForSelector('.scene', { timeout: 60000 })
    await p.waitForTimeout(3000)
    const v1 = await p.evaluate(() => ({ z: window.lgViewState.zoom, pitch: window.lgViewState.pitch }))
    await p.evaluate((t) => [...document.querySelectorAll('button,a')].find((x) => x.textContent.trim() === t && x.getClientRects().length)?.click(), tab)
    await p.waitForTimeout(5000)
    const v2 = await p.evaluate(() => ({ z: window.lgViewState.zoom, pitch: window.lgViewState.pitch, bearing: window.lgViewState.bearing, scene: !!document.querySelector('.scene') }))
    console.log(dev, tab, 'in scene', JSON.stringify(v1), 'after leave', JSON.stringify(v2))
    await p.screenshot({ path: `${OUT}/${dev}-${tab.toLowerCase()}.png`, timeout: 90000 })
    await ctx.close()
  }
  await b.close()
})()
