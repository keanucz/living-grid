import { Sparkline } from './Sparkline.jsx'
import { cents, hh, iconFor, isWeather, signedPts } from './format.js'

// One market in the feed: question, a big probability with its move since the last hour, the chart, Yes / No at the
// ask, and what you hold. When it closes the same card becomes the reveal: outcome, what happened, the model's reason,
// and your profit on it against each bot's.
export function MarketCard({ m, startHour, onTrade, canTrade }) {
  const held = [['yes', m.held.yes], ['no', m.held.no]].filter(([, p]) => p.shares > 0)
  const entries = held.map(([side, p]) => ({ side, price: side === 'yes' ? (p.cost / p.shares) * 100 : 100 - (p.cost / p.shares) * 100 }))
  const arrow = m.delta > 0 ? '▲' : m.delta < 0 ? '▼' : ''
  return (
    <article className={`pm-card ${m.closed ? 'pm-closed' : ''}`} id={`pm-${m.id}`} aria-label={m.text}>
      <div className="pm-meta">
        <span className={`pm-kind ${isWeather(m.kind) ? 'wx' : ''}`}><i aria-hidden>{iconFor(m.kind)}</i>{isWeather(m.kind) ? 'Weather' : 'Market'}</span>
        <span className="pm-close">{m.closed ? 'Resolved' : `Closes ${hh(m.closeHour)}`}</span>
      </div>
      <h3 className="pm-q">{m.text}</h3>
      {isWeather(m.kind) && m.modelNote && <p className="pm-forecast"><b>Forecast:</b> {m.modelNote}</p>}

      {!m.closed ? (
        <>
          <div className="pm-prob">
            <b className="num">{m.price}%</b><span>chance</span>
            {arrow && <em className={m.delta > 0 ? 'up' : 'down'}>{arrow} {Math.abs(m.delta)}</em>}
          </div>
          <Sparkline series={m.series} startHour={startHour} closeHour={m.closeHour} entries={entries} />
          {m.note && <p className="pm-note">{m.note}</p>}
          <div className="pm-buy">
            <button className="pm-yes" disabled={!canTrade} onClick={() => onTrade(m, 'yes')}>Yes <b className="num">{cents(m.quote.yesAsk)}</b></button>
            <button className="pm-no" disabled={!canTrade} onClick={() => onTrade(m, 'no')}>No <b className="num">{cents(m.quote.noAsk)}</b></button>
          </div>
          {held.length > 0 && (
            <div className="pm-held">
              {held.map(([side, p]) => (
                <button key={side} className="pm-heldrow" onClick={() => onTrade(m, side, 'sell')}>
                  <span>You hold <b>{Math.round(p.shares)} {side.toUpperCase()}</b></span><span className="pm-sell">Sell</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <Resolved m={m} startHour={startHour} />
      )}
    </article>
  )
}

function Resolved({ m, startHour }) {
  const r = m.reveal
  return (
    <>
      <div className={`pm-outcome ${m.outcome}`}>
        <b>{m.outcome === 'yes' ? 'YES' : 'NO'}</b><span>{m.outcome === 'yes' ? 'It happened' : 'It did not happen'}</span>
        <em className="num">closed at {m.price}%</em>
      </div>
      <Sparkline series={m.series} startHour={startHour} closeHour={m.closeHour} closed outcome={m.outcome} />
      <p className="pm-what"><span>What happened</span>{r?.actualText || m.actualText}</p>
      {r?.reason && <p className="pm-why"><span>Why the model said {m.price}%</span>{r.reason}</p>}
      {r && (
        <ul className="pm-pnl" aria-label="Profit on this market">
          <li className={`me ${r.me > 0 ? 'up' : r.me < 0 ? 'down' : ''}`}><span>{r.iHeld ? 'You' : 'You (no trade)'}</span><b className="num">{r.iHeld ? signedPts(r.me) : '—'}</b></li>
          {r.bots.map((b) => <li key={b.name} className={b.pnl > 0 ? 'up' : b.pnl < 0 ? 'down' : ''}><span>{b.name}</span><b className="num">{b.pnl === 0 ? '—' : signedPts(b.pnl)}</b></li>)}
        </ul>
      )}
    </>
  )
}
