import { useEffect, useState } from 'react'
import { connectMarket } from '../../views/market/connection.js'
import { BotLeagueCard } from './Card.jsx'

// Main-screen panel: the bot league while a mystery-day round is on and after it ends. It opens its own light
// connection (market tables only) and renders nothing when there is no round, or the server is unreachable.
function BotLeague() {
  const [s, setS] = useState(null)
  useEffect(() => {
    if (import.meta.env?.VITE_LG_OFFLINE === '1' || typeof WebSocket === 'undefined') return
    const c = connectMarket({ withToken: false, onState: (n) => setS((p) => ({ ...p, ...n })) })
    return () => c.close()
  }, [])
  if (!s?.round || !s.bots?.length) return null
  return (
    <div className="panel botleague fade-in" style={{ width: 560, padding: 0, overflow: 'hidden' }}>
      <BotLeagueCard round={s.round} bots={s.bots} />
      <style>{'.botleague .bl-card { margin: 0; border: 0; background: transparent; }'}</style>
    </div>
  )
}

export default { id: 'botLeague', slot: 'bottomRight', order: 7, modes: ['overview'], Component: BotLeague }
