// Phone-first styles for the Beat the model screens. Thumb-reach layout: big targets (>= 52 px), the primary action last.
export const CSS = `
body { overflow: auto; }
.bm { --bm-good: #8fd16a; --bm-good-dim: rgba(143, 209, 106, 0.16); --bm-bad: #ff8a1f; max-width: 520px; margin: 0 auto; padding: 14px 14px 40px; min-height: 100%; }
.bm-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 22px; padding: 16px; margin-bottom: 12px; }
.bm-banner { font-size: 12px; color: var(--bm-bad); background: var(--hot-dim); border-radius: 12px; padding: 8px 12px; margin-bottom: 10px; }
.bm-error { font-size: 13px; color: var(--bm-bad); background: var(--hot-dim); border-radius: 12px; padding: 8px 12px; }
.bm-muted { font-size: 12px; color: var(--text-2); line-height: 1.45; margin: 6px 0; }
.bm-kicker { font-size: 12px; color: var(--accent); font-weight: 600; }
.bm-dots { display: flex; gap: 6px; justify-content: center; margin: 2px 0 12px; }
.bm-dots i { width: 28px; height: 6px; border-radius: 3px; background: var(--card-2); }
.bm-dots i.bm-now { background: var(--text-2); } .bm-dots i.bm-win { background: var(--bm-good); } .bm-dots i.bm-lose { background: var(--bm-bad); } .bm-dots i.bm-skip { background: var(--text-3); }
.bm-callhead { display: flex; justify-content: space-between; align-items: center; min-height: 40px; }
.bm-kind { font-size: 12px; color: var(--text-2); display: inline-flex; align-items: center; gap: 8px; }
.bm-kind i { font-style: normal; width: 24px; height: 24px; border-radius: 8px; display: grid; place-items: center; background: var(--accent-dim); color: var(--accent); font-weight: 700; }
.bm-timer { position: relative; width: 40px; height: 40px; flex: none; }
.bm-timer svg { position: absolute; inset: 0; } .bm-timer b { position: absolute; inset: 0; display: grid; place-items: center; font-size: 14px; }
.bm-q { font-size: 20px; line-height: 1.25; letter-spacing: -0.01em; margin: 6px 0 4px; }
.bm-ctx { font-size: 13px; color: var(--text-2); margin: 0 0 8px; }
.bm-opts { display: grid; gap: 8px; margin: 12px 0; }
.bm-opts button { min-height: 56px; border-radius: 16px; border: 1px solid var(--line-2); background: var(--card); color: var(--text); font: inherit; font-size: 16px; font-weight: 600; text-align: left; padding: 0 16px; }
.bm-opts button.bm-on { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }
.bm-opts button:disabled:not(.on) { opacity: .45; }
.bm-conf { display: block; margin-top: 4px; }
.bm-conf-h { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 4px; }
.bm-conf input[type=range] { width: 100%; height: 40px; accent-color: var(--accent); }
.bm-conf-t { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-3); }
.bm-hint { font-size: 12px; color: var(--text-2); margin: 8px 0 12px; line-height: 1.45; }
.bm-hint .bm-g { color: var(--bm-good); } .bm-hint .bm-b { color: var(--bm-bad); }
.bm-primary { width: 100%; min-height: 54px; border-radius: 16px; border: 0; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 700; font-size: 17px; }
.bm-primary:disabled { opacity: .45; }
.bm-link { display: block; margin: 8px auto 0; background: none; border: 0; color: var(--text-2); text-decoration: underline; font: inherit; font-size: 13px; padding: 10px; }
.bm-locked { padding: 10px 12px; margin-top: 10px; border-radius: 12px; background: var(--card); color: var(--text-2); font-size: 12px; text-align: center; line-height: 1.4; }
.bm-verdict { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 14px; border-radius: 14px; background: var(--card); margin: 6px 0 10px; }
.bm-verdict b { font-size: 22px; } .bm-verdict.bm-win { background: var(--bm-good-dim); } .bm-verdict.bm-win b, .bm-verdict.bm-win span { color: var(--bm-good); } .bm-verdict.bm-lose b, .bm-verdict.bm-lose span { color: var(--bm-bad); }
.bm-happened { font-size: 14px; line-height: 1.45; margin: 0 0 10px; } .bm-happened span, .bm-reason span { display: block; font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; }
.bm-rows { list-style: none; margin: 0 0 10px; padding: 0; }
.bm-rows li { display: grid; grid-template-columns: 1.1fr 1.4fr auto; gap: 8px; align-items: center; padding: 9px 0; border-top: 1px solid var(--line); font-size: 14px; }
.bm-rows li.bm-me { font-weight: 700; } .bm-rows li.bm-ok .bm-what { color: var(--bm-good); } .bm-rows li.bm-bad .bm-what { color: var(--bm-bad); } .bm-rows li.bm-none .bm-what { color: var(--text-3); }
.bm-who { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .bm-pts { min-width: 36px; text-align: right; }
.bm-reason { font-size: 14px; line-height: 1.45; margin: 0 0 8px; padding: 10px 12px; border-radius: 12px; background: var(--card); }
.bm-next { text-align: center; font-size: 13px; color: var(--text-2); margin-top: 6px; }
.bm-totals { list-style: none; display: flex; gap: 6px; overflow-x: auto; margin: 0; padding: 0; scrollbar-width: none; }
.bm-totals li { flex: none; display: flex; flex-direction: column; align-items: center; min-width: 74px; padding: 8px 10px; border-radius: 14px; background: var(--panel-solid); border: 1px solid var(--line); font-size: 11px; color: var(--text-2); }
.bm-totals li b { font-size: 17px; color: var(--text); } .bm-totals li.bm-me { border-color: var(--accent); } .bm-totals li.bm-me b { color: var(--accent); }
.bm-tag { display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 6px; background: var(--card-2); color: var(--text-3); font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
.bm-end { text-align: center; } .bm-bigscore { font-size: 64px; font-weight: 800; color: var(--accent); line-height: 1; margin: 6px 0; }
.bm-day { font-size: 14px; line-height: 1.5; margin: 12px 0; }
.bm-beats { list-style: none; padding: 0; margin: 8px 0; text-align: left; } .bm-beats li { display: flex; justify-content: space-between; padding: 9px 12px; border-radius: 12px; margin-bottom: 6px; background: var(--card); font-size: 14px; }
.bm-beats li.bm-win { color: var(--bm-good); } .bm-beats li.bm-lose { color: var(--bm-bad); }
.bm-meta { font-size: 14px; margin: 10px 0; } .bm-meta .bm-up { color: var(--bm-good); } .bm-meta .bm-down { color: var(--bm-bad); }
@media (prefers-reduced-motion: no-preference) { .bm-card { animation: bmin .25s ease-out; } @keyframes bmin { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } } }
`
