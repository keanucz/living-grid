// Record the autoplay tour to MP4 and a GIF thumbnail, so the fallback video always matches the live product.
//
//   node demo/record/record.mjs --tour g-research [--base https://htb.stefvuck.dev] [--out demo/record/out]
//        [--size 1920x1080] [--loops 1] [--phone]
//
// Tours are web/src/tour/tours.js (main, g-research, hrt). The recording starts when the first caption appears and
// ends after one pass over the step durations. Needs: playwright-core (set PLAYWRIGHT_NODE_MODULES to a folder that
// has it), a Chromium (CHROME=/path/to/chrome, else Playwright's own), and an ffmpeg with libx264 (FFMPEG=/path,
// else `uv run --with imageio-ffmpeg`). No sudo needed. Run it from the VPS; it only reads the public site.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] == null ? true : process.argv[i + 1]) }
const here = dirname(fileURLToPath(import.meta.url))
const tourName = arg('tour', 'g-research')
const base = String(arg('base', 'https://htb.stefvuck.dev')).replace(/\/$/, '')
const out = resolve(String(arg('out', join(here, 'out'))))
const [W, H] = (arg('size', arg('phone', false) ? '390x844' : '1920x1080')).split('x').map(Number)
const loops = Number(arg('loops', 1))

const req = createRequire(join(process.env.PLAYWRIGHT_NODE_MODULES ?? join(here, '../../web/node_modules'), 'x.js'))
const { chromium } = req('playwright-core')
const { TOURS } = await import(pathToFileURL(resolve(here, '../../web/src/tour/tours.js')))
const tour = TOURS[tourName]
if (!tour) throw new Error(`unknown tour "${tourName}" (have: ${Object.keys(TOURS).join(', ')})`)
const seconds = tour.steps.reduce((a, s) => a + (s.duration ?? 8), 0) * loops

function ffmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg' } catch { /* fall through */ }
  return execFileSync('uv', ['run', '--no-project', '--with', 'imageio-ffmpeg', 'python', '-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim()
}

mkdirSync(out, { recursive: true })
const tmp = join(out, `.rec-${tourName}`)
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: !!arg('phone', false), hasTouch: !!arg('phone', false) })
const page = await ctx.newPage()
page.setDefaultTimeout(180000)

// Playwright's own recorder needs a VP8 ffmpeg that the no-sudo install lacks, so frames come from the CDP screencast
// and are stitched with their real timestamps (the page may render slowly; the video keeps wall-clock time).
const cdp = await ctx.newCDPSession(page)
const frames = []
let recording = false
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  if (recording) {
    const file = join(tmp, `f${String(frames.length).padStart(6, '0')}.jpg`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    frames.push({ file, t: metadata.timestamp })
  }
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
const t0 = Date.now()
await page.goto(`${base}/#tour=${tourName}&autoplay`, { waitUntil: 'commit' })
await page.locator('.tour-card').waitFor()
console.log(`first caption after ${((Date.now() - t0) / 1000).toFixed(1)} s; recording ${seconds} s of ${tour.steps.length} steps`)
recording = true
await page.waitForTimeout(seconds * 1000 + 1500)
recording = false
await cdp.send('Page.stopScreencast').catch(() => {})
await browser.close()
if (frames.length < 2) throw new Error('no frames captured')

const list = join(tmp, 'frames.txt')
writeFileSync(list, frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.04, (frames[i + 1]?.t ?? f.t + 0.5) - f.t).toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`)
const mp4 = join(out, `living-grid-${tourName}.mp4`)
const gif = join(out, `living-grid-${tourName}.gif`)
const ff = ffmpeg()
const scale = `scale=trunc(iw/2)*2:trunc(ih/2)*2`
execFileSync(ff, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=25,${scale}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'medium', '-movflags', '+faststart', '-an', mp4], { stdio: 'ignore' })
execFileSync(ff, ['-y', '-i', mp4, '-t', '9', '-vf', 'fps=8,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', gif], { stdio: 'ignore' })
console.log(`${frames.length} frames\nwrote ${mp4}\nwrote ${gif}`)
if (!process.env.KEEP_FRAMES) rmSync(tmp, { recursive: true, force: true })
