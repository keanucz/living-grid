import type React from 'react'
import { Built, Close, Hook, How, Problem, Product, Proof } from './Scenes'

// The deck as a list of scenes, in order. The Remotion Deck composition plays them back to back; the Player page shows one
// scene at a time and advances on a click. Durations are seconds at 30 fps (15, 20, 20, 65, 34, 8, 18: 180 s).
export type SceneDef = { id: string; title: string; seconds: number; Component: React.FC }

export const SCENES: SceneDef[] = [
  { id: 'hook', title: 'Electricity is invisible', seconds: 15, Component: Hook },
  { id: 'problem', title: 'The problem', seconds: 20, Component: Problem },
  { id: 'built', title: 'What we built', seconds: 20, Component: Built },
  { id: 'product', title: 'The product', seconds: 65, Component: Product },
  { id: 'proof', title: 'Proof', seconds: 34, Component: Proof },
  { id: 'how', title: 'How we built it', seconds: 8, Component: How },
  { id: 'close', title: 'Check it yourself', seconds: 18, Component: Close },
]

export const FPS = 30
export const frames = (s: SceneDef) => Math.round(s.seconds * FPS)
export const TOTAL_FRAMES = SCENES.reduce((n, s) => n + frames(s), 0)
