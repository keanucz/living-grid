# Demo scripts

Two three-minute scripts, one story. Pick by who is at the table:

- `g-research-first.md`: making the unseen seen leads, prediction is the proof.
- `hrt-first.md`: prediction and decisions lead, the unseen is context.

Both were timed against https://htb.stefvuck.dev on Saturday 7 November at about 17:40 UTC. Spoken text is 330 to 380 words each, roughly 2 minutes 20 to 2 minutes 35 seconds at a calm pace, leaving 30 seconds for clicks and the pound counter.

## Before you start (both scripts)

1. Open https://htb.stefvuck.dev full screen at 1080p. Check the top-right chip says **Live**. If it says **Fixture data**, carry on: every step below still works from the bundled fixtures.
2. Open two more tabs, ready to switch to: `https://htb.stefvuck.dev/#/replay` and `https://htb.stefvuck.dev/#/reveal`. Keep `#/household` on a phone for the QR moment.
3. Turn the **Ghost wind** chip on once so its data is cached, then click **Last 24 h** in the constraint card to reset.
4. Pre-warm Simulate: click **Simulate**, run **Strait of Hormuz** once, then click back to **Overview**. The first `/intervene` call is the slowest.

## Click paths that do not work yet (as of 17:40 Saturday)

- The left rail icons **Scoreboard**, **Batteries**, **Replay** and **Household** do nothing. Use the scoreboard card on Overview, the battery card in Simulate, and the hash URLs above.
- The **Forecast** tab is greyed out ("Coming soon"). The forecast ghost lives on Overview: the **Forecast ghost** chip and the scrubber at the bottom.
- The live ghost wind window (last 24 h) is empty on a calm day. Click **26 Oct storm** in the constraint card. If it was empty on load, the card switches itself and says so.
- `/reveal` returns "not frozen yet" until the 23:59 UTC Saturday freeze.

## Live numbers to expect (Saturday 17:40 UTC; re-check on Sunday morning)

| Where | Figure |
|---|---|
| Overview headline | GB about £268/MWh, coupled continent about €322, NO2 €205 (cheapest) |
| Constraint card, 26 Oct storm | about 71.6 GWh of accepted bids on mapped Scottish wind units (65 GWh in North Scotland); £36.5M NESO constraint costs |
| Carbon, GB at 16:00 UTC | 370 g/kWh produced, 347 g/kWh consumed, 7% imported (modelled) |
| Hormuz, +40% gas for 14 days | about £143M to consumers (P10 to P90: £86M to £200M); biggest rises in NO2, France and Belgium |
| Norway link trip, 1.3 GW for 24 h | GB up about £5/MWh, about £3.6M to GB consumers; "less from Norway (+£5)" |
| Replay, 26 Oct | 83 of 168 zone-hours inside the band (49%) |
| Backtest | MAE 31.6 against persistence 43.7 (28% better); band coverage 63%, target 80% |

## Known weak spots to steer around

- **Hormuz in GB:** the explanation reads "GB price up £1: gas up 40% (+£1)". GB's gas marginal share is a prior, so the GB move is small. Point at the continent, not GB.
- **Risk-aware battery:** shows a negative share of perfect foresight until task #102 merges. Do not claim risk-aware beats median-only unless the card has changed. Median-only at about 77% to 97% of perfect is real and safe to show.
- **Live scoreboard:** only one live forecast scored as of Saturday evening. Lead with the backtest numbers (labelled Backtest on the card) and say how many live ones have been scored when you present.
