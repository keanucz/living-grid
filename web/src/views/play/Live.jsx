import { useEffect, useRef, useState } from 'react'
import { BeatRound } from './Round.jsx'
import { useBeat } from './useBeat.js'

// The live screens: solo (starts its own game) and room (the lobby started it). Both read the same game through useBeat.
function useRun() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const run = (fn) => {
    setBusy(true)
    setError(null)
    return Promise.resolve()
      .then(fn)
      .catch((e) => setError(e?.message || 'That did not go through. Try again.'))
      .finally(() => setBusy(false))
  }
  return { busy, error, run }
}

const waiting = (status, error, text) => (
  <div className="bm" style={{ maxWidth: 520, margin: '0 auto', padding: 24 }}>
    <p className="bm-muted">{status === 'offline' ? 'The game server is out of reach. Check the Wi-Fi and reload.' : text}</p>
    {error && <p role="alert" style={{ color: '#ff8a1f', fontSize: 13 }}>{error}</p>}
  </div>
)

export function BeatSolo({ name, avatar, onExit }) {
  const beat = useBeat()
  const { busy, error, run } = useRun()
  const baseline = useRef(null) // game id present before this session started one
  const started = useRef(false)
  useEffect(() => {
    if (beat.status !== 'live') return
    if (!started.current) {
      started.current = true
      baseline.current = beat.gameId ?? 0
      run(() => beat.start(name, avatar))
    }
  }, [beat.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = beat.gameId != null && beat.gameId > (baseline.current ?? 0)
  if (!fresh) return waiting(beat.status, error, 'Getting your first call ready…')
  return (
    <BeatRound
      model={beat.model}
      busy={busy}
      error={error}
      onAnswer={(o, c) => run(() => beat.answer(o, c))}
      onAgain={() => {
        baseline.current = beat.gameId
        run(() => beat.start(name, avatar))
      }}
      onLeave={onExit}
    />
  )
}

export function BeatRoom({ lobbyId, footer }) {
  const beat = useBeat({ lobbyId })
  const { busy, error, run } = useRun()
  if (beat.model.status === 'idle') return waiting(beat.status, error, 'Getting the first call ready…')
  return <BeatRound model={beat.model} busy={busy} error={error} onAnswer={(o, c) => run(() => beat.answer(o, c))} onAgain={null} onLeave={null} footer={footer} />
}
