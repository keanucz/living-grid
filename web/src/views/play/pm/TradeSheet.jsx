import { useEffect, useState } from 'react'
import { MAX_SHARES, fill, points, sharesFor } from './pmMath.js'
import { cents, pts } from './format.js'

// The trade sheet: buy by amount (shares, potential payout and profit shown) or sell some or all of what you hold, at
// the model's quote. Closes when the game moves the market on or the trade goes through.
const AMOUNTS = [10, 25, 50, 100]

export function TradeSheet({ m, side: side0, mode: mode0 = 'buy', cash, onClose, onSubmit, busy, error }) {
  const [side, setSide] = useState(side0)
  const [mode, setMode] = useState(mode0)
  const heldShares = Math.round(m.held[side].shares)
  const [amount, setAmount] = useState(25)
  const [sell, setSell] = useState(heldShares)
  useEffect(() => setSell(heldShares), [side, heldShares])
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  const ask = fill(m.price, side, 'buy')
  const bid = fill(m.price, side, 'sell')
  const shares = sharesFor(Math.min(amount, cash), ask)
  const cost = points(shares, ask)
  const buying = mode === 'buy'
  const sellShares = Math.min(sell, heldShares)
  const proceeds = points(sellShares, bid)
  const label = `${side === 'yes' ? 'Yes' : 'No'}`
  const disabled = busy || (buying ? shares < 1 || cost > cash + 1e-9 : sellShares < 1)
  return (
    <div className="pm-scrim" onClick={onClose} role="presentation">
      <section className="pm-sheet" role="dialog" aria-modal="true" aria-label={`Trade: ${m.text}`} onClick={(e) => e.stopPropagation()}>
        <div className="pm-grab" aria-hidden />
        <h3 className="pm-sheet-q">{m.text}</h3>
        <div className="pm-seg" role="tablist">
          {['buy', 'sell'].map((k) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} disabled={k === 'sell' && heldShares < 1 && !(m.held.yes.shares > 0 || m.held.no.shares > 0)} onClick={() => setMode(k)}>{k === 'buy' ? 'Buy' : 'Sell'}</button>)}
        </div>
        <div className="pm-sides">
          <button className={`pm-yes ${side === 'yes' ? 'sel' : ''}`} onClick={() => setSide('yes')}>Yes <b className="num">{cents(buying ? fill(m.price, 'yes', 'buy') : fill(m.price, 'yes', 'sell'))}</b></button>
          <button className={`pm-no ${side === 'no' ? 'sel' : ''}`} onClick={() => setSide('no')}>No <b className="num">{cents(buying ? fill(m.price, 'no', 'buy') : fill(m.price, 'no', 'sell'))}</b></button>
        </div>

        {buying ? (
          <>
            <div className="pm-amt">
              <span className="pm-l">Amount (points)</span>
              <div className="pm-chips">
                {AMOUNTS.map((a) => <button key={a} className={amount === a ? 'on' : ''} onClick={() => setAmount(a)}>{a}</button>)}
                <button className={amount === Math.floor(cash) ? 'on' : ''} onClick={() => setAmount(Math.floor(cash))}>Max</button>
              </div>
              <input className="pm-input num" type="number" inputMode="numeric" min="1" max={Math.floor(cash)} value={amount} onChange={(e) => setAmount(Math.max(0, Math.min(Math.floor(cash), Number(e.target.value) || 0)))} aria-label="Amount in points" />
            </div>
            <dl className="pm-sum">
              <div><dt>Shares</dt><dd className="num">{shares}{shares >= MAX_SHARES ? ' (max)' : ''}</dd></div>
              <div><dt>Average price</dt><dd className="num">{cents(ask)}</dd></div>
              <div><dt>Cost</dt><dd className="num">{pts(cost)}</dd></div>
              <div><dt>Payout if {label}</dt><dd className="num">{pts(shares)}</dd></div>
              <div className="good"><dt>Profit if {label}</dt><dd className="num">+{pts(shares - cost)}</dd></div>
            </dl>
            <button className={`pm-go ${side}`} disabled={disabled} onClick={() => onSubmit('buy', side, shares)}>{shares < 1 ? 'Not enough points' : `Buy ${label} · ${shares} shares`}</button>
          </>
        ) : (
          <>
            {heldShares < 1 ? <p className="pm-hint">You hold no {label} shares in this market.</p> : (
              <>
                <div className="pm-amt">
                  <span className="pm-l">Shares to sell (you hold {heldShares})</span>
                  <div className="pm-chips">
                    {[0.25, 0.5, 1].map((f) => { const n = Math.max(1, Math.round(heldShares * f)); return <button key={f} className={sellShares === n ? 'on' : ''} onClick={() => setSell(n)}>{f === 1 ? 'All' : `${f * 100}%`}</button> })}
                  </div>
                  <input className="pm-input num" type="number" inputMode="numeric" min="1" max={heldShares} value={sell} onChange={(e) => setSell(Math.max(0, Math.min(heldShares, Number(e.target.value) || 0)))} aria-label="Shares to sell" />
                </div>
                <dl className="pm-sum">
                  <div><dt>Sell price</dt><dd className="num">{cents(bid)}</dd></div>
                  <div><dt>You receive</dt><dd className="num">{pts(proceeds)}</dd></div>
                </dl>
              </>
            )}
            <button className="pm-go sell" disabled={disabled || heldShares < 1} onClick={() => onSubmit('sell', side, sellShares)}>{`Sell ${label} · ${sellShares} shares`}</button>
          </>
        )}
        {error && <p className="pm-err" role="alert">{error}</p>}
        <p className="pm-hint">The model sets the price and trades with everyone at it: you buy one cent above and sell one cent below. Each share pays 1 point if it is right.</p>
        <button className="pm-cancel" onClick={onClose}>Close</button>
      </section>
    </div>
  )
}
