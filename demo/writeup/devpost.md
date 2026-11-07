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
- **World events.** One tap closes the Strait of Hormuz, trips the Norway cable, takes French reactors offline, or sends a storm over Scotland. A 40% gas rise for two weeks costs European consumers about £143M (P10 to P90: £86M to £200M). Tripping the 1.3 GW North Sea Link raises the GB price by about £5/MWh, about £3.6M to GB consumers in a day.
- **Batteries.** A 1 MW / 2 MWh battery per zone trades on our forecasts and is scored only on real outcomes, against a naive rule and perfect foresight.
- **Replay** of the 26 October storm with a model trained only on data from before that day.
- **Day-ahead reveal.** Monday's forecast is frozen and timestamped before the auctions close, then shown next to the real results as they land.
- **Household view**, reached by QR code: the cheapest window tonight to charge a car or run the dishwasher in your region, with a savings range.

## How we built it

Python 3.12 fetches and caches every public source as parquet: Energy-Charts, Nord Pool, Elexon Insights, Open-Meteo, NESO, the Carbon Intensity API, Octopus Agile, and Yahoo Finance for TTF gas and EUA carbon. A scheduler builds features and appends forecasts to an append-only log at five past each hour; every row carries `made_at`. A scorer joins forecasts to outcomes only where the forecast was made first. FastAPI serves state, explanations, interventions, replay and scores. SpacetimeDB 2.14 holds the live shared state so every screen updates at once. The front end is React with deck.gl 9.4 and MapLibre 5.24.

The three of us each ran one to three Claude Code agents on a shared VPS. They took small, path-scoped tasks from a shared board, and a merge queue landed each one only when the tests and the web build passed.

Every constant in the engine (interconnector capacities, plant efficiencies, emission factors, boundary limits) is stored with its source URL, the quote it came from and a confidence rating. 51 of 53 pass an independent re-check; the code refuses to load the other two.

## Results

Walk-forward backtest, six folds of seven days with a 48-hour purge, on day-ahead prices:

| Model | MAE |
|---|---|
| Our LightGBM quantile model | **31.6** |
| Same hour yesterday | 36.8 |
| Persistence (last known price) | 43.7 |

That is 28% better than persistence. We lose to persistence on NO2 prices and French wind, and the scoreboard shows those rows.

The bands are too narrow. Across the backtest 63% of outcomes fell inside P10 to P90, against about 80% for a calibrated model. The replays show where:

| Day | Hours inside the band |
|---|---|
| 2 November 2026 (calm) | 136 of 168 (81%) |
| 26 October 2026 (storm) | 83 of 168 (49%) |

Live forecasts scored during the event: *[fill from /scores headline.forecasts_scored on Sunday morning]*.

## Challenges

- **Gas shocks the model has never seen.** Two years of history cannot teach a model what a Hormuz closure does. Interventions on gas and carbon use a merit-order estimate instead: price change is roughly gas change divided by 58% plant efficiency, plus carbon change times 0.334 t/MWh, weighted by the share of hours gas sets the price. The screen says this approximates market coupling.
- **Honest scoring.** It is easy to make a forecast look good by accident. The log is append-only, nothing is backfilled, and only forecasts made before their outcome count.
- **Messy public data.** Prices moved to 15-minute resolution in October 2025, Energy-Charts reports load for all of Norway rather than NO2, and only some wind units on Elexon carry a region, so we mapped the large Scottish farms by hand.

## What we learned

Uncertainty bands that look fine on calm days fall apart in storms, exactly when they matter most. Showing that openly made the project more convincing, not less.

## What's next

- Recalibrate the P10 to P90 bands so 80% coverage holds in bad weather as well as calm.
- Use metered unit output for the second ghost wind estimate (the gap between weather-implied and metered output).
- Extend from six zones to the rest of the coupled European market.

## Built with

Python, pandas, LightGBM, scikit-learn, FastAPI, SpacetimeDB, React, Vite, deck.gl, MapLibre, Energy-Charts, Nord Pool, Elexon Insights, NESO, Open-Meteo, Carbon Intensity API, Octopus Agile, Claude Code.
