import { useEffect, useRef, useState } from 'react'
import { useNow } from '../hooks.js'
import { MarketCard } from './MarketCard.jsx'
import { PmEnd } from './PmEnd.jsx'
import { Positions } from './Positions.jsx'
import { TradeSheet } from './TradeSheet.jsx'
import { hh, pts, signedPts } from './format.js'
import { CSS } from './pmStyles.js'

// The market feed, phone first: a header with the game clock and your equity, how you stand against the bots, the markets
// (open ones first, resolved ones after, each with its reveal), your positions, and a trade sheet. Pure: it reads the UI
// model (adapter.js) and calls onTrade(action, marketId, side, shares).
function Header({ model }) {
  const now = useNow(500)
  const { game, me } = model
  const left = game.nextTickAt ? Math.max(0, Math.ceil((game.nextTickAt - now) / 1000)) : null
  const total = Math.max(1, game.endHour - game.startHour)
  const frac = Math.min(1, Math.max(0, (game.clockHour - game.startHour) / total))
  return (
    <header className="pm-head">
      <div className="pm-clock">
        <span className="pm-l">Game clock</span>
        <b className="num">{hh(game.clockHour)}</b>
        {left != null && model.status === 'running' && <small className="num">next hour in {left}s</small>}
      </div>
      <div className="pm-eq">
        <span className="pm-l">Your equity</span>
        <b className="num">{pts(me.equity)}</b>
        <small className={`num ${me.pnl > 0 ? 'up' : me.pnl < 0 ? 'down' : ''}`}>{signedPts(me.pnl)} · cash {pts(me.cash)}</small>
      </div>
      <div className="pm-bar" role="progressbar" aria-valuemin={game.startHour} aria-valuemax={game.endHour} aria-valuenow={game.clockHour}><i style={{ width: `${frac * 100}%` }} /></div>
    </header>
  )
}

function Standings({ standings }) {
  return (
    <ul className="pm-stand" aria-label="Profit so far">
      {standings.map((s) => (
        <li key={s.id} className={`${s.isMe ? 'me' : ''}`}>
          <span>{s.isMe ? 'You' : s.name}{s.isBot && <small className="pm-tag">bot</small>}</span>
          <b className={`num ${s.pnl > 0 ? 'up' : s.pnl < 0 ? 'down' : ''}`}>{signedPts(s.pnl)}</b>
        </li>
      ))}
    </ul>
  )
}

export function PmGame({ model, onTrade, onAgain, onLeave, busy, error, banner, rehearsal = false, clearError }) {
  const [sheet, setSheet] = useState(null) // { id, side, mode }
  const [toast, setToast] = useState(null)
  const seenClosed = useRef(null)
  const done = model.status === 'done'
  const [showEnd, setShowEnd] = useState(false)
  const byId = Object.fromEntries(model.markets.map((m) => [m.id, m]))
  const open = sheet && byId[sheet.id] && !byId[sheet.id].closed ? byId[sheet.id] : null

  // A short banner when a market resolves; the first snapshot only records what is already closed.
  useEffect(() => {
    const closed = new Set(model.markets.filter((m) => m.closed).map((m) => m.id))
    if (seenClosed.current === null) {
      seenClosed.current = closed
      return
    }
    for (const m of model.markets) {
      if (m.closed && !seenClosed.current.has(m.id)) {
        setToast({ id: m.id, text: `Resolved ${m.outcome.toUpperCase()}: ${m.text}`, pnl: m.reveal?.iHeld ? m.reveal.me : null })
        navigator.vibrate?.(m.reveal?.me > 0 ? [30, 40, 30] : [70])
      }
    }
    seenClosed.current = closed
  }, [model.markets])
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    if (!done) setShowEnd(false)
  }, [done])
  useEffect(() => {
    if (sheet && !open) setSheet(null) // the market closed under the sheet
  }, [sheet, open])

  const openSheet = (m, side, mode = 'buy') => {
    clearError?.()
    setSheet({ id: m.id, side, mode })
  }
  const submit = async (action, side, shares) => {
    const ok = await onTrade(action, sheet.id, side, shares)
    if (ok !== false) setSheet(null)
  }

  return (
    <div className="pm">
      {banner && <div className="pm-banner" role="note">{banner}</div>}
      <Header model={model} />
      {done && !showEnd && (
        <button className="pm-go yes pm-final" onClick={() => setShowEnd(true)}>The day is over · see your result</button>
      )}
      {done && showEnd ? (
        <PmEnd model={model} onAgain={onAgain} onLeave={onLeave} busy={busy} rehearsal={rehearsal} />
      ) : (
        <>
          <Standings standings={model.standings} />
          {error && !sheet && <p className="pm-err" role="alert">{error}</p>}
          <section className="pm-feed" aria-label="Markets">
            {model.markets.map((m) => (
              <MarketCard key={m.id} m={m} startHour={model.game.startHour} onTrade={openSheet} canTrade={!done} />
            ))}
          </section>
          <Positions positions={model.positions} onSell={(id, side) => byId[id] && openSheet(byId[id], side, 'sell')} />
          {!done && onLeave && <button className="pm-cancel" onClick={onLeave}>Leave</button>}
        </>
      )}
      {toast && !done && (
        <div className="pm-toast" role="status">
          <span>{toast.text}</span>{toast.pnl != null && <b className={`num ${toast.pnl > 0 ? 'up' : toast.pnl < 0 ? 'down' : ''}`}>{signedPts(toast.pnl)}</b>}
        </div>
      )}
      {open && <TradeSheet key={`${open.id}|${sheet.side}|${sheet.mode}`} m={open} side={sheet.side} mode={sheet.mode} cash={model.me.cash} busy={busy} error={error} onClose={() => setSheet(null)} onSubmit={submit} />}
      <style>{CSS}</style>
    </div>
  )
}
