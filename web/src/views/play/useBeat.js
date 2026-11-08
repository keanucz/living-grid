import { useEffect, useMemo, useRef, useState } from 'react'
import { readBeat, toModel } from './adapter.js'
import { connectBeat } from './connection.js'

// Live state of the player's Beat the model game (solo: lobbyId null; in a room: that lobby's game), as the UI model,
// plus the actions. `picks` remembers what this device sent for the open call; the reveal timer starts when the
// reveal is first seen here (the module does not stamp it).
export function useBeat({ lobbyId = null } = {}) {
  const [snap, setSnap] = useState({ status: 'connecting' })
  const [picks, setPicks] = useState({})
  const [seen, setSeen] = useState({})
  const api = useRef(null)
  useEffect(() => {
    api.current = connectBeat({ onState: (s) => setSnap(s) })
    return () => api.current?.close()
  }, [])
  const raw = useMemo(() => (snap.conn && snap.me ? readBeat(snap.conn, snap.me, lobbyId) : null), [snap, lobbyId])
  const key = raw?.game ? `${raw.game.id}|${raw.game.callNo}` : null
  const revealing = raw?.game?.state === 'revealing'
  useEffect(() => {
    if (revealing && key && !seen[key]) setSeen((s) => ({ ...s, [key]: Date.now() }))
  }, [revealing, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const model = useMemo(() => toModel(raw, { picks, seenReveal: seen[key] }), [raw, picks, seen, key])
  return {
    status: snap.status,
    model,
    gameId: raw?.game?.id ?? null,
    start: (name, avatar) => api.current.start(name, avatar),
    answer: async (option, confidence) => {
      const g = raw.game
      await api.current.answer(g.id, g.callNo, option, confidence)
      setPicks((p) => ({ ...p, [`${g.id}|${g.callNo}`]: { option, confidence } }))
    },
  }
}
