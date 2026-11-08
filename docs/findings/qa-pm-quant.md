# Quant audit of the solo markets: a naive strategy beats the model maker

Task #236. Read-only: nothing in the engine, the module or the data changed. Written 8 November 2026.

## Summary

**Yes, a naive strategy beats the maker, by a lot.** Buying YES on every market at the open makes **+383 points a day** on the 1,000-point stake. The 95% interval is +140 to +591, and it is positive on 10 of 13 days. The best bot, The Committee, makes +91 a day. An HRT judge who presses YES five times wins.

| Check | Result |
|---|---|
| (b) Free lunch | **Always YES at the open**: +0.20 points per share (+20 cents on a 100-cent share), 95% interval +0.08 to +0.31 per share. Outcomes are YES in 46 of 65 markets (71%), but price markets open at 45 to 53. |
| (a) Leak before the reveal | **Wind market**: on 5 of 13 days the outcome is certain at the open, because wind switched off is cumulative and the GWh so far is already over the line. Yet the market opens at 83 to 87 and only reaches 94 to 95. Buying YES there wins 5 to 16 points per 100 shares with no risk. Price markets reach 3 or 97 before close in 16 markets, with one wrong-way extreme, and leave at most 2 points per 100 shares. |
| (c) Opens at 3 or 97 | None. The opposite problem: all 52 price markets open at 45 to 53, because the line is set at our own forecast median, so the open carries no information. |

## Data and method

- **Markets:** the 13 days with replay files on the runner (`/srv/hack/runner/data/replay`, 28 September to 6 November). They were rebuilt in a scratch run with `engine.pm.build.markets` and `validate`, the same code, data, bot league files and BOALF cache as `build --all`. Nothing was sent to the module.
- **Coverage:** 5 markets a day, 65 in all:
  - GB day-ahead at 18:00
  - GB system price at 15:00
  - DE-LU day-ahead at 17:00
  - FR day-ahead at 13:00
  - GB wind switched off by 17:00
- **Not checked against the live game:** `pm_day` is private, so I did not compare it with what is loaded live. If the runner rebuilt after the load, the numbers can differ slightly.
- **Pricing:** as in `spacetime/module/src/pm_math.ts`.
  - YES ask = price + 1; NO ask = 101 − price.
  - A winning share pays 1 point.
  - The price path is one price per game hour from 12:00 until the market closes.
  - Bots trade once at the open with `botOrder` (3-cent minimum edge, stake up to 20% of cash, at most 300 shares).
- **Units:** "per share" is points per share held to settlement.
- **Budgeted runs ("per day"):** start with 1,000 points, split equally across the markets traded, with at most 500 shares per market.
- **Intervals:** 95% bootstrap intervals resample days, not markets, because markets on one day share a forecast.
- **Sample size:** 13 days is a small sample. The free lunch is large enough that the interval still excludes zero.

## (b) Strategies against the maker

One share per entry, held to settlement.

| Strategy | Shares | Points per share | Per day, 1 share per market (95% interval) | Days positive |
|---|---|---|---|---|
| **Always YES at the open** | 65 | **+0.203** | +1.02 (+0.41 to +1.53) | 10/13 |
| Always NO at the open | 65 | −0.223 | −1.12 (−1.63 to −0.51) | 3/13 |
| Buy the cheaper side at the open | 65 | +0.047 | +0.24 (−0.57 to +0.97) | 7/13 |
| Buy the favourite at the open | 65 | −0.067 | −0.34 (−1.07 to +0.47) | 6/13 |
| Favourite when the price is below 20 or above 80 | 33 | −0.012 | −0.03 (−0.29 to +0.20) | 9/13 |
| Longshot when the price is below 20 or above 80 | 33 | −0.008 | −0.02 (−0.26 to +0.24) | 4/13 |
| Momentum: follow every hourly move | 180 | +0.045 | +0.62 (−0.25 to +1.31) | 10/13 |
| Fade every hourly move | 180 | −0.065 | −0.90 (−1.59 to −0.03) | 1/13 |
| Last hour, buy the favourite | 65 | +0.008 | +0.04 (−0.30 to +0.36) | 8/13 |
| Last hour, buy the longshot | 65 | −0.028 | −0.14 (−0.46 to +0.20) | 3/13 |

### Budgeted, against the bots (points per day on a 1,000-point stake)

| Player | Per day | 95% interval | Days positive |
|---|---|---|---|
| **Always YES at the open** | **+383** | +140 to +591 | 10/13 |
| YES on price markets, favourite on wind | +383 | +88 to +630 | 10/13 |
| Cheaper side at the open | +78 | −242 to +369 | 7/13 |
| The Committee (bot) | +91 | −47 to +220 | 9/13 |
| Yesterday (bot) | −32 | −194 to +135 | 6/13 |
| Our model, lgbm_q (bot) | −31 | −61 to +15 | 2/13 |
| The Engineer (bot) | −53 | −164 to +72 | 5/13 |
| Always NO at the open | −453 | −658 to −216 | 3/13 |

On 26 October only Our model trades: there is no bot league file for that day.

### By market

| Market | n | YES rate | Mean open | Brier at open | Brier at last hour | Always YES, per share | Momentum, per share |
|---|---|---|---|---|---|---|---|
| GB day-ahead, 18:00 | 13 | 0.77 | 0.50 | 0.243 | 0.062 | +0.257 | +0.025 |
| DE-LU day-ahead, 17:00 | 13 | 0.77 | 0.50 | 0.249 | 0.093 | +0.264 | +0.081 |
| FR day-ahead, 13:00 | 13 | 0.69 | 0.50 | 0.254 | 0.254 (one price only) | +0.183 | none |
| GB system price, 15:00 | 13 | 0.77 | 0.50 | 0.250 | **0.266** | +0.261 | **−0.166** |
| GB wind switched off by 17:00 | 13 | 0.54 | 0.48 | 0.084 | 0.032 | +0.050 | +0.138 |

### Calibration of the open price

| Open price | n | Mean price | YES rate |
|---|---|---|---|
| 0 to 19 | 3 | 0.18 | 0.00 |
| 20 to 39 | 4 | 0.26 | 0.25 |
| **40 to 59** | **53** | **0.50** | **0.75** |
| 80 and above | 5 | 0.83 | 1.00 |

### Why YES wins

`engine.market.questions.price_questions` sets the line at `nice(p50)`, which is our as-of median rounded to the nearest 10 (no rounding bias). So the open is about 50 by construction.

On these 13 days the replay's as-of medians are biased low in the afternoon. In 12:00 to 18:00, the actual came in above our P50 this share of the time:

| Market | Above P50, 12:00 to 18:00 | Above P50, other hours |
|---|---|---|
| BE day-ahead | 0.71 | 0.61 |
| DE-LU day-ahead | 0.68 | 0.48 |
| FR day-ahead | 0.74 | 0.65 |
| GB system price | 0.68 | 0.57 |
| GB day-ahead | 0.67 | 0.48 |
| NL day-ahead | 0.71 | 0.55 |
| NO2 day-ahead | 0.64 | 0.52 |

Each figure covers 91 hours (12:00 to 18:00) and 221 hours (other hours). Every question asks "above". So the model's bias becomes a one-sided free lunch that needs no skill at all.

## (a) Leaks before the reveal

### Wind switched off

The quantity is cumulative, so once the GWh so far passes the line, YES is settled. `wind_path` still blends the history-only probability with a logistic of the projection, so the price creeps up 2 to 3 cents an hour instead of jumping to 99.

| Day | Line | GWh by 13:00 | Price path, 12:00 to 16:00 | Outcome |
|---|---|---|---|---|
| 30 Sep | 40 | 68.9 | 83, 86, 89, 91, 94 | YES (locked by 12:00 or 13:00) |
| 9 Oct | 25 | 46.0 | 84, 87, 89, 92, 95 | YES (locked) |
| 10 Oct | 30 | 60.4 | 83, 86, 89, 92, 94 | YES (locked) |
| 13 Oct | 30 | 84.0 | 83, 86, 89, 92, 94 | YES (locked) |
| 27 Oct | 55 | 93.5 | 84, 87, 89, 92, 94 | YES (locked) |
| 24 Oct | 40 | 26.0 (43.0 at 16:00) | 34, 43, 51, 59, 68 | YES (locked from 16:00 at 68) |

- **Guaranteed profit:** the six locked markets, bought at the first locked hour, give 0.94 points per share in all, risk-free.
- **NO side:** on 31 Oct, 1 Nov and 6 Nov, 0.0 to 0.8 GWh had been switched off against lines of 25 to 50, with 4 to 5 hours left, yet NO still paid 14 to 15 points per 100 shares.
- **Direction is predictable:** the first hourly move of the wind price points to the outcome on 12 of 13 days.

### Price markets

- **Extremes before close:** 16 of 52 reach 3 or 97 before close, and 15 of those are right.
  - At 97 the YES ask is 98, so following the extreme earns at most 2 points per 100 shares. That is not material.
  - These are legitimate: the hour's actual is already in the feed.
- **GB system price over-reacts:**
  - Its last-hour Brier score (0.266) is worse than its open (0.250).
  - On 27 October it sat at 3 for two hours and settled YES.
  - Momentum loses 0.166 per share on this market.

## (c) Opens at 3 or 97

None of the 65. Wind opens range from 15 to 87. Every price market opens between 45 and 53, so the open says nothing and the only edge is the model's bias above.

## Smallest fixes, in order

1. **Kill the YES free lunch.** Ask half the price questions as "below X" (or flip the direction at random per day), so a one-sided bias in our median cannot be harvested by pressing one button. Better still, set the line away from P50 (for example a random quantile between P30 and P70), so the open varies and carries information. A bias correction to the median would also help the forecasts themselves.
2. **Wind:** set the price to 99 once the GWh so far exceeds the line, which is certain because the quantity is cumulative. Project from the remaining hours instead of blending in the history-only probability with a weight of h/18.
3. **GB system price:** damp the Nowcaster's reaction to one hour's miss. One noisy half-hour moves it from 49 to 3.
4. **FR day-ahead at 13:00** has one game hour, so it never moves. Either move it later or drop it.

Re-run this audit after any of these: the method is a single scratch script over `engine.pm.build.markets`, about 30 seconds on the runner.
