# Demo scripts

Two three-minute scripts, one story. Pick by who is at the table:

- `g-research-first.md`: making the unseen seen leads, prediction is the proof.
- `hrt-first.md`: prediction and decisions lead, the unseen is context.

Both were timed against https://htb.stefvuck.dev on Saturday 7 November at about 17:40 UTC; the figures below were refreshed on Sunday at 07:17 UTC. Spoken text is 330 to 380 words each, roughly 2 minutes 20 to 2 minutes 35 seconds at a calm pace, leaving 30 seconds for clicks and the pound counter.

## Before you start (both scripts)

1. Open https://htb.stefvuck.dev full screen at 1080p. The first visit plays a short intro (a pylon, then Edinburgh, then the six countries) and a welcome: click **Skip, show me the map**. Check the top-right chip says **Live**. If it says **Fixture data**, wait 15 s (the page retries live by itself); if it stays, carry on: every step below still works from the bundled fixtures, but read the pound figures off the screen, not the table below.
2. Open two more tabs, ready to switch to: `https://htb.stefvuck.dev/#/replay` and `https://htb.stefvuck.dev/#/reveal`. Keep `#/household` on a phone for the QR moment.
3. Pre-warm the hidden grid: **Hidden grid** tab, **Scotland’s wind, paid to stop**, **More detail**, **26 Oct storm**, then **Last 24 h** and **Less detail** to reset.
4. Pre-warm What if: **What if** tab, click the **Gas gets dearer** card once (it runs straight away; there is no Run button), then the **Now** tab. The first run is the slowest.
5. Presenter mode for a second screen: `https://htb.stefvuck.dev/#tour=g-research&autoplay` (or `hrt`, or `main`) plays the matching tour on a loop with no buttons.

## Click paths (walked on the live site, Sunday 07:30 UTC)

The app has one row of tabs: **Now · Forecast · Hidden grid · What if · Proof · Play**. Each tab sets the map for you (layers, time, tilt), so there are no layer chips to toggle in either script. Panels open simple first; the detail is behind **Why?**, **For experts** and **More detail**.

| Script beat | Clicks |
|---|---|
| Open (both) | **Now** tab. Price map with flows; the answer card bottom right reads “Britain £…/MWh wholesale, about …p per kWh”. |
| Forecast ghost (HRT 0:00) | **Forecast** tab. It opens six hours ahead (time bar reads “+6 h”), with the faint forecast block on the map and the GB chart with its likely range. Drag the time bar to move. |
| Why a price moved (G-R 1:35) | **Forecast** tab: the **Why this price** card is under the chart. Click a country in the map to switch zone. |
| Wind paid to stop, 26 Oct (G-R 0:20) | **Hidden grid** tab, **Scotland’s wind, paid to stop**, **More detail**, **26 Oct storm**: 71.6 GWh switched off, £36.5m constraint bill. **Watch the storm that cost £36.5m** opens the event movie. |
| Carbon through the cables (G-R 1:05) | **Hidden grid** tab, **Carbon that comes in by cable**. |
| Strait of Hormuz (G-R 1:55, HRT 0:25) | **What if** tab, click **Gas gets dearer** (The Strait of Hormuz closes). It runs at once; the map tilts and the “What it would change” card counts up. **Why?** gives the one-paragraph reason, **For experts** the formula. |
| Norway link trips (HRT 1:15) | **What if** tab, click **The cable to Norway breaks**. |
| Battery (HRT 1:35) | **What if** tab, **More detail**, then the zone buttons (**GB** …) on the battery card. |
| Scoreboard (G-R 2:35, HRT 2:00) | **Proof** tab: “Can we trust the forecast?” card (backtest). **For experts** for the table by zone. |
| Replay the storm (HRT 2:20) | **Proof** tab, **Replay: 26 October storm →** (or the `#/replay` tab), **Play the day**. |
| Reveal (HRT 2:45) | **Proof** tab, **Day-ahead reveal →** (or the `#/reveal` tab). **Verify** under “Was the forecast changed after the fact?” re-checks the published fingerprint. |
| Play (either, if asked) | **Play** tab: **Quick play** (Beat the model) or **Play Market day solo**. `#/play?demo=1` is an offline rehearsal that touches nothing live. |

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
