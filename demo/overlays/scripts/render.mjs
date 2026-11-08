// Renders every overlay for the editor, on the Mac (not on the VPS). Usage:
//   node scripts/render.mjs mov|webm|png [Id ...]
// mov:  ProRes 4444 with alpha, one file per composition in out/mov/
// webm: VP9 with alpha (yuva420p), in out/webm/
// png:  one transparent still per composition at its fully-in frame, in out/png/
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const list = JSON.parse(readFileSync(resolve(root, 'src/list.json'), 'utf8'))
const [kind, ...only] = process.argv.slice(2)
const pick = only.length ? list.filter((x) => only.includes(x.id)) : list

const FLAGS = {
  mov: (id) => ['render', 'src/index.ts', id, `out/mov/${id}.mov`, '--codec=prores', '--prores-profile=4444', '--pixel-format=yuva444p10le', '--image-format=png'],
  webm: (id) => ['render', 'src/index.ts', id, `out/webm/${id}.webm`, '--codec=vp9', '--pixel-format=yuva420p', '--image-format=png'],
  png: (id, still) => ['still', 'src/index.ts', id, `out/png/${id}.png`, `--frame=${still}`, '--image-format=png'],
}
if (!FLAGS[kind]) {
  console.error('usage: node scripts/render.mjs mov|webm|png [Id ...]')
  process.exit(2)
}
mkdirSync(resolve(root, 'out', kind), { recursive: true })
for (const { id, still } of pick) {
  console.log(`\n== ${kind} ${id}`)
  const r = spawnSync('npx', ['remotion', ...FLAGS[kind](id, still)], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
