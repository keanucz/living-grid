# Deck review: round 0

Stills of every scene at 25%, 60%, 95% of its length (1280px wide), in `contact-sheet.png` (one row per scene, left to right 25% / 60% / 95%).
Snapshot taken 2026-11-08T01:45:21.773Z. "Traced" says whether the number can be found in `data/snapshot.json` (as is, as a percentage, per hour or in thousands or millions); NO means check it, it may be derived or typed by hand.

## hook: 0:00 to 0:15 (15 s)

[25%](hook-25.png) at 3.7 s · [60%](hook-60.png) at 9.0 s · [95%](hook-95.png) at 14.2 s

On screen at the end of the scene:

> THE LIVING GRID
> Electricity is invisible.
> You cannot see what it costs, where it flows or where its carbon comes from. This is the price across Europe right now.
> GB £181
> FR €215
> DE-LU €215
> NL €215
> BE €215
> NO2 €195
> The Living Grid
> Source: /state · 2026-11-08 01:45 UTC

| Number shown | Traced to snapshot.json |
|---|---|
| £181 | yes |
| €215 | yes |
| €195 | yes |

## problem: 0:15 to 0:35 (20 s)

[25%](problem-25.png) at 5.0 s · [60%](problem-60.png) at 12.0 s · [95%](problem-95.png) at 19.0 s

On screen at the end of the scene:

> THE PROBLEM
> Clean at home, dirty by cable.
> 342 g
> BE: MADE AT HOME, PER KWH
> 379 g
> USED, COUNTING IMPORTS, PER KWH
> 19%
> SHARE OF POWER IMPORTED
> A country’s own grid can look cleaner than the power it actually uses.
> The Living Grid
> Source: /unseen/carbon · 2026-11-08 01:45 UTC

| Number shown | Traced to snapshot.json |
|---|---|
| 342 g | yes |
| 379 g | yes |
| 19% | yes |

## built: 0:35 to 0:55 (20 s)

[25%](built-25.png) at 5.0 s · [60%](built-60.png) at 12.0 s · [95%](built-95.png) at 19.0 s

On screen at the end of the scene:

> WHAT WE BUILT
> Then forecast, and say how sure we are.
> 0
> 100
> 200
> GB price on 26 October: actual, our forecast (dashed) and its P10 to P90 band, made with data from before the day
> Next hour in Great Britain: £213, probably between £186 and £219.
> The Living Grid
> Source: /state · 2026-11-08 01:45 UTC

| Number shown | Traced to snapshot.json |
|---|---|
| 0 | yes |
| 100 | yes |
| 200 | yes |
| 26 | yes |
| £213, | yes |
| £186 | yes |
| £219 | yes |

## product: 0:55 to 2:00 (65 s)

[25%](product-25.png) at 16.2 s · [60%](product-60.png) at 39.0 s · [95%](product-95.png) at 61.7 s

On screen at the end of the scene:

> THE PRODUCT · DATA CENTRES
> Where to put a data centre
> A 1,000-GPU site, 20% of the work movable within the day.
> Energy cost and carbon, by country. Estimates, not quotes.
> 1,000
> GPUS IN THE EXAMPLE
> Where to put a data centre
> The Living Grid
> Source: /datacentre · 2026-11-08 01:45 UTC

| Number shown | Traced to snapshot.json |
|---|---|
| 1,000 | yes |
| 20% | yes |

## proof: 2:00 to 2:25 (25 s)

[25%](proof-25.png) at 6.2 s · [60%](proof-60.png) at 15.0 s · [95%](proof-95.png) at 23.7 s

On screen at the end of the scene:

> PROOF
> Monday’s forecast, frozen before the result.
> 0
> 170
> 339
> GB day-ahead forecast for 2026-11-09 (dashed), P10 to P90 band
> Frozen: 2026-11-07 23:59 UTC
> Commitments on Solana devnet: 9
> Latest hash: 3e938fc199f4…
> Each frozen forecast is fingerprinted on a public chain, then compared with the real auction result.
> The Living Grid
> Source: /commitments, /reveal · 2026-11-08 01:45 UTC

| Number shown | Traced to snapshot.json |
|---|---|
| 0 | yes |
| 170 | yes |
| 339 | yes |
| 2026 | year |
| 11 | yes |
| 09 | yes |
| 07 | yes |
| 23 | yes |
| 59 | yes |
| 9 | yes |
| 3 | yes |

## play: 2:25 to 2:40 (15 s)

[25%](play-25.png) at 3.7 s · [60%](play-60.png) at 9.0 s · [95%](play-95.png) at 14.2 s

On screen at the end of the scene:

> PLAY
> Can you beat our model?
> Call the grid on a real day with its date hidden. Buy and sell Yes or No on questions such as “will GB wind be switched off?”, against our forecasters.
> 33.0
> OUR AVERAGE ERROR TO BEAT (£ PER MWH, BACKTEST)
> The Living Grid
> Source: /scores · 2026-11-08 01:45 UTC

| Number shown | Traced to snapshot.json |
|---|---|
| 33.0 | yes |

## how: 2:40 to 2:55 (15 s)

[25%](how-25.png) at 3.7 s · [60%](how-60.png) at 9.0 s · [95%](how-95.png) at 14.2 s

On screen at the end of the scene:

> HOW WE BUILT IT
> Three people and a lot of Claudes.
> 234
> TASKS MERGED THROUGH ONE QUEUE
> 15
> AGENTS THAT MERGED THEM
> Python and LightGBM for the forecasts, FastAPI for the engine, React and deck.gl for the map, SpacetimeDB for shared live state.
> The Living Grid
> Source: hub.db · 2026-11-08 01:45 UTC

| Number shown | Traced to snapshot.json |
|---|---|
| 234 | yes |
| 15 | yes |

## close: 2:55 to 3:05 (10 s)

[25%](close-25.png) at 2.5 s · [60%](close-60.png) at 6.0 s · [95%](close-95.png) at 9.5 s

On screen at the end of the scene:

> CHECK IT YOURSELF
> htb.stefvuck.dev
> Every frozen forecast is hashed on Solana (FYgaqP…fS2x). Open it on your phone and call the grid yourself.
> Built at HackTheBurgh XIII. Public data only.
> The Living Grid
