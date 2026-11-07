import { useEffect, useRef, useState } from 'react'
import BatteryRound from '../game/BatteryRound.jsx'
import { connectMarket } from '../market/connection.js'

// Battery mode inside a lobby: the room game's charge / hold / discharge round, with the lobby's footer under it.
export function BatteryMode({ lobbyId, footer }) {
  const [s, setS] = useState({ status: 'connecting' })
  const api = useRef(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    api.current = connectMarket({ lobbyId, onState: (n) => setS((p) => ({ ...p, ...n })) })
    return () => api.current?.close()
  }, [lobbyId])
  const data = s.battery
  const decide = (slot, action) => {
    setError(null)
    Promise.resolve(api.current.batteryDecide(slot, action)).catch((e) => setError(e?.message || 'That did not go through. Try again.'))
  }
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '16px 16px 24px' }}>
      {error && <p role="alert" style={{ color: 'var(--hot)', fontSize: 13 }}>{error}</p>}
      {data?.round ? <BatteryRound data={data} onDecide={decide} /> : <p style={{ color: 'var(--text-2)', fontSize: 13 }}>{s.status === 'offline' ? 'The game server is out of reach.' : 'Getting the round ready…'}</p>}
      {footer}
    </div>
  )
}
