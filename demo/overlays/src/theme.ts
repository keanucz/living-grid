import { loadFont as loadGeist } from '@remotion/google-fonts/Geist'
import { loadFont as loadGeistMono } from '@remotion/google-fonts/GeistMono'
import { Easing, interpolate } from 'remotion'

// Copied (not imported) from demo/presentation/src/theme.ts: the site's near-black, white, Geist look and price scale.
export const COLORS = {
  bg: '#0a0a0a',
  panel: 'rgba(23,23,23,0.88)', // #171717 at 88%
  line: 'rgba(255,255,255,0.10)',
  line2: 'rgba(255,255,255,0.16)',
  text: '#fafafa',
  text2: '#a1a1a1',
  text3: '#737373',
} as const

export const PRICE_SCALE: [number, string][] = [
  [-50, '#7b6cf6'], [0, '#1f3b2c'], [50, '#2f6a3a'], [100, '#7fa33a'], [150, '#d0b043'], [200, '#e08a2e'], [275, '#d4502e'], [400, '#9e1f2e'],
]

const sans = loadGeist('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] })
const mono = loadGeistMono('normal', { weights: ['400', '500'], subsets: ['latin'] })
export const FONT = sans.fontFamily
export const MONO = mono.fontFamily

export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const
export const SAFE = 96
export const EASE_FRAMES = Math.round(0.4 * VIDEO.fps)

const ease = Easing.inOut(Easing.ease)

/** 0 to 1 over the first 0.4 s, 1 to 0 over the last 0.4 s. */
export function presence(frame: number, duration: number): number {
  const inn = interpolate(frame, [0, EASE_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
  const out = interpolate(frame, [duration - EASE_FRAMES, duration], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
  return Math.min(inn, out)
}

/** Count-up progress, 0 to 1, starting once the card is in. */
export function countUp(frame: number, seconds = 1.2): number {
  return interpolate(frame, [EASE_FRAMES, EASE_FRAMES + seconds * VIDEO.fps], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  })
}
