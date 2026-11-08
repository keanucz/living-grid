import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Player, type PlayerRef } from '@remotion/player'
import { SCENES, frames } from '../src/scenes/registry'
import { VIDEO } from '../src/theme'

// Live presenter: shows one scene at a time in the Remotion Player and waits at the end of each scene.
// Click, Space or the right arrow go to the next scene, the left arrow to the previous one, Home restarts, F is full screen.
// ?scene=proof opens at a scene.
function startIndex(): number {
  const id = new URLSearchParams(location.search).get('scene')
  const i = SCENES.findIndex((s) => s.id === id)
  return i >= 0 ? i : 0
}

function App() {
  const [i, setI] = useState(startIndex)
  const [ended, setEnded] = useState(false)
  const ref = useRef<PlayerRef>(null)
  const scene = SCENES[i]

  const go = useCallback((d: number) => {
    setEnded(false)
    setI((x) => Math.min(SCENES.length - 1, Math.max(0, x + d)))
  }, [])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') (e.preventDefault(), go(1))
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1)
      else if (e.key === 'Home') (setEnded(false), setI(0))
      else if (e.key === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [go])

  useEffect(() => {
    const p = ref.current
    if (!p) return
    const done = () => setEnded(true)
    p.addEventListener('ended', done)
    return () => p.removeEventListener('ended', done)
  }, [i])

  return (
    <div onClick={() => go(1)} style={{ height: '100%', display: 'grid', placeItems: 'center', cursor: 'pointer', position: 'relative' }}>
      <div style={{ width: 'min(100vw, calc(100vh * 16 / 9))', aspectRatio: '16 / 9' }}>
        <Player
          ref={ref}
          key={scene.id}
          component={scene.Component}
          durationInFrames={frames(scene)}
          compositionWidth={VIDEO.width}
          compositionHeight={VIDEO.height}
          fps={VIDEO.fps}
          controls={false}
          autoPlay
          loop={false}
          clickToPlay={false}
          acknowledgeRemotionLicense
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center', fontSize: 12, color: '#737373' }}>
        {SCENES.map((s, k) => (
          <span key={s.id} title={s.title} style={{ width: k === i ? 22 : 8, height: 8, borderRadius: 4, background: k === i ? '#fafafa' : k < i ? '#737373' : '#262626', transition: 'width .2s' }} />
        ))}
        <span style={{ marginLeft: 10 }}>{i + 1} / {SCENES.length} · {scene.title}{ended && i < SCENES.length - 1 ? ' · click for next' : ''}{ended && i === SCENES.length - 1 ? ' · the end' : ''}</span>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
