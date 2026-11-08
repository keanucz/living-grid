// Phone-first styles for the market feed. The palette follows Polymarket's habit: green for Yes, red for No, otherwise the
// app's monochrome. Targets are at least 48 px; the trade sheet sits at the bottom, in thumb reach.
export const CSS = `
body { overflow: auto; }
.pm { --pm-yes: #4fc77a; --pm-yes-dim: rgba(79, 199, 122, .16); --pm-no: #f0645a; --pm-no-dim: rgba(240, 100, 90, .16); max-width: 520px; margin: 0 auto; padding: 12px 12px 90px; min-height: 100%; }
.pm .up { color: var(--pm-yes); } .pm .down { color: var(--pm-no); }
.pm-banner { font-size: 12px; color: #ff8a1f; background: rgba(255, 138, 31, .14); border-radius: 12px; padding: 8px 12px; margin-bottom: 10px; }
.pm-l { display: block; font-size: 11px; color: var(--text-3); }
.pm-head { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; padding: 12px 14px 10px; background: var(--panel-solid); border: 1px solid var(--line); border-radius: 18px; margin-bottom: 8px; position: sticky; top: 0; z-index: 5; }
.pm-head b { font-size: 24px; letter-spacing: -.02em; } .pm-head small { display: block; font-size: 11px; color: var(--text-2); }
.pm-eq { text-align: right; }
.pm-bar { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: var(--card-2); overflow: hidden; } .pm-bar i { display: block; height: 100%; background: var(--text-2); transition: width .6s; }
.pm-stand { list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 6px; margin: 0 0 10px; padding: 0; }
.pm-stand li { display: flex; flex-direction: column; min-width: 0; padding: 7px 10px; border-radius: 12px; background: var(--panel-solid); border: 1px solid var(--line); font-size: 11px; color: var(--text-2); }
.pm-stand li.me { border-color: var(--text-2); } .pm-stand li b { font-size: 15px; }
.pm-tag { margin-left: 4px; padding: 0 5px; border-radius: 6px; background: var(--card-2); color: var(--text-3); font-size: 9px; text-transform: uppercase; }
.pm-feed { display: grid; gap: 10px; }
.pm-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px; }
.pm-card.pm-closed { opacity: .96; }
.pm-meta { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-2); }
.pm-kind { display: inline-flex; align-items: center; gap: 8px; } .pm-kind i { font-style: normal; width: 24px; height: 24px; border-radius: 8px; display: grid; place-items: center; background: var(--card-2); font-weight: 700; }
.pm-kind.wx i { background: rgba(96, 165, 250, .2); color: #8cc0ff; }
.pm-q { font-size: 17px; line-height: 1.3; letter-spacing: -.01em; margin: 8px 0 4px; font-weight: 600; }
.pm-forecast { font-size: 12px; color: var(--text-2); margin: 0 0 4px; } .pm-forecast b { color: var(--text); }
.pm-prob { display: flex; align-items: baseline; gap: 8px; margin: 4px 0 0; } .pm-prob b { font-size: 44px; line-height: 1; letter-spacing: -.03em; } .pm-prob span { color: var(--text-2); font-size: 14px; }
.pm-prob em { font-style: normal; font-size: 13px; font-weight: 600; margin-left: auto; }
.pm-spark { display: block; margin: 4px 0 2px; } .pm-now { animation: pmpulse 1.6s ease-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes pmpulse { 0% { transform: scale(1); } 60% { transform: scale(1.8); opacity: .45; } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .pm-now { animation: none; } }
.pm-note { font-size: 12px; color: var(--text-2); line-height: 1.4; margin: 2px 0 8px; }
.pm-buy, .pm-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pm-yes, .pm-no { min-height: 52px; border-radius: 14px; border: 1px solid transparent; font: inherit; font-size: 16px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; }
.pm-yes { background: var(--pm-yes-dim); color: var(--pm-yes); } .pm-no { background: var(--pm-no-dim); color: var(--pm-no); }
.pm-yes.sel { border-color: var(--pm-yes); } .pm-no.sel { border-color: var(--pm-no); }
.pm-yes:disabled, .pm-no:disabled { opacity: .45; }
.pm-held { margin-top: 8px; display: grid; gap: 6px; }
.pm-heldrow { display: flex; justify-content: space-between; align-items: center; min-height: 44px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--card); color: var(--text); font: inherit; font-size: 13px; }
.pm-sell { color: var(--text-2); text-decoration: underline; }
.pm-outcome { display: flex; align-items: baseline; gap: 10px; padding: 10px 12px; border-radius: 14px; margin: 8px 0 4px; } .pm-outcome b { font-size: 24px; } .pm-outcome span { font-size: 13px; } .pm-outcome em { margin-left: auto; font-style: normal; font-size: 12px; color: var(--text-2); }
.pm-outcome.yes { background: var(--pm-yes-dim); } .pm-outcome.yes b { color: var(--pm-yes); } .pm-outcome.no { background: var(--pm-no-dim); } .pm-outcome.no b { color: var(--pm-no); }
.pm-what, .pm-why { font-size: 14px; line-height: 1.45; margin: 8px 0; } .pm-what span, .pm-why span { display: block; font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; }
.pm-why { padding: 10px 12px; border-radius: 12px; background: var(--card); }
.pm-pnl { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; }
.pm-pnl li { display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0; border-top: 1px solid var(--line); color: var(--text-2); } .pm-pnl li.me { grid-column: 1 / -1; font-weight: 700; color: var(--text); font-size: 15px; }
.pm-panel { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 14px; margin-top: 10px; }
.pm-h { font-size: 15px; margin: 0 0 8px; }
.pm-pos { list-style: none; margin: 0; padding: 0; } .pm-pos li { padding: 10px 0; border-top: 1px solid var(--line); } .pm-pos li:first-child { border-top: 0; }
.pm-pos-t { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 1.35; } .pm-pos-n { display: flex; align-items: center; gap: 10px; margin-top: 6px; font-size: 12px; color: var(--text-2); } .pm-pos-n b { margin-left: auto; font-size: 14px; }
.pm-pill { flex: none; padding: 1px 7px; border-radius: 6px; font-size: 10px; font-weight: 700; } .pm-pill.yes { background: var(--pm-yes-dim); color: var(--pm-yes); } .pm-pill.no { background: var(--pm-no-dim); color: var(--pm-no); }
.pm-sell-btn { min-height: 36px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--card); color: var(--text); font: inherit; font-size: 13px; }
.pm-toast { position: fixed; left: 12px; right: 12px; bottom: 14px; max-width: 496px; margin: 0 auto; display: flex; gap: 10px; justify-content: space-between; align-items: center; background: var(--card-2); border: 1px solid var(--line-2); border-radius: 14px; padding: 12px 14px; font-size: 13px; z-index: 30; box-shadow: 0 8px 28px rgba(0,0,0,.5); animation: pmin .25s ease-out; }
@keyframes pmin { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
.pm-scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, .55); z-index: 40; display: flex; align-items: flex-end; }
.pm-sheet { width: 100%; max-width: 520px; margin: 0 auto; max-height: 92vh; overflow: auto; background: var(--panel-solid); border: 1px solid var(--line-2); border-bottom: 0; border-radius: 24px 24px 0 0; padding: 10px 16px 22px; animation: pmup .22s ease-out; }
@keyframes pmup { from { transform: translateY(40px); opacity: .5; } to { transform: none; opacity: 1; } }
.pm-grab { width: 40px; height: 4px; border-radius: 2px; background: var(--line-2); margin: 0 auto 10px; }
.pm-sheet-q { font-size: 15px; line-height: 1.3; margin: 0 0 10px; font-weight: 600; }
.pm-seg { display: flex; gap: 4px; padding: 3px; border-radius: 14px; background: var(--card); margin-bottom: 10px; } .pm-seg button { flex: 1; min-height: 40px; border-radius: 11px; border: 0; background: none; color: var(--text-2); font: inherit; font-weight: 600; } .pm-seg button.on { background: var(--card-2); color: var(--text); } .pm-seg button:disabled { opacity: .4; }
.pm-amt { margin: 12px 0 8px; } .pm-chips { display: flex; gap: 6px; margin: 6px 0 8px; } .pm-chips button { flex: 1; min-height: 44px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--card); color: var(--text-2); font: inherit; font-weight: 600; } .pm-chips button.on { border-color: var(--text-2); color: var(--text); }
.pm-input { width: 100%; height: 50px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--card); color: var(--text); font: inherit; font-size: 20px; padding: 0 14px; text-align: right; }
.pm-sum { margin: 10px 0; display: grid; gap: 0; } .pm-sum div { display: flex; justify-content: space-between; padding: 7px 0; border-top: 1px solid var(--line); font-size: 14px; } .pm-sum dt { color: var(--text-2); } .pm-sum dd { margin: 0; font-weight: 600; } .pm-sum .good dd { color: var(--pm-yes); }
.pm-go { width: 100%; min-height: 54px; border-radius: 16px; border: 0; font: inherit; font-weight: 700; font-size: 16px; margin-top: 6px; } .pm-go.yes { background: var(--pm-yes); color: #08210f; } .pm-go.no { background: var(--pm-no); color: #2a0805; } .pm-go.sell { background: var(--text); color: var(--bg); } .pm-go:disabled { opacity: .45; }
.pm-final { margin: 0 0 10px; }
.pm-cancel { display: block; margin: 10px auto 0; background: none; border: 0; color: var(--text-2); text-decoration: underline; font: inherit; font-size: 13px; padding: 10px; }
.pm-hint { font-size: 11px; color: var(--text-3); line-height: 1.45; margin: 8px 0 0; }
.pm-err { font-size: 13px; color: var(--pm-no); background: var(--pm-no-dim); border-radius: 12px; padding: 8px 12px; margin: 8px 0; }
.pm-end { text-align: center; } .pm-kicker { font-size: 12px; color: var(--text-2); font-weight: 600; } .pm-bigpnl { font-size: 60px; font-weight: 800; line-height: 1; margin: 6px 0; } .pm-muted { font-size: 12px; color: var(--text-2); }
.pm-day { font-size: 14px; line-height: 1.5; margin: 12px 0; }
.pm-beats { list-style: none; padding: 0; margin: 8px 0; text-align: left; } .pm-beats li { display: flex; justify-content: space-between; padding: 9px 12px; border-radius: 12px; margin-bottom: 6px; background: var(--card); font-size: 14px; }
.pm-sub { display: block; font-size: 11px; color: var(--text-3); margin-top: 1px; }
.pm-meta-rank { font-size: 14px; margin: 10px 0; }
@media (prefers-reduced-motion: reduce) { .pm-toast, .pm-sheet { animation: none; } }
`
