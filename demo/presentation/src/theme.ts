import { loadFont as loadGeist } from '@remotion/google-fonts/Geist'
import { loadFont as loadGeistMono } from '@remotion/google-fonts/GeistMono'

// The site's look (web/src/styles/app.css, final monochrome pass): near-black, white accent, Geist and Geist Mono,
// and the one fixed price scale used on the map (web/src/styles/tokens.js).
export const COLORS = {
  bg: '#0a0a0a',
  bg2: '#0f0f0f',
  panel: '#171717',
  card: '#1f1f1f',
  card2: '#262626',
  line: 'rgba(255,255,255,0.10)',
  line2: 'rgba(255,255,255,0.16)',
  text: '#fafafa',
  text2: '#a1a1a1',
  text3: '#737373',
  accent: '#fafafa',
  ink: '#0a0a0a',
  soft: '#d4d4d4',
} as const

export const PRICE_SCALE: [number, string][] = [
  [-50, '#7b6cf6'], [0, '#1f3b2c'], [50, '#2f6a3a'], [100, '#7fa33a'], [150, '#d0b043'], [200, '#e08a2e'], [275, '#d4502e'], [400, '#9e1f2e'],
]

export function priceColor(v: number): string {
  if (v <= PRICE_SCALE[0][0]) return PRICE_SCALE[0][1]
  for (let i = 1; i < PRICE_SCALE.length; i++) if (v <= PRICE_SCALE[i][0]) return PRICE_SCALE[i][1]
  return PRICE_SCALE[PRICE_SCALE.length - 1][1]
}

const sans = loadGeist('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] })
const mono = loadGeistMono('normal', { weights: ['400', '500'], subsets: ['latin'] })
export const FONT = sans.fontFamily
export const MONO = mono.fontFamily

export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const
