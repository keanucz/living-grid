// The VIEWER's tool in the deck review loop. For each scene of the deck it renders stills at 25%, 60% and 95% of the scene
// (1280x720), a contact sheet with every scene in order, and frames.md listing, per scene, its time range, the text on screen
// and every number shown, with whether that number can be found in data/snapshot.json.
//
//   node scripts/review-stills.mjs --round 1 [--commit <sha>]     -> review/round-1/
//   node scripts/review-stills.mjs --final                          -> out/living-grid.mp4, .gif and poster
//
// Run it at low priority:  nice -n 15 node scripts/review-stills.mjs --round 1   (the final render at nice -n 19).
// Chromium needs libatk and friends; on the VPS the no-sudo libs are used when LD_LIBRARY_PATH is not already set.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`)
  return i < 0 ? dflt : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true
}
const ROUND = flag('round')
const FINAL = flag('final') === true
const COMMIT = flag('commit')
const PCTS = String(flag('pcts', '25,60,95')).split(',').map(Number)
const WIDTH = Number(flag('width', 1280))
if (!FINAL && !ROUND) {
  console.error('usage: review-stills.mjs --round N [--commit sha] | --final')
  process.exit(2)
}

const QA_LIBS = '/tmp/claude-1000/-home-stefan/61654a43-7faf-52a5-9243-845e763c889c/scratchpad/debs/root/usr/lib/x86_64-linux-gnu'
if (!process.env.LD_LIBRARY_PATH && existsSync(QA_LIBS)) process.env.LD_LIBRARY_PATH = QA_LIBS

let PROJECT = resolve(here, '..')
let tmpTree = null
if (COMMIT) {
  // Render a specific commit (the creator's round) in a throwaway worktree that shares this project's node_modules.
  const repo = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: PROJECT, encoding: 'utf8' }).stdout.trim()
  tmpTree = join(os.tmpdir(), `deck-review-${String(COMMIT).slice(0, 8)}-${process.pid}`)
  const r = spawnSync('git', ['worktree', 'add', '--detach', tmpTree, COMMIT], { cwd: repo, encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(r.stderr)
    process.exit(1)
  }
  const sub = join(tmpTree, 'demo', 'presentation')
  symlinkSync(join(PROJECT, 'node_modules'), join(sub, 'node_modules'))
  PROJECT = sub
}
const REVIEW_OUT = resolve(here, '..', 'review', `round-${ROUND}`)
const requireFromProject = createRequire(join(PROJECT, 'package.json'))
const { bundle } = await import(requireFromProject.resolve('@remotion/bundler'))
const R = await import(requireFromProject.resolve('@remotion/renderer'))
const { renderStill, renderMedia, selectComposition, getCompositions, openBrowser } = R

const compositorDir = dirname(requireFromProject.resolve('@remotion/compositor-linux-x64-gnu/package.json'))
const tool = (name, toolArgs, input) =>
  spawnSync(join(compositorDir, name), toolArgs, { encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: `${compositorDir}:${process.env.LD_LIBRARY_PATH ?? ''}` }, input, maxBuffer: 1 << 26 })

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const cleanup = () => {
  if (tmpTree) spawnSync('git', ['worktree', 'remove', '--force', tmpTree], { cwd: PROJECT })
}
process.on('exit', cleanup)

log('bundling', PROJECT)
const serveUrl = await bundle({ entryPoint: join(PROJECT, 'src', 'index.ts'), rootDir: PROJECT })
const comps = (await getCompositions(serveUrl)).filter((c) => c.id.startsWith('Scene-'))
if (!comps.length) throw new Error('no Scene-* compositions found')
const FPS = comps[0].fps

// ---------------------------------------------------------------------------------------------------------------- final
if (FINAL) {
  const out = resolve(here, '..', 'out')
  mkdirSync(out, { recursive: true })
  const deck = await selectComposition({ serveUrl, id: 'Deck' })
  log(`rendering Deck: ${deck.durationInFrames} frames (${(deck.durationInFrames / deck.fps).toFixed(1)} s)`)
  let lastPct = -1
  await renderMedia({
    composition: deck, serveUrl, codec: 'h264', outputLocation: join(out, 'living-grid.mp4'), concurrency: 2,
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 10)
      if (p !== lastPct) (lastPct = p, log(`render ${p * 10}%`))
    },
  })
  await renderStill({ composition: deck, serveUrl, frame: Math.round(deck.fps * 2), output: join(out, 'poster.png'), scale: 0.6667 })
  tool('ffmpeg', ['-y', '-i', join(out, 'living-grid.mp4'), '-t', '12', '-vf', 'fps=8,scale=640:-1:flags=lanczos', join(out, 'living-grid.gif')])
  const probe = tool('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', join(out, 'living-grid.mp4')])
  log('ffprobe', probe.stdout.replace(/\s+/g, ' '))
  process.exit(0)
}

// ---------------------------------------------------------------------------------------------------------------- stills
mkdirSync(REVIEW_OUT, { recursive: true })
const browser = await openBrowser('chrome', { chromiumOptions: {}, chromeMode: 'headless-shell' })
const scenes = []
let startFrame = 0
for (const c of comps) {
  const composition = await selectComposition({ serveUrl, id: c.id, puppeteerInstance: browser })
  const id = c.id.replace(/^Scene-/, '')
  const stills = []
  for (const pct of PCTS) {
    const frame = Math.min(composition.durationInFrames - 1, Math.floor((pct / 100) * composition.durationInFrames))
    const file = `${id}-${pct}.png`
    await renderStill({ composition, serveUrl, frame, output: join(REVIEW_OUT, file), scale: WIDTH / composition.width, imageFormat: 'png', puppeteerInstance: browser })
    stills.push({ pct, frame, file, sec: frame / FPS })
    log(`still ${file}`)
  }
  scenes.push({ id, frames: composition.durationInFrames, start: startFrame, stills })
  startFrame += composition.durationInFrames
}
await browser.close({ silent: true })

// ------------------------------------------------------------------------------------------------------------ contact sheet
// Remotion's ffmpeg has no tile filter and its page has no screenshot call, so the sheet is one more Remotion still:
// a throwaway composition that lays the stills out in a grid (images come in through the public dir).
{
  const entry = join(PROJECT, 'review', `.contact-entry-${process.pid}.tsx`)
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(entry, `import React from 'react'
import { AbsoluteFill, Composition, Img, registerRoot, staticFile } from 'remotion'
const TW = 640, TH = 360, G = 6
const Sheet: React.FC<{ scenes: { id: string; files: { file: string; pct: number }[] }[] }> = ({ scenes }) => (
  <AbsoluteFill style={{ background: '#0a0a0a', padding: G, fontFamily: 'system-ui', color: '#fafafa' }}>
    {scenes.map((s) => (
      <div key={s.id} style={{ display: 'flex', gap: G, marginBottom: G }}>
        {s.files.map((f, i) => (
          <div key={f.file} style={{ position: 'relative', width: TW, height: TH }}>
            <Img src={staticFile(f.file)} style={{ width: TW, height: TH, display: 'block' }} />
            {i === 0 && <span style={{ position: 'absolute', left: 10, top: 8, background: '#0a0a0acc', padding: '3px 10px', borderRadius: 4, fontSize: 24, fontWeight: 600 }}>{s.id}</span>}
            <span style={{ position: 'absolute', right: 10, bottom: 8, background: '#0a0a0acc', padding: '2px 8px', borderRadius: 4, fontSize: 18 }}>{f.pct}%</span>
          </div>
        ))}
      </div>
    ))}
  </AbsoluteFill>
)
registerRoot(() => <Composition id="Sheet" component={Sheet} width={${PCTS.length} * 640 + ${PCTS.length + 1} * 6} height={${scenes.length} * 366 + 6} fps={30} durationInFrames={1} defaultProps={{ scenes: [] }} />)
`)
  try {
    const sheetUrl = await bundle({ entryPoint: entry, rootDir: PROJECT, publicDir: REVIEW_OUT })
    const inputProps = { scenes: scenes.map((s) => ({ id: s.id, files: s.stills.map((x) => ({ file: x.file, pct: x.pct })) })) }
    const comp = await selectComposition({ serveUrl: sheetUrl, id: 'Sheet', inputProps })
    await renderStill({ composition: comp, serveUrl: sheetUrl, frame: 0, inputProps, output: join(REVIEW_OUT, 'contact-sheet.png'), imageFormat: 'png' })
    log(`contact sheet ${PCTS.length}x${scenes.length}`)
  } catch (e) {
    log('contact sheet failed:', String(e.message ?? e).slice(0, 200))
  } finally {
    rmSync(entry, { force: true })
  }
}

// ------------------------------------------------------------------------------------------------------ on-screen text (DOM)
// The live Player (dist) renders the same components as DOM, so the text can be read exactly as shown.
const dist = join(os.tmpdir(), `deck-player-${process.pid}`)
const vite = spawnSync('npx', ['vite', 'build', '--config', 'player/vite.config.ts', '--outDir', dist, '--emptyOutDir'], { cwd: PROJECT, encoding: 'utf8' })
if (vite.status !== 0) log('player build failed:', vite.stderr.slice(-300))
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const _unused = () => `<!doctype html><body style="margin:0;background:#0a0a0a;color:#fafafa;font:600 22px system-ui">
<div style="display:grid;grid-template-columns:repeat(${PCTS.length},640px);gap:6px;padding:6px;width:max-content">
${scenes.map((s) => s.stills.map((x, i) => `<div style="position:relative"><img src="/img/${x.file}" width="640" height="360" style="display:block">${i === 0 ? `<span style="position:absolute;left:10px;top:8px;background:#0a0a0acc;padding:3px 10px;border-radius:4px">${s.id}</span>` : ''}<span style="position:absolute;right:10px;bottom:8px;background:#0a0a0acc;padding:2px 8px;border-radius:4px;font-size:16px">${x.pct}%</span></div>`).join('')).join('')}
</div></body>`
const server = createServer((req, res) => {
  const url = req.url.split('?')[0]
  if (url.startsWith('/img/')) {
    const f = join(REVIEW_OUT, url.slice(5))
    return existsSync(f) ? (res.writeHead(200, { 'content-type': 'image/png' }), res.end(readFileSync(f))) : (res.writeHead(404), res.end())
  }
  const p = join(dist, url === '/' ? 'index.html' : url)
  if (!p.startsWith(dist) || !existsSync(p) || statSync(p).isDirectory()) return (res.writeHead(404), res.end())
  res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' })
  res.end(readFileSync(p))
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const port = server.address().port
const textBrowser = await openBrowser('chrome', { chromiumOptions: {}, chromeMode: 'headless-shell' })
for (const s of scenes) {
  s.text = ''
  try {
    const page = await textBrowser.newPage({ context: () => null, logLevel: 'error', indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => undefined })
    const last = s.stills[s.stills.length - 1].frame
    await page.goto({ url: `http://127.0.0.1:${port}/?scene=${s.id}&frame=${last}&still=1`, timeout: 60000 })
    await new Promise((r) => setTimeout(r, 2500))
    s.text = await page.evaluate(() => (document.querySelector('#root > div > div')?.innerText ?? '').trim())
    await page.close({ silent: true })
  } catch (e) {
    s.text = `(could not read the scene text: ${String(e.message ?? e).slice(0, 80)})`
  }
}
await textBrowser.close({ silent: true })
server.close()
rmSync(dist, { recursive: true, force: true })

// ---------------------------------------------------------------------------------------------------------------- frames.md
const snapshot = JSON.parse(readFileSync(join(PROJECT, 'data', 'snapshot.json'), 'utf8'))
const leaves = []
;(function walk(o) {
  if (typeof o === 'number' && Number.isFinite(o)) leaves.push(Math.abs(o))
  else if (Array.isArray(o)) o.forEach(walk)
  else if (o && typeof o === 'object') Object.values(o).forEach(walk)
})(snapshot)
const close = (a, b) => Math.abs(a - b) <= Math.max(0.51 * Math.pow(10, -decimals(a)), Math.abs(b) * 0.006)
const decimals = (x) => (String(x).includes('.') ? String(x).split('.')[1].length : 0)
const SCALE = { bn: 1e9, m: 1e6, k: 1e3 }
function numbers(text) {
  const out = []
  const body = text.split('\n').filter((l) => !/^(Source:|The Living Grid$|THE LIVING GRID$)/.test(l)).join('\n')
  const seen = new Set()
  for (const m of body.matchAll(/(?<![A-Za-z\d])([£€$])?(\d[\d,]*(?:\.\d+)?)\s?(bn|m|k|%|g|GWh|MWh|GW|MW|s|days?|h)?/g)) {
    const raw = m[0].trim()
    let v = Number(m[2].replace(/,/g, ''))
    if (!Number.isFinite(v)) continue
    if (m[3] && SCALE[m[3]] && m[1]) v *= SCALE[m[3]]
    if (seen.has(raw)) continue
    seen.add(raw)
    out.push({ raw, v, unit: m[3] ?? '', money: !!m[1] })
  }
  return out
}
function traced(n) {
  const tries = [1, 100, 1 / 24, 1000, 1 / 1000, 1e6, 1 / 1e6, 1 / 1e3, 24]
  const years = n.v >= 1900 && n.v <= 2100 && Number.isInteger(n.v)
  if (years) return 'year'
  return tries.some((k) => leaves.some((L) => close(n.v, L * k))) ? 'yes' : 'NO'
}
const mmss = (f) => `${Math.floor(f / FPS / 60)}:${String(Math.floor((f / FPS) % 60)).padStart(2, '0')}`
const lines = [
  `# Deck review: round ${ROUND}`,
  '',
  `Stills of every scene at ${PCTS.join('%, ')}% of its length (${WIDTH}px wide), in \`contact-sheet.png\` (one row per scene, left to right ${PCTS.join('% / ')}%).`,
  `Snapshot taken ${snapshot.generated_at}. "Traced" says whether the number can be found in \`data/snapshot.json\` (as is, as a percentage, per hour or in thousands or millions); NO means check it, it may be derived or typed by hand.`,
  '',
]
for (const s of scenes) {
  lines.push(`## ${s.id}: ${mmss(s.start)} to ${mmss(s.start + s.frames)} (${(s.frames / FPS).toFixed(0)} s)`, '')
  lines.push(s.stills.map((x) => `[${x.pct}%](${x.file}) at ${x.sec.toFixed(1)} s`).join(' · '), '')
  lines.push('On screen at the end of the scene:', '', ...(s.text || '(nothing)').split('\n').filter(Boolean).map((l) => `> ${l}`), '')
  const nums = numbers(s.text || '')
  if (nums.length) lines.push('| Number shown | Traced to snapshot.json |', '|---|---|', ...nums.map((n) => `| ${n.raw} | ${traced(n)} |`), '')
}
writeFileSync(join(REVIEW_OUT, 'frames.md'), lines.join('\n'))
log(`wrote ${REVIEW_OUT}`)
process.exit(0)
