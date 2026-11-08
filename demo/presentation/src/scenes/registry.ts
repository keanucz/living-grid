import type React from 'react'
import { Built, Close, Hook, How, Problem, Product, Proof } from './Scenes'

// The deck as a list of scenes, in order. The Remotion Deck composition plays them back to back; the Player page shows one
// scene at a time and advances on a click. Durations are seconds at 30 fps (10, 26, 11, 27, 27, 5, 10: 116 s).
export type SceneDef = { id: string; title: string; seconds: number; Component: React.FC }

export const SCENES: SceneDef[] = [
  { id: 'hook', title: 'Electricity is invisible', seconds: 10, Component: Hook },
  { id: 'problem', title: 'Why prices move', seconds: 26, Component: Problem },
  { id: 'built', title: 'Could we have seen it coming?', seconds: 11, Component: Built },
  { id: 'product', title: 'The app', seconds: 27, Component: Product },
  { id: 'proof', title: 'Proof', seconds: 27, Component: Proof },
  { id: 'how', title: 'How we built it', seconds: 5, Component: How },
  { id: 'close', title: 'Try it', seconds: 10, Component: Close },
]

export const FPS = 30
export const frames = (s: SceneDef) => Math.round(s.seconds * FPS)
export const TOTAL_FRAMES = SCENES.reduce((n, s) => n + frames(s), 0)
