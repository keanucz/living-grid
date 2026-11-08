export const CSS = `
.dcv { max-width: 1240px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; color: var(--text); }
.dcv-head h1 { margin: 0 0 4px; font-size: 22px; line-height: 1.2; }
.dcv-head p { margin: 0; color: var(--text-2); font-size: 14px; line-height: 1.5; max-width: 70ch; }
.dcv-main { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr); gap: 14px; align-items: start; }
.dcv-map { position: relative; height: min(58vh, 560px); min-height: 380px; border-radius: 18px; overflow: hidden; background: #0d0d0c; border: 1px solid var(--line); touch-action: none; }
.dcv-load { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-3); margin: 0; }
.dcv-legend { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 999px; background: rgba(10,10,10,.82); font-size: 12px; color: var(--text-2); flex-wrap: wrap; }
.dcv-legend i { width: 90px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, rgb(197,240,107), rgb(255,112,40)); }
.dcv-legend small { color: var(--text-3); }
.dcv-pin { position: absolute; width: 34px; height: 34px; margin: -34px 0 0 -17px; padding: 0; border: 0; background: none; cursor: grab; touch-action: none; z-index: 2; }
.dcv-pin:active { cursor: grabbing; }
.dcv-pin b { position: absolute; left: 3px; top: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--pin); color: #101010; border: 2px solid #0a0a0a; box-shadow: 0 2px 8px rgba(0,0,0,.6); font: 700 13px/24px var(--mono, monospace); text-align: center; }
.dcv-pin::after { content: ''; position: absolute; left: 11px; top: 25px; border: 6px solid transparent; border-top: 8px solid var(--pin); }
.dcv-pin.on b { outline: 2px solid #fff; outline-offset: 1px; }
.dcv-ring { position: absolute; left: 50%; bottom: 0; width: 20px; height: 20px; margin: 0 0 -10px -10px; border-radius: 50%; pointer-events: none; }
.dcv-pin.warn .dcv-ring { border: 2px solid #ff8a1f; background: rgba(255,138,31,.18); animation: dcv-pulse 1.8s ease-out infinite; }
@keyframes dcv-pulse { from { transform: scale(1); opacity: 1; } to { transform: scale(4.2); opacity: 0; } }
.dcv-jumps { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; font-size: 13px; color: var(--text-3); }
.dcv-jumps button { padding: 7px 12px; min-height: 36px; border-radius: 999px; background: var(--card); color: var(--text-2); font-size: 13px; }
.dcv-jumps .add { background: var(--accent); color: var(--accent-ink, #101010); font-weight: 600; }
.dcv-side { display: flex; flex-direction: column; gap: 10px; background: var(--card); border-radius: 18px; padding: 14px; }
.dcv-types { display: flex; gap: 6px; }
.dcv-types button { flex: 1; height: 40px; border-radius: 12px; background: var(--card-2); color: var(--text-2); font-weight: 600; }
.dcv-types button.on { background: var(--hot, #ff8a1f); color: #1b0d00; }
.dcv-sl { display: block; font-size: 13px; color: var(--text-2); }
.dcv-sl span { display: flex; justify-content: space-between; margin-bottom: 2px; }
.dcv-sl b { color: var(--text); }
.dcv-sl input { width: 100%; accent-color: var(--hot, #ff8a1f); }
.dcv-bld { margin: 4px 0 0; }
.dcv-bld svg { width: 100%; height: auto; display: block; }
.dcv-bld figcaption { font-size: 11px; color: var(--text-3); line-height: 1.4; margin-top: 4px; }
.dcv-rack { fill: #262624; transition: fill .3s; }
.dcv-rack.on { fill: #c5f06b; }
.dcv-mw { fill: var(--text); font: 700 20px var(--mono, monospace); }
.dcv-unit { fill: var(--text-3); font: 9px system-ui, sans-serif; }
.dcv-tick { fill: var(--text-3); font: 6.5px system-ui, sans-serif; }
.dcv-fan { animation: dcv-spin 2s linear infinite; }
@keyframes dcv-spin { to { transform: rotate(360deg); } }
.dcv-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.dcv-card { background: var(--card); border-radius: 18px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.dcv-card h2 { margin: 0; font-size: 15px; }
.dcv-ct { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.dcv-toggle { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px 4px 4px; min-height: 36px; border-radius: 999px; background: var(--card-2); color: var(--text-2); font-weight: 600; font-size: 13px; }
.dcv-toggle i { width: 28px; height: 28px; border-radius: 50%; background: #55554f; transition: transform .25s, background .25s; }
.dcv-toggle.on { background: rgba(197,240,107,.18); color: var(--accent); }
.dcv-toggle.on i { background: var(--accent); }
.dcv-flex svg { width: 100%; height: auto; display: block; }
.dcv-flexline { margin: 4px 0 0; font-size: 13px; color: var(--text-2); line-height: 1.5; }
.dcv .acc { color: var(--accent); }
.dcv-cmp { display: flex; flex-direction: column; gap: 8px; }
.dcv-site { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; text-align: left; padding: 10px; border-radius: 14px; background: var(--card-2); border: 1px solid transparent; color: var(--text); }
.dcv-site.on { border-color: rgba(255,255,255,.35); }
.dcv-site.best { box-shadow: inset 0 0 0 1px rgba(197,240,107,.6); }
.dcv-tag { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; color: #101010; font: 700 12px var(--mono, monospace); }
.dcv-sname { font-size: 14px; font-weight: 600; align-self: center; }
.dcv-bars { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 4px; }
.dcv-bar { display: grid; grid-template-columns: 62px 1fr auto; gap: 8px; align-items: center; font-size: 12px; }
.dcv-bar em { font-style: normal; color: var(--text-3); }
.dcv-track { height: 8px; border-radius: 4px; background: #2a2a28; overflow: hidden; }
.dcv-track i { display: block; height: 100%; border-radius: 4px; transition: width .4s; }
.dcv-track .cost { background: #c5f06b; } .dcv-track .co2 { background: #6bc8f0; } .dcv-track .flag { background: #ff8a1f; } .dcv-track .ok { background: #55554f; }
.dcv-detail .dcv-nums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.dcv-nums > div { background: var(--card-2); border-radius: 14px; padding: 10px; display: flex; flex-direction: column; gap: 2px; }
.dcv-nums span { font-size: 12px; color: var(--text-3); } .dcv-nums b { font-size: 20px; } .dcv-nums small { font-size: 11px; color: var(--text-3); }
.dcv-warnline { margin: 0; font-size: 13px; color: var(--hot, #ff8a1f); }
.dcv-notes { margin: 0; padding-left: 18px; font-size: 13px; color: var(--text-2); line-height: 1.5; }
.dcv-notes li.hot { color: var(--text); } .dcv-notes li.hot b { color: #ff8a1f; }
.dcv-notes small { color: var(--text-3); }
.dcv-muted { font-size: 12px; color: var(--text-3); line-height: 1.5; margin: 0; }
@media (max-width: 900px) { .dcv-main, .dcv-row { grid-template-columns: 1fr; } .dcv-detail .dcv-nums { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .dcv { padding: 12px; } .dcv-head h1 { font-size: 19px; } .dcv-map { height: 340px; min-height: 300px; } }
@media (prefers-reduced-motion: reduce) {
  .dcv-fan, .dcv-pin.warn .dcv-ring { animation: none; }
  .dcv-pin.warn .dcv-ring { transform: scale(2.4); opacity: .6; }
  .dcv-rack, .dcv-track i, .dcv-toggle i { transition: none; }
}
`
