# Bot league refresh: 12 folds with the calm and storm split

Task #334, following #332.

## Run

- **Command:** `LG_OFFLINE=1 OMP_NUM_THREADS=2 nice -n 19 uv run python -m pipeline.bot_league --folds 12 --threads 2 --no-replay`.
- **When:** 8 November 2026, 07:29 to 07:47 UTC (18 minutes, inside the 25-minute box).
- **Where:** an agent worktree whose `data/` reads the runner's cached inputs through symlinks.
- **Output:** `data/backtest/bot_league.json` and `bot_league_rows.parquet` were written to the worktree, not the runner.
- **Replay refits:** skipped (`--no-replay`), because the README section only uses the backtest rows.
- **Folds:**
  - 12 folds of 7 days, mid-August to 8 November.
  - Day-ahead: 12,096 zone-hours.
  - GB system price: 2,000 hours.
- **Storm days:** the top 15% of days by mean GB wind, 11 of 85: 4, 8, 17, 18 and 19 September; 9, 10, 13, 24, 26 and 27 October.

## Check against the runner's file

The runner's `bot_league.parquet` of 02:07 has the same folds without a regime column. Pooled by `n`, it gives our model 33.26 MAE against the Committee's 34.04, with pinball 11.00 against 11.75.

This run gives 33.5 against 34.1 and 11.1 against 11.8. The small gap comes from 10 extra hours of data that arrived since then (12,096 rows against 12,086). The order of the models is the same.

## Day-ahead prices

| Model | MAE all | MAE calm | MAE storm | Pinball all | Cover all | Cover calm | Cover storm | Brier all | Brier calm | Brier storm |
|---|---|---|---|---|---|---|---|---|---|---|
| Our model | 33.5 | 32.0 | 43.9 | 11.1 | 0.78 | 0.79 | 0.67 | 0.150 | 0.152 | 0.138 |
| The Committee | 34.1 | 32.1 | 47.4 | 11.8 | 0.74 | 0.76 | 0.62 | 0.151 | 0.150 | 0.160 |
| Yesterday bot | 36.6 | 34.0 | 53.9 | 13.1 | 0.76 | 0.79 | 0.62 | 0.168 | 0.167 | 0.170 |
| The Engineer | 43.1 | 40.1 | 62.8 | 14.1 | 0.76 | 0.78 | 0.66 | 0.201 | 0.200 | 0.203 |
| Last week | 55.4 | 53.0 | 70.9 | 19.1 | 0.69 | 0.71 | 0.53 | 0.243 | 0.243 | 0.248 |
| Persistence | 52.2 | 50.9 | 61.2 | | | | | 0.338 | 0.349 | 0.267 |
| Same hour yesterday | 36.6 | 34.0 | 53.9 | | | | | 0.215 | 0.211 | 0.235 |

**Diebold-Mariano tests**, ours against each, on absolute error:

| Against | All | Calm | Storm |
|---|---|---|---|
| The Committee | p 0.49 | p 0.89 | p 0.09 |
| Yesterday bot | p 0.25 | p 0.49 | p 0.06 |
| The Engineer, Last week, persistence | ours better, p < 0.01 everywhere | | |

## GB system price

| Model | MAE all | MAE calm | MAE storm | Pinball all | Pinball calm | Pinball storm | Cover storm | Brier all |
|---|---|---|---|---|---|---|---|---|
| Our model | 43.4 | 41.8 | 53.8 | 13.7 | 13.3 | 16.0 | 0.78 | 0.196 |
| The Committee | 43.4 | 41.3 | 57.6 | 14.6 | 14.1 | 18.4 | 0.77 | 0.189 |
| The Engineer | 43.5 | 41.2 | 58.5 | 13.9 | 13.3 | 18.2 | 0.59 | 0.188 |
| Yesterday bot | 56.5 | 54.3 | 71.5 | 18.7 | 18.0 | 23.4 | 0.67 | 0.245 |
| Last week | 65.4 | 63.0 | 80.7 | 21.5 | 20.9 | 25.9 | 0.66 | 0.272 |
| Persistence | 62.8 | 59.7 | 82.9 | | | | | 0.381 |

**Diebold-Mariano tests:**
- **Against the Committee and the Engineer:** no significant difference in any regime (p 0.25 to 1.0).
- **Against Yesterday, Last week and persistence:** ours better (p ≤ 0.01).

## What changed from the Saturday 20:57 run in the README

The Saturday run covered 6 folds and 43 days, 6 of them storm days.

- **Day-ahead headline:** it said "a tie, the Committee edges us on pinball (11.5 against 11.6)". Now we have the lowest pinball overall and in both regimes (11.1 against 11.8). The Diebold-Mariano test still can't separate us from the Committee, so the README says the lead is not proven.
- **The Engineer as "the storm specialist":** that no longer holds. In storms it is fourth on day-ahead prices (62.8). On system price its storm band catches only 59%.
- **System price:** before, we had the best Brier in every regime. Now the Engineer and the Committee have a slightly better Brier (0.188 and 0.189 against our 0.196). We keep the lowest pinball overall and in storms.
- **Storm coverage:** "every band is too narrow in storms (66% to 72%)" becomes 67% at best on day-ahead prices. On system price ours holds at 78% and the Committee's at 77%.

## Not done

- **The runner has no `bot_league.json`**, only `bot_league.parquet` from 02:07.
  - **Who reads the JSON:** the `/scores` bot league and the quant slide. Neither is checked here.
  - **What exists:** this run's JSON is in the keanu-1 worktree at `data/backtest/bot_league.json`. It was not copied to the runner, because nobody asked for that.
