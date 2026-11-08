# The Living Grid

Electricity is invisible. The Living Grid makes Europe's hidden power system visible, forecasts where it is heading with honest uncertainty, and lets you test what happens when the world changes.

**Live:** https://htb.stefvuck.dev

Tracks: G-Research, "Making the Unseen Seen", and HRT, "Best Use of Data for Predictions and Decision Making".

## Inspiration

Power prices in Britain and across Europe swing by hundreds of pounds a megawatt hour within a day, and most of the reasons are hidden: wind farms paid to switch off because the grid cannot carry their power, carbon arriving through undersea cables, gas setting the price in some hours and not others. We wanted to put all of it on one map, then ask the questions that matter to a grid operator, a battery owner or a household on a tariff that changes through the day: where is the price going, how sure are we, and what happens if something breaks?

## What it does

- **A live map** of six zones (Great Britain, France, Germany-Luxembourg, the Netherlands, Belgium and southern Norway), coloured by this hour's day-ahead price, with interconnector flows drawn as moving light.
- **Ghost wind.** On 26 October 2026 a storm hit Scotland. Accepted balancing bids on mapped Scottish wind units add up to about 72 GWh for that day, most of it in North Scotland, and NESO puts GB constraint costs at £36.5M for the day. We show it as a glow over Scotland with the bill counting up, labelled as an estimate.
- **Carbon traced through imports.** Consumption-based intensity per zone: local generation times standard emission factors, plus imports times the exporter's intensity. At 16:00 UTC on 7 November, GB generated at about 370 gCO₂/kWh and consumed at about 347, because 7% of its power came in from cleaner neighbours.
- **Forecasts with bands.** LightGBM quantile models give P10, P50 and P90 for GB system price, load, wind and next-day prices. A translucent ghost layer shows the forecast state; it fades as the band widens. Each forecast comes with a plain-English explanation built from the model's own feature contributions.
- **World events.** One tap closes the Strait of Hormuz, trips the Norway cable, takes French reactors offline, or sends a storm over Scotland. A 40% gas rise for two weeks costs consumers in the six zones about £1.75bn (P10 to P90: £1.05bn to £2.46bn) and lifts the GB price by about £38/MWh. Tripping the North Sea Link, at its recent flow of about 980 MW, raises the GB price by about £4/MWh, about £2.6M to GB consumers in a day (P10 to P90: £1.5M to £3.7M).
- **Batteries.** A 1 MW / 2 MWh battery per zone trades on our forecasts and is scored only on real outcomes, against a naive rule and perfect foresight. Over the 155 hours settled so far it has made 97.6% of what perfect foresight would have (pooled over five zones; NO2 is too flat to score), against 87% to 89% for the naive rule.
- **Replay** of the 26 October storm with a model trained only on data from before that day.
- **Day-ahead reveal.** Monday's forecast is frozen and timestamped before the auctions close, then shown next to the real results as they land.
- **Household view**, reached by QR code: the cheapest window tonight to charge a car or run the dishwasher in your region, with a savings range.

## How we built it

Python 3.12 fetches and caches every public source as parquet: Energy-Charts, Nord Pool, Elexon Insights, Open-Meteo, NESO, the Carbon Intensity API, Octopus Agile, and Yahoo Finance for TTF gas and EUA carbon. A scheduler builds features and appends forecasts to an append-only log at five past each hour; every row carries `made_at`. A scorer joins forecasts to outcomes only where the forecast was made first. FastAPI serves state, explanations, interventions, replay and scores. SpacetimeDB 2.14 holds the live shared state so every screen updates at once. The front end is React with deck.gl 9.4 and MapLibre 5.24.

The three of us each ran one to three Claude Code agents on a shared VPS. They took small, path-scoped tasks from a shared board, and a merge queue landed each one only when the tests and the web build passed.

Every constant in the engine (interconnector capacities, plant efficiencies, emission factors, boundary limits) is stored with its source URL, the quote it came from and a confidence rating. 51 of 53 pass an independent re-check; the code refuses to load the other two.

## Results

Walk-forward backtest on day-ahead prices: twelve folds of seven days (mid-August to 8 November 2026) with a 48-hour purge and split-conformal band calibration, 12,086 hours over six zones:

| Model | MAE |
|---|---|
| Our LightGBM quantile model | **33.3** |
| Same hour yesterday | 36.7 |
| Persistence (last known price) | 52.3 |

That is 36% better than persistence. Per zone we beat persistence everywhere except NO2, where we are level, and we lose to same-hour-yesterday in France and NO2. The same folds on the other targets:

| Target | Our model | Same hour yesterday | Persistence | Inside P10 to P90 |
|---|---|---|---|---|
| Load (MW) | **1,211** | 1,854 | 5,068 | 80.5% |
| Wind (MW) | **2,113** | 3,532 | 2,860 | 76.3% |
| GB system price (£/MWh) | **43.4** | 56.5 | 62.7 | 76.6% |

We lose to yesterday on Dutch load (a break in the Energy-Charts series on 10 October) and to persistence on French wind, and the scoreboard shows those rows.

The bands are close to honest: 78.5% of day-ahead outcomes landed inside P10 to P90, against a target of 80%. Two single-day replays, each forecast 12 hours ahead by a model trained only on data before that day, show where that holds and where it breaks:

| Day | Hours inside the band |
|---|---|
| 2 November 2026 (ordinary wind) | 155 of 168 (92%) |
| 26 October 2026 (storm) | 78 of 168 (46%) |

On an ordinary day, after a week that contained the storm, the calibrated band is cautious and catches more than 8 hours in 10. The storm is the day the model was too sure; its replay model was trained before the calibration existed.

Live forecasts scored during the event: 879 by 06:00 UTC on Sunday 8 November, since 13:48 UTC on Saturday, all logged before their outcome was known.

## Challenges

- **Gas shocks the model has never seen.** Two years of history cannot teach a model what a Hormuz closure does. Interventions on gas and carbon use a merit-order estimate instead: price change is roughly gas change divided by 58% plant efficiency, plus carbon change times 0.334 t/MWh, weighted by the share of hours gas sets the price. The screen says this approximates market coupling.
- **Honest scoring.** It is easy to make a forecast look good by accident. The log is append-only, nothing is backfilled, and only forecasts made before their outcome count.
- **Messy public data.** Prices moved to 15-minute resolution in October 2025, Energy-Charts reports load for all of Norway rather than NO2, and only some wind units on Elexon carry a region, so we mapped the large Scottish farms by hand.

## What we learned

Uncertainty bands that look fine on calm days fall apart in storms, exactly when they matter most. Showing that openly made the project more convincing, not less.

## What's next

- Make the bands hold in storms as well as on ordinary days: calibration brought the backtest to 78.5%, but the storm replay still catches only 46%.
- Use metered unit output for the second ghost wind estimate (the gap between weather-implied and metered output).
- Extend from six zones to the rest of the coupled European market.

## Built with

Python, pandas, LightGBM, scikit-learn, FastAPI, SpacetimeDB, React, Vite, deck.gl, MapLibre, Energy-Charts, Nord Pool, Elexon Insights, NESO, Open-Meteo, Carbon Intensity API, Octopus Agile, Claude Code.
