// Sized for a 1920x1080 projector read from the back of a room: nothing below 18px, one screen, no scrolling.
export const CSS = `
body.sc-body { overflow: hidden; }
.sc { height: 100vh; display: flex; flex-direction: column; padding: 28px 40px 32px; gap: 22px; font-size: 22px; background: radial-gradient(1200px 600px at 85% -10%, rgba(197,240,107,.07), transparent 60%), var(--bg); }
.sc .num { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.sc-top { display: flex; align-items: center; gap: 22px; flex: none; }
.sc-logo { width: 60px; height: 60px; border-radius: 16px; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); flex: none; }
.sc-titles { flex: 1; min-width: 0; }
.sc-kicker { font-size: 20px; color: var(--text-2); display: flex; gap: 14px; align-items: center; }
.sc-demo { font-size: 16px; padding: 3px 10px; border-radius: 999px; background: var(--hot-dim); color: var(--hot); }
.sc h1 { margin: 2px 0 0; font-size: 44px; letter-spacing: -0.025em; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-pill { padding: 10px 20px; border-radius: 999px; font-size: 22px; font-weight: 600; background: var(--card); color: var(--text-2); white-space: nowrap; }
.sc-pill.playing { background: var(--accent); color: var(--accent-ink); }
.sc-pill.playing::before { content: ''; display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--accent-ink); margin-right: 10px; animation: sc-blink 1.4s infinite; }
.sc-pill.countdown { background: var(--hot); color: #1a0d00; }
.sc-pill.reveal { background: var(--hydro); color: #06121f; }
.sc-code { display: flex; flex-direction: column; align-items: center; font-family: var(--mono); font-size: 40px; font-weight: 700; letter-spacing: .12em; color: var(--accent); line-height: 1; }
.sc-code small, .sc-clock small { font-family: var(--font); font-size: 16px; font-weight: 400; letter-spacing: 0; color: var(--text-3); margin-bottom: 6px; }
.sc-clock { display: flex; flex-direction: column; align-items: flex-end; }
.sc-clock b { font-size: 56px; line-height: 1; color: var(--accent); }
.sc-miniqr { border-radius: 10px; background: #fafafa; }
.sc-status { margin: auto; font-size: 32px; color: var(--text-2); }
.sc-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 26px; padding: 26px 28px; min-height: 0; }
.sc-h { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; font-size: 28px; font-weight: 600; margin-bottom: 18px; letter-spacing: -0.01em; }
.sc-h b { font-size: 34px; color: var(--accent); } .sc-h small { font-size: 18px; font-weight: 400; }
.sc-h2 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
.sc-muted { font-size: 18px; color: var(--text-2); line-height: 1.4; margin: 0; }

/* Waiting room */
.sc-wait { flex: 1; min-height: 0; display: grid; grid-template-columns: 560px 1fr; gap: 26px; }
.sc-join { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center; }
.sc-join img { border-radius: 18px; background: #fafafa; padding: 10px; width: 440px; height: 440px; }
.sc-join-t { font-size: 44px; font-weight: 700; letter-spacing: -0.02em; }
.sc-join-u { font-size: 22px; color: var(--text-2); word-break: break-all; }
.sc-join-c { font-size: 26px; color: var(--text-2); } .sc-join-c b { font-family: var(--mono); color: var(--accent); letter-spacing: .12em; font-size: 34px; }
.sc-room { display: flex; flex-direction: column; gap: 16px; overflow: hidden; }
.sc-count { font-size: 34px; font-weight: 700; color: var(--hot); }
.sc-chips { display: flex; flex-wrap: wrap; gap: 14px; align-content: flex-start; flex: 1; min-height: 0; overflow: hidden; }
.sc-chip { display: inline-flex; align-items: center; gap: 12px; padding: 10px 22px 10px 10px; border-radius: 999px; background: var(--card); border: 1px solid var(--line-2); font-size: 28px; font-weight: 600; animation: sc-pop .55s cubic-bezier(.2,1.6,.4,1) both; }
.sc-chip i { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; font-style: normal; background: var(--accent-dim); color: var(--accent); font-size: 24px; }
.sc-chip.ready { border-color: var(--accent); }
.sc-how ol { margin: 0; padding-left: 28px; font-size: 22px; line-height: 1.45; color: var(--text-2); }
.sc-against { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.sc-bot { padding: 6px 14px; border-radius: 999px; background: rgba(96,165,250,.14); color: var(--hydro); font-size: 20px; }

/* Playing */
.sc-play { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1.05fr; grid-template-rows: auto 1fr; gap: 22px; position: relative; }
.sc-race { grid-row: 1 / span 2; overflow: hidden; position: relative; }
.sc-crowd { overflow: hidden; }
.sc-meter { padding: 12px 0 16px; border-top: 1px solid var(--line); }
.sc-meter:first-of-type { border-top: 0; padding-top: 0; }
.sc-meter.done { opacity: .62; }
.sc-mq { display: flex; gap: 14px; align-items: baseline; margin-bottom: 14px; }
.sc-mtag { flex: none; font-size: 17px; padding: 3px 10px; border-radius: 999px; background: var(--accent-dim); color: var(--accent); }
.sc-meter.done .sc-mtag { background: var(--card); color: var(--text-2); }
.sc-mtext { font-size: 23px; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-track { position: relative; height: 34px; border-radius: 17px; background: linear-gradient(90deg, var(--hot-dim), rgba(255,255,255,.04) 50%, var(--accent-dim)); margin: 0 24px; }
.sc-track::after { content: ''; position: absolute; left: 50%; top: -4px; bottom: -4px; width: 2px; background: var(--line-2); }
.sc-half { position: absolute; top: 50%; transform: translateY(-50%); font-size: 15px; font-weight: 700; letter-spacing: .08em; }
.sc-half.no { left: 14px; color: var(--hot); } .sc-half.yes { right: 14px; color: var(--accent); }
.sc-tick { position: absolute; top: 4px; bottom: 4px; width: 4px; margin-left: -2px; border-radius: 2px; background: var(--hydro); opacity: .8; transition: left .6s; }
.sc-ours { position: absolute; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px; transform: rotate(45deg); background: var(--hydro); border: 2px solid var(--panel-solid); transition: left .6s; z-index: 1; }
.sc-roomp { position: absolute; top: 50%; transform: translate(-50%, -50%); padding: 4px 12px; border-radius: 999px; font-family: var(--mono); font-size: 22px; transition: left .6s; z-index: 2; box-shadow: 0 0 0 3px var(--panel-solid); }
.sc-roomp.yes { background: var(--accent); color: var(--accent-ink); } .sc-roomp.no { background: var(--hot); color: #1a0d00; }
.sc-outcome { position: absolute; top: -6px; bottom: -6px; width: 6px; margin-left: -3px; border-radius: 3px; background: var(--text); }
.sc-mleg { display: flex; gap: 22px; margin: 12px 24px 0; font-size: 18px; color: var(--text-2); }
.sc-k { display: inline-block; width: 14px; height: 14px; border-radius: 4px; vertical-align: -1px; margin-right: 4px; }
.sc-k.room { background: var(--accent); border-radius: 50%; } .sc-k.ours { background: var(--hydro); transform: rotate(45deg) scale(.85); } .sc-k.bot { background: var(--hydro); width: 5px; opacity: .8; }
.sc-day { display: flex; flex-direction: column; min-height: 0; }
.sc-day .sc-h { margin-bottom: 8px; } .sc-day .sc-h b small { font-size: 18px; color: var(--text-2); font-weight: 400; }
.sc-svg { width: 100%; height: 0; flex: 1; min-height: 0; }
.sc-grid { stroke: var(--line); stroke-width: 1; }
.sc-ax { fill: var(--text-3); font-size: 18px; font-family: var(--mono); }
.sc-now { stroke: var(--accent); stroke-dasharray: 4 6; stroke-width: 2; opacity: .6; }
.sc-line { fill: none; stroke: var(--accent); stroke-width: 4; stroke-linejoin: round; stroke-linecap: round; }
.sc-dot { fill: var(--accent); stroke: var(--panel-solid); stroke-width: 3; }
.sc-off { font-size: 20px; color: var(--text-2); } .sc-off b { color: var(--wind); }
.sc-bursts { position: absolute; left: 28px; right: 28px; bottom: 24px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; pointer-events: none; z-index: 5; }
.sc-burst { padding: 12px 20px; border-radius: 16px; background: var(--card-2); border: 1px solid var(--line-2); font-size: 21px; box-shadow: var(--shadow); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; animation: sc-burst 4.2s ease-out both; }
.sc-burst span { color: var(--text-2); }
.sc-burst.yes { border-color: var(--accent); } .sc-burst.no { border-color: var(--hot); }
.sc-burst.settle { background: var(--text); color: var(--bg); }
.sc-burst b.yes { color: var(--accent); } .sc-burst b.no { color: var(--hot); }

/* Reveal */
.sc-reveal { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr; gap: 22px; }
.sc-day-reveal { grid-column: 1 / span 2; display: flex; flex-direction: column; gap: 10px; }
.sc-day-reveal .sc-kicker { font-size: 24px; }
.sc-date { font-size: 76px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.05; color: var(--accent); }
.sc-regime { font-size: 36px; font-weight: 600; }
.sc-sentence { font-size: 28px; line-height: 1.35; margin: 0; color: var(--text); max-width: 1600px; }
.sc-league { min-height: 0; overflow: hidden; }
.sc-league .bl-card { height: 100%; margin: 0; border-radius: 26px; }
.sc-league .bl-card.big .bl-row { font-size: 24px; padding: 6px; grid-template-columns: minmax(200px, 1.2fr) 1fr 84px 140px 110px; gap: 14px; }
.sc-league .bl-card.big .bl-h { font-size: 28px; }
.sc-league .bl-card.big .bl-v, .sc-league .bl-card.big .bl-p { font-size: 18px; min-width: 0; white-space: nowrap; }
.sc-league .bl-card.big .bl-m { font-size: 18px; }
.sc-podium { display: flex; flex-direction: column; }
.sc-steps { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; align-items: end; }
.sc-step { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.sc-pname { font-size: 32px; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-ppts { font-size: 22px; color: var(--text-2); }
.sc-block { width: 100%; border-radius: 16px 16px 6px 6px; display: grid; place-items: center; font-size: 54px; font-weight: 700; background: var(--card-2); color: var(--text-2); }
.sc-step.p1 .sc-block { height: 200px; background: var(--accent); color: var(--accent-ink); }
.sc-step.p2 .sc-block { height: 140px; } .sc-step.p3 .sc-block { height: 100px; }
.sc-step.p1 .sc-pname { color: var(--accent); font-size: 38px; }
.sc-stage { opacity: 0; transform: translateY(24px); transition: opacity .8s, transform .8s cubic-bezier(.2,.8,.3,1); }
.sc-stage.in { opacity: 1; transform: none; }
.sc-podium.in .sc-step { animation: sc-up .7s both; }
.sc-podium.in .sc-step.p3 { animation-delay: .3s; } .sc-podium.in .sc-step.p2 { animation-delay: .8s; } .sc-podium.in .sc-step.p1 { animation-delay: 1.4s; }

@keyframes sc-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
@keyframes sc-up { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
@keyframes sc-blink { 50% { opacity: .25; } }
@keyframes sc-burst { 0% { opacity: 0; transform: translateY(20px) scale(.96); } 8% { opacity: 1; transform: none; } 80% { opacity: 1; } 100% { opacity: 0; transform: translateY(-14px); } }
@media (prefers-reduced-motion: reduce) { .sc *, .sc *::before { animation: none !important; transition: none !important; } .sc-stage { opacity: 1; transform: none; } }
`
