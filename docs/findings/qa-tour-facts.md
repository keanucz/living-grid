# Fact-check: onboarding tour captions

Task #245. This check is read-only and covers:
- `web/src/tour/chapters.js` and `web/src/tour/numbers.js` from #240, in all three orders (story, gresearch, hrt);
- for contradictions only, the older `web/src/tour/tours.js` and `demo/scripts/README.md`.

Live figures come from https://htb.stefvuck.dev/api at 01:31 UTC on 8 November 2026, the same requests `loadTourData()` makes, with region C (London). Fixed claims are checked against `engine/reference/facts/` and the README.

## Verdict

Every live token maps to a real API field with the right unit, so no caption shows a wrong number. But some captions say something the data does not support.

Five captions need text changes:
1. The battery caption claims "the six zones" when there are five, and it shows a different figure from the scoreboard.
2. "Every bar is a real cable": the continental bars are country borders, not single cables.
3. The constraint bill is presented as if it were all wind farms; it is the whole GB grid's bill.
4. The storm caption says "hours" for forecast-hours across seven price series.
5. The Solana step does not say devnet.

The presenter notes in `demo/scripts/README.md` contradict the live battery and Hormuz figures. There is no typed battery percentage in any tour caption: both battery figures are live tokens from `/scores`, as Keanu asked.

## Live tokens

| Token | API field | Live value | Unit and mapping | Verdict |
|---|---|---|---|---|
| `gb_price` | `/state` zones[GB].price.value | £181 | GBP/MWh, day-ahead (Nord Pool) | OK |
| `no2_price` | `/state` zones[NO2].price.value | €195 | EUR/MWh, day-ahead | OK (see caption 1) |
| `flows_gw` | sum of \|mw\| over `/state` flows (17 links) | 11.4 GW | MW → GW | OK. The three GB–SEM links share one Elexon total (1,294 MW) split evenly and are marked estimated, so nothing is counted twice |
| `gb_p6` | `/state?at=+6h` zones[GB].forecast.p50 | £213 | GBP/MWh, price_da, horizon 6 h | OK |
| `gb_band` | same, p10 and p90 | £191 and £227 | "four times in five" matches the calibrated 79.9% coverage | OK |
| `explain_sentence` | `/explain` sentence | "GB price up £3: time of day (−£14), demand down 20% (+£10), gas more often setting the price (+£4)…" | GBP | **Problem:** "demand down 20% (+£10)" contradicts itself. The demand group also contains residual load, which rises when wind is low, but the words come from the load forecast alone. Task **#247** (lane A) |
| `ghost_from`, `ghost_to`, `ghost_bill` | `/unseen/ghost-wind` constraint_costs | 17 October to 29 October, £205m | GBP, NESO daily "Constraints" category | Number OK; wording problem (caption 3) |
| `gb_prod`, `gb_cons` | `/state` zones[GB].carbon | 364 and 348 grams | gCO₂/kWh, modelled, IPCC lifecycle factors | OK, labelled modelled. NESO's Carbon Intensity API has GB at **266** for the same hour, as the `/regions` map layer shows (see caption 4) |
| `b6_line` | `/unseen/ghost-wind` boundary_flows | Live data has no B6 row, so the line names the fullest boundary: SSHARN 2.3 GW against 3.9 GW | MW → GW, NESO day-ahead forecast | OK as written. It never states B6's limit. If B6 is named, see "Fixed claims" |
| `storm_cost` | constant, fact `con_2026_10_26_cost` | £36.5m | NESO "Constraints" category for 26 October: £36,530,868.70; `/replay` agrees (36,530,869) | OK |
| `storm_inside` | `/replay` all series points | 78 of 168 | counts across 7 price series × 24 hours | Number OK; wording problem (caption 5) |
| `hormuz_cost` | `/scenarios` hormuz result.cost_total_gbp.p50 | £1.75bn | sum of 6 zones' cost in GBP; request magnitude 40, hours 336 (two weeks), not clamped | OK |
| `hormuz_gb` | hormuz zones[GB].avg_delta | about £38 a megawatt-hour | GBP/MWh | OK |
| `battery_risk` | mean of `/scores` battery[risk_aware].share_of_perfect, skipping nulls | 97% | mean of 5 zone ratios (NO2 is null) | **Problem:** the caption says "six zones" (caption 6) |
| `battery_median` | same for median_only | 93% | mean of 5 zone ratios | Same problem |
| `dc_line` | `/datacentre?locations=GB` sites[0] | 10.1 GWh a year, about £1.1m | MWh → GWh. 1,275 kW peak IT = 1.275 kW per H100 (fact `dc_dgx_h100_kw`: DGX H100 10.2 kW for 8 GPUs) × 60% × PUE 1.5. Priced at the mean Elexon system price over 365 days, £105/MWh | OK; it says "Modelled, not a quote" |
| `forecasts_scored` | `/scores` headline.forecasts_scored | 301 | count | Wording (caption 7) |
| `mae_model`, `mae_persistence` | `/scores` headline | 33.0 and 43.2 | MAE pooled over six zones, mixed £ and €; the caption carries no unit, which is right | **Contradiction:** the README says 43.3; the live value is 43.2475, which the tour shows as 43.2 (caption 7) |
| `coverage` | `/scores` headline.coverage_p10_p90 | 80% | 0.799 | OK |
| `frozen_at` | `/reveal` frozen_at | Saturday 7 November, 23:59 UTC | UTC | OK |
| `reveal_line` | `/reveal` zones_published, mean_abs_error | "The real result arrives when the auction publishes." (0 zones published yet) | – | OK |
| `tonight_line` | `/household/savings?region=C&devices=ev` tonight[ev] | London, from 03:00, about £1.16 dearer than the price cap | Europe/London (GMT); saving_vs_cap_gbp.p50 = −1.16 | OK; it shows the negative case honestly |

## Captions to change

| # | Step | Problem | Suggested text |
|---|---|---|---|
| 1 | `now.price` (all orders) | OK as written. `tours.js` `no2` uses the fallback "far cheaper", which is false tonight: NO2 €195 against GB £181 (about €208). | `tours.js` fallback: "a different price" |
| 2 | `now.flows` (all orders) | "Every bar on the map is a real cable" is true for the GB links. The continental bars (FR–BE, NL–DE and so on) are whole country borders, many lines each. | "{flows_gw} is crossing borders at this moment, and every bar on the map is a real connection between two countries." Fallback: "That gap is why power moves. Every bar is a real link between two countries, and its speed is how much is flowing." |
| 3 | `hidden.ghostwind` (story, gresearch) | The bill is NESO's daily "Constraints" category for the whole GB grid. That includes thermal constraints everywhere, not only Scottish wind farms. The caption reads as if all £205m went to switched-off wind. | "Scotland often makes more wind than the grid can carry south, so wind farms are paid to switch off. From {ghost_from} to {ghost_to} NESO paid {ghost_bill} to manage grid constraints, much of it for wind like this." |
| 4 | `hidden.carbon` (story, gresearch) | 364 g uses IPCC lifecycle factors. The same app's `/regions` map uses NESO's operational figure, 266 g for the same hour. A judge flipping layers sees two numbers for "Britain's carbon". | "On lifecycle emission factors, Britain’s own power emits {gb_prod} grams of carbon per kilowatt-hour; counting what comes in through the cables, what it consumes is {gb_cons}. Modelled, from standard estimates." |
| 5 | `storm.replay` (story, hrt) | "kept 78 of 168 hours inside its band": the 168 is 7 price series × 24 hours, and 78 of 168 is 46%, against an 80% target. Accurate, but it only sounds good if it is misheard. | "…A model that had seen nothing from that day on caught {storm_inside} of its hourly price forecasts inside its band: storms are where our bands are still too narrow." |
| 6 | `whatif.battery` (hrt, story) | "Shares are averaged over the six zones": NO2 has no share (perfect foresight earned €0 on flat prices), so it is five. The scoreboard headline shows **90.7%** pooled, because the pool wrongly includes NO2's −€45 (task **#246**), while this caption shows **97%**. Both are live and both roll daily, so no number is typed in, as required. | "…earns {battery_risk} of what perfect foresight would; one that trusts our median alone earns {battery_median}. Averaged over the zones where perfect foresight made money." After #246 merges, consider `headline.battery_share_of_perfect` for `battery_risk`, so the tour and the scoreboard show one number. |
| 7 | `trust.scores` (all orders) | "{forecasts_scored} forecasts are logged before their outcome is known": 301 is the number scored; 11,208 rows are logged. The persistence MAE shows 43.2 here and 43.3 in the README table, from the same backtest. | "Every forecast is logged before its outcome; {forecasts_scored} have been scored so far. Over the backtest our error is {mae_model} against {mae_persistence} for simply repeating the last known price, and {coverage} of outcomes land in the band." README: change 43.3 to 43.2, or the tour to `toFixed` with half-up rounding, so the two agree. |
| 8 | `trust.reveal` (all orders) | "posted on Solana": it is devnet, which the README says can be reset. | "…its fingerprint posted on Solana’s public test network (devnet), so it cannot be quietly changed." |
| 9 | `whatif.hormuz` (all orders) | "gas rises by 40%" is our scenario input, not a forecast. The IEA's "almost 20%" of global LNG through the Strait (fact `gas_hormuz_lng_share`) is the reason. | "Close the Strait of Hormuz, where almost a fifth of the world’s LNG passes, and suppose gas rises by 40%. Over two weeks that is about {hormuz_cost} more…" |

## Fixed claims

| Claim | Source | Verdict |
|---|---|---|
| "On 26 October a storm cost the grid £36.5m in constraint payments, NESO’s figure" (and the fallback) | `con_2026_10_26_cost`, verified: Constraints category £36,530,868.70 (the total balancing cost that day was £38.65m) | OK |
| "a model that had seen nothing from that day on" | `/replay` trained_before 2026-10-26, "Model asof-20261026 saw no data on or after 26 October 2026" | OK |
| "Scotland often makes more wind than the grid can carry south" | `con_b6_capability`: B6 6.7 GW planning capability (ETYS 2025), limited by the Harker–Moffat circuit; the daily operating limit is lower. `con_wind_curtailment_2025`: 10.2 TWh curtailed in 2025, **unverified** in our facts | OK as a general claim; do not quote the 2025 TWh figure until it is verified |
| B6 numbers | None appear in the tour. If a presenter adds one: 6.7 GW is the planning capability, not the day-to-day limit | No change |
| "gas rises by 40%" and "over two weeks" | `/scenarios` request: magnitude 40, hours 336 | OK (wording, caption 9) |
| Pass-through method | `/scenarios` method_note: gas change ÷ 58% CCGT efficiency + carbon × 0.334 t/MWh, weighted by gas marginal share; the `tours.js` hormuz step says it "approximates market coupling" | OK |
| "four times in five" | calibrated P10–P90 coverage of 79.9% (README; `/scores` 0.799) | OK |
| "A one-megawatt battery" | README: 1 MW / 2 MWh per zone | OK |
| "A thousand H100 GPUs … Modelled, not a quote" | `dc_dgx_h100_kw` (NVIDIA DGX H100 user guide, 10.2 kW per 8 GPUs) | OK |
| "Every forecast comes with its reasons: wind, demand, gas, imports and the time of day" | `schemas.GROUPS`: wind, solar, demand, gas, carbon, imports, time_of_day | OK |
| `tours.js`: "The time bar reaches back to January 2024" | `/timeline` from 2024-01-01 | OK |
| `turn.play`: "a real day whose date is hidden … revealed when the round ends" | game views (`web/src/views/play`, `game`) | Not checked in the UI; out of scope |

## Other pages that contradict the tour

| Where | Says | Live now | Fix |
|---|---|---|---|
| `demo/scripts/README.md`, "Known weak spots" | "Risk-aware battery shows a negative share of perfect foresight until #102 merges … Median-only at about 77% to 97%" | risk-aware 94.8–98.7% per zone (GB 98.7%), median-only 81.7–97.5%; #102 has merged | Rewrite: risk-aware is at or above median-only in every zone; quote the card, not a number |
| same | "Hormuz in GB: 'GB price up £1: gas up 40% (+£1)'" | "GB price up £38: gas up 40% (+£38)" | Delete the bullet |
| `/scores` headline | battery_share_of_perfect 0.9066, "Pooled over 6 zones" | per-zone 94.8–98.7%; 97.3% without NO2 | Task #246 (lane B) |
| `README.md` results table | persistence 43.3 | `/scores` 43.2475, shown as 43.2 | Caption 7 |

## Tasks opened

| Task | Lane | What |
|---|---|---|
| #246 | B | `compare.pooled_share` pools NO2's loss although NO2 has no share; the headline shows 90.7% instead of 97.3% |
| #247 | A | Explanation sentence words the demand group by load alone, so "demand down 20% (+£10)" contradicts itself |

Caption fixes 1–9 are for stefan-5 (#240 owner), sent on the bus.
