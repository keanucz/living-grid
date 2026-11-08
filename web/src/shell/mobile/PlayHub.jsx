import { Icon } from '../icons.jsx'

// Phone entry to the games: big, obvious cards; the always-on room game first so nobody lands on a dead end.
const GAMES = [
  { href: '#/play', icon: 'chart', kicker: 'Quick play or a room code', title: 'Beat the model', blurb: 'Five quick calls about a real, hidden day. Say how sure you are; see if you beat our model.' },
  { href: '#/play', icon: 'pound', kicker: 'Solo or a room code', title: 'Market day', blurb: 'Buy and sell yes/no bets on a hidden day while our model sets the prices.' },
]

export default function PlayHub() {
  return (
    <div className="ph">
      <div className="ph-kicker">Play</div>
      <h2 className="ph-title">Think you can read the grid?</h2>
      <p className="ph-sub">Points only, no money. Your name goes on the big-screen leaderboard.</p>
      {GAMES.map((g) => (
        <a key={g.title} className="ph-card" href={g.href}>
          <span className="ph-ic"><Icon name={g.icon} size={22} /></span>
          <span className="ph-body">
            <span className="ph-k">{g.kicker}</span>
            <span className="ph-t">{g.title}</span>
            <span className="ph-b">{g.blurb}</span>
          </span>
          <span className="ph-go"><Icon name="arrowUpRight" size={18} /></span>
        </a>
      ))}
      <style>{`
        .ph { padding: 18px 14px 24px; display: flex; flex-direction: column; gap: 12px; }
        .ph-kicker { font: 500 10px var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
        .ph-title { margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
        .ph-sub { margin: 0 0 6px; color: var(--text-2); font-size: 14px; line-height: 1.45; }
        .ph-card { display: flex; gap: 14px; align-items: center; padding: 16px; min-height: 96px; border-radius: 12px;
          background: var(--panel-solid); border: 1px solid var(--line-2); color: inherit; text-decoration: none; }
        .ph-card:active { transform: scale(.99); background: var(--card); }
        .ph-ic { width: 48px; height: 48px; border-radius: 10px; display: grid; place-items: center; background: #fafafa; color: #0a0a0a; flex: none; }
        .ph-body { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .ph-k { font: 500 10px var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--text-3); }
        .ph-t { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
        .ph-b { font-size: 13px; color: var(--text-2); line-height: 1.4; }
        .ph-go { color: var(--text-2); flex: none; }
      `}</style>
    </div>
  )
}
