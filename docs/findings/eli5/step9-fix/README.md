# #295: What if impact tiles and Where the grid is full, in plain words

Fixes for two rows of docs/findings/eli5/step9.md. Checked 8 November 2026 in Playwright Chromium, under `nice -n 19` with one browser that was closed afterwards, at 1440×900 and 390×844. It ran against a local engine with `LG_OFFLINE=1`, so tapping an event publishes nothing to the shared screens, and the figures in the screenshots are fixture numbers. The check read the visible text with every "For experts" closed.

| Before | Now |
|---|---|
| GB PRICE £191.1, ▲ 12.6 vs now | Britain, wholesale (Term) 19.3p per kWh, ▲ 1.3p per kWh vs now (lib/wholesale.js) |
| HARDEST HIT NL +15.7 €/MWh | Hit hardest: Netherlands, +€15.7 per MWh (Britain would show pence per kWh) |
| GHOST WIND 0.0 GWh paid to switch off | Wind paid to switch off: 0.0 GWh, extra, estimated |
| More · 2 panels · Show | More detail · Show |
| Inert "Open details" button on the tiles | Removed |
| Desktop What if: no question before an event is picked | "What if the world changes?" and its blurb from shell/sections.js. Desktop only, so the phone (which already shows it) has it once. |
| Where the grid is full: "NESO's day-ahead flow forecast was above the limit…" | "The power expected to flow was over the limit in 20% of hours". NESO and the code move under For experts. |
| "…of GB thermal constraint costs over N days with NESO cost data" | "out of £9.0m of constraint costs (Term) in 7 days". The thermal and NESO detail moves under For experts. |
| Nested boundary note (SSEN-S, SSE-SP, SSHARN) in open text | The API's `notes` render under For experts |
| Local stand-in Term | Shared glossary Term: boundary, interconnector, constraint |

The scan for SSEN, SSE-SP, SSHARN, NESO, thermal, ghost wind, £/MWh, €/MWh, "panels" and em dashes is clean on both pages and both viewports, except for two strings outside this task's paths:

- **Map callout:** "Great Britain +12.6 £/MWh" comes from map/MapView.jsx.
- **Phone layer chip:** "Ghost wind" is a phone layer chip.

The infrastructure cards also still say "NO2 to GB", from layers/boundaries/data.js, which is covered by #294.
