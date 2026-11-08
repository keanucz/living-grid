import { signedPts, pts } from './format.js'

// Open positions with their live value and a Sell button; closed ones show in their market's card.
export function Positions({ positions, onSell }) {
  if (!positions.length) return null
  return (
    <section className="pm-panel" aria-label="Your positions">
      <h2 className="pm-h">Your positions</h2>
      <ul className="pm-pos">
        {positions.map((p) => (
          <li key={`${p.marketId}|${p.side}`}>
            <div className="pm-pos-t"><span className={`pm-pill ${p.side}`}>{p.side.toUpperCase()}</span><span>{p.text}</span></div>
            <div className="pm-pos-n">
              <span className="num">{Math.round(p.shares)} shares · value {pts(p.value)}</span>
              <b className={`num ${p.pnl > 0 ? 'up' : p.pnl < 0 ? 'down' : ''}`}>{signedPts(p.pnl)}</b>
              <button className="pm-sell-btn" onClick={() => onSell(p.marketId, p.side)}>Sell</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
