import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { connectGame } from '../../views/game/connection.js'

const TOP = 5
const money = (v) => `${v < 0 ? '−' : ''}£${Math.abs(v).toFixed(2)}`

// Main-screen leaderboard for the room game, read from the SpacetimeDB leaderboard view. Hidden when the
// game server is out of reach, so an offline demo shows nothing rather than an empty board.
function Leaderboard() {
  const [s, setS] = useState({ status: 'connecting', leaderboard: [] })
  const [qr, setQr] = useState(null)
  const url = `${location.origin}${location.pathname}#/game`
  useEffect(() => {
    if (import.meta.env.VITE_LG_OFFLINE === '1') return undefined
    const g = connectGame({ withToken: false, tables: ['leaderboard'], onState: (n) => setS((p) => ({ ...p, ...n })) })
    return () => g.close()
  }, [])
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 112, color: { dark: '#0a0a0a', light: '#fafafa' } }).then(setQr).catch(() => setQr(null))
  }, [url])
  if (s.status !== 'live') return null
  const rows = (s.leaderboard ?? []).slice(0, TOP)
  return (
    <section className="panel lb fade-in" aria-label="Room game leaderboard">
      <a className="lb-head" href="#/game">
        {qr && <img src={qr} alt="QR code to join the room game" width="44" height="44" />}
        <div>
          <div className="lb-t">Room game</div>
          <div className="lb-s">Scan to beat our forecast battery</div>
        </div>
      </a>
      {rows.length ? (
        <ol className="lb-list">
          {rows.map((r) => (
            <li key={`${r.rank}-${r.name}`}>
              <span className="lb-rank num">{r.rank}</span>
              <span className="lb-name">{r.name}</span>
              <span className="lb-zone">{r.zone}</span>
              <span className={`lb-score num ${r.score < 0 ? 'neg' : ''}`}>{money(r.score)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="lb-empty">No players yet</p>
      )}
      <div className="lb-foot">Settled on GB system prices</div>
      <style>{`
        .lb { width: 260px; padding: 10px 12px 10px; }
        .lb-head { display: flex; gap: 10px; align-items: center; color: inherit; text-decoration: none; margin-bottom: 8px; }
        .lb-head img { border-radius: 4px; flex: none; }
        .lb-t { font-weight: 600; letter-spacing: -0.01em; }
        .lb-s, .lb-foot, .lb-empty { font-size: 11px; color: var(--text-2); margin: 0; }
        .lb-list { list-style: none; margin: 0 0 6px; padding: 0; }
        .lb-list li { display: grid; grid-template-columns: 18px 1fr auto auto; gap: 8px; align-items: baseline; padding: 4px 0; border-top: 1px solid var(--line); font-size: 13px; }
        .lb-rank { color: var(--text-3); }
        .lb-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lb-zone { font-size: 11px; color: var(--text-3); }
        .lb-score { color: var(--accent); }
        .lb-score.neg { color: var(--down); }
      `}</style>
    </section>
  )
}

export default { id: 'leaderboard', slot: 'right', order: 10, modes: ['overview', 'simulate'], Component: Leaderboard }
