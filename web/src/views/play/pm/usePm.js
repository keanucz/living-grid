import { useMemo, useRef, useState, useEffect } from 'react'
import { connectPm } from '../connection.js'
import { readPm, toPmModel } from './adapter.js'

// Live state of the player's solo markets game as the UI model, plus the actions. Trade errors from the module (not
// enough points, market closed) come back as rejected promises with its message.
export function usePm({ lobbyId = null } = {}) {
  const [snap, setSnap] = useState({ status: 'connecting' })
  const api = useRef(null)
  useEffect(() => {
    api.current = connectPm({ onState: (s) => setSnap(s) })
    return () => api.current?.close()
  }, [])
  const raw = useMemo(() => (snap.conn && snap.me ? readPm(snap.conn, snap.me, lobbyId) : null), [snap, lobbyId])
  const model = useMemo(() => toPmModel(raw), [raw])
  return {
    status: snap.status,
    model,
    gameId: raw?.game?.id ?? null,
    start: (name, avatar) => api.current.pmStart(name, avatar),
    leave: () => (raw?.game ? api.current.pmLeave(raw.game.id) : Promise.resolve()),
    trade: (action, marketId, side, shares) => (action === 'buy' ? api.current.pmBuy(raw.game.id, marketId, side, shares) : api.current.pmSell(raw.game.id, marketId, side, shares)),
  }
}
