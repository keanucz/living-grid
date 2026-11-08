// Writes the QR code for the site as a module matrix into src/qr.json, using the web app's `qrcode` package, so the deck
// needs no extra dependency. Run from this folder: node scripts/qr.mjs [url]
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(process.env.WEB_DIR ? resolve(process.env.WEB_DIR, 'package.json') : resolve(here, '../../../web/package.json'))
const QRCode = require('qrcode')
const url = process.argv[2] ?? 'https://htb.stefvuck.dev'
const q = QRCode.create(url, { errorCorrectionLevel: 'M' })
writeFileSync(resolve(here, '../src/qr.json'), JSON.stringify({ url, size: q.modules.size, data: Array.from(q.modules.data) }))
console.log(url, q.modules.size)
