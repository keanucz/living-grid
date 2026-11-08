# Demo scripts

Two three-minute scripts, one story. Pick by who is at the table:

- `g-research-first.md`: making the unseen seen leads, prediction is the proof.
- `hrt-first.md`: prediction and decisions lead, the unseen is context.

Both were timed against https://htb.stefvuck.dev on Saturday 7 November at about 17:40 UTC; the figures below were refreshed on Sunday at 07:17 UTC. Spoken text is 330 to 380 words each, roughly 2 minutes 20 to 2 minutes 35 seconds at a calm pace, leaving 30 seconds for clicks and the pound counter.

## Before you start (both scripts)

1. Open https://htb.stefvuck.dev full screen at 1080p. Check the top-right chip says **Live**. If it says **Fixture data**, carry on: every step below still works from the bundled fixtures. The pound figures then come from the bundled sample (Hormuz about £752M, Norway link about £9.4M), not the live ones below: read them off the screen instead of the script.
2. Open two more tabs, ready to switch to: `https://htb.stefvuck.dev/#/replay` and `https://htb.stefvuck.dev/#/reveal`. Keep `#/household` on a phone for the QR moment.
3. Turn the **Ghost wind** chip on once so its data is cached, then click **Last 24 h** in the constraint card to reset.
4. Pre-warm Simulate: click **Simulate**, run **Strait of Hormuz** once, then click back to **Overview**. The first `/intervene` call is the slowest.

## Click paths (TODO: re-walk before presenting)

**TODO:** this section described the Saturday 17:40 layout (left rail icons, a greyed-out Forecast tab, an unfrozen reveal) and is out of date: the app now opens on section tabs (Now, Forecast, What if, Proof, Hidden grid) and the Monday forecast was frozen at 23:59 UTC Saturday. Re-walk both scripts against the live site and rewrite the click steps.

## Live numbers to expect (checked Sunday 8 November, 07:17 UTC)

Sources: `/api/scores` (as of 06:00 UTC), `/api/scenarios` (pre-computed 21:29 UTC Saturday), `/api/state`, `/api/unseen/*`, `README.md` Results and `docs/findings/calm-day-replay.md`.

| Where | Figure |
|---|---|
| Now, headline prices | Change every hour. At 07:00 UTC Sunday: GB £177/MWh, the coupled continent (FR, DE-LU, NL, BE) €220, NO2 €192. Read them off the screen, don't quote these. |
| Constraint card, 26 Oct storm | about 71.6 GWh of accepted bids on mapped Scottish wind units (65.2 GWh in North Scotland); £36.5m NESO constraint costs |
| Carbon, GB at 16:00 UTC Saturday | 370 g/kWh produced, 347 g/kWh consumed, 7.5% imported (modelled) |
| Hormuz, +40% gas for 14 days | about £1.75bn to consumers (P10 to P90: £1.05bn to £2.46bn); "GB price up £38: gas up 40% (+£38)"; biggest rises in NL, DE-LU and BE (about €41 to €42/MWh), smallest in NO2 (about €6) |
| Norway link trip, 980 MW recent flow for 24 h | GB up about £4/MWh, about £2.6M to GB consumers (P10 to P90: £1.5M to £3.7M); "GB price up £4: less from Norway (+£4)" |
| Battery, share of perfect foresight | 97.6% pooled over five zones and 155 settled hours (NO2 not scored); naive rule 87% to 89% |
| Forecasts scored live | 879 by 06:00 UTC Sunday, since 13:48 UTC Saturday; rises every hour |
| Replay, 26 Oct storm | 78 of 168 zone-hours inside the band (46%) |
| Replay, 2 Nov (ordinary wind) | 155 of 168 (92%) |
| Backtest, day-ahead prices | MAE 33.3 against yesterday 36.7 and persistence 52.3 (36% better); band coverage 78.5%, target 80%; 12 folds, 12,086 hours |

## Known weak spots to steer around

- **Risk-aware against median-only battery:** close, not a clean win. Live, risk-aware is ahead in Germany, GB and the Netherlands, level in Belgium and just behind in France (98.6% against 99.1%). Say "as good or better in four of five zones", not "every zone".
- **The storm:** the band caught only 46% of hours on 26 October. Show it as the honest limit, not something to hide.
- **Live scoreboard:** the headline figures on Proof are from the backtest (the card says so). Quote the live count of scored forecasts from the screen when you present.
