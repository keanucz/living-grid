# Live freshness check: ingests and endpoints, 8 November 2026, 01:15 UTC

Task #238. This check is read-only. It covers:
- the runner's data in `/srv/hack/runner/data`;
- the scheduler log `/srv/hack/logs/scheduler.log`, from 19:15 to 01:15 UTC;
- every public GET in `engine/contract/openapi.json`, called at https://htb.stefvuck.dev/api/;
- the live SpacetimeDB tables.

The runner is at `5459eed`; the API is deployed at `7a242b4`.

## Verdict

Nothing is broken, and nothing that the demo needs is stale.
- **Scheduler:** every hourly run in the last 6 hours finished and logged forecasts. One run was skipped at 21:05 because the previous run was still going.
- **Endpoints:** all 20 public GETs return 200, all but `/timeline` (2.4 s) in under a second.
- **Two real gaps:**
  - `/state` drops carbon for NL, BE and NO2 because its cut-off is shorter than Energy-Charts' lag (#242).
  - `/state` has no NO2 load or mix, because Elhub lands about a day late (#243).
- **One transient error:** the NESO ingest timed out once, at 01:09.

Every other "old" timestamp is the source's normal publication lag, explained below.

## Ingests

"Data to" is the newest row timestamp at or before now; the latest write was at 01:15. Status key:
- **OK:** current.
- **Lag (expected):** the source publishes this late; not a fault.
- **Note:** worth knowing, but not a fault.

| Source (scheduler job) | File | Written (UTC) | Data to | Expected cadence and lag | Status |
|---|---|---|---|---|---|
| elexon | `actuals/elexon_*` (system price, load, generation by fuel, 7 links, MID) | 01:05 | 08 Nov 00:00 | hourly; system price ~20 min | OK |
| energy_charts | `actuals/energy_charts_{price_da,load,generation,flows}` | 01:07 | prices 08 Nov 22:00 (day-ahead); load and generation DE-LU, FR 07 Nov 23:00, NL 22:00, BE and NO2 21:00 | hourly; metered ~2–4 h behind | OK (see #242) |
| nordpool | `actuals/nordpool_price_da` | 01:07 | 08 Nov 22:00 (day-ahead) | hourly; next day ~10:00–12:10 UK | OK |
| markets | `markets/gas_carbon` | 01:07 | 06 Nov | daily, trading days only | OK (Friday close; weekend) |
| carbon_intensity | `carbon_intensity/regional`, `regional_mix`, `actuals/carbonintensity_ci_gco2_kwh` | 01:07 | 08 Nov 00:00 | hourly | OK |
| octopus | `octopus/agile` | 01:07 | 08 Nov 22:30 (published) | daily ~16:00 UK | OK |
| open_meteo_live | `weather/live_forecast` | 01:07 | to 10 Nov 23:00 | hourly | OK |
| boalf | `boalf/wind_bids`, `actuals/elexon_boalf_mwh`, `boalf/wind_units` | 01:07 | bids 05 Nov 19:00; hourly totals 08 Nov 01:00 | hourly | Note (below) |
| metered | `boalf/wind_metered` | 01:07 | 08 Nov 00:00 | hourly (B1610 ~5 days, PN fills the gap) | OK |
| neso | `neso/constraint_costs`, `neso/boundary_flows`, `actuals/neso_constraint_cost_gbp` | 00:08 | costs 29 Oct; flows 07 Nov 23:00 | hourly; costs ~1 week behind | Lag (expected); the 01:09 run timed out |
| neso_boundaries | `neso/boundaries_all` | 01:09 | 07 Nov 23:00 (day-ahead) | hourly | OK |
| weather_grid | `weather_grid/hourly` | 00:10 | to 09 Nov 23:00 | every 6 h | OK |
| uk_ets | `markets/uk_ets` | 00:10 | 01 Sep (monthly) | daily check; DESNZ publishes monthly, ~6 weeks behind | Lag (expected) |
| elhub | `actuals/elhub_{load,generation}` | 01:09 | 06 Nov 22:00 | hourly; hours land D+1 to D+2 | Lag (expected) (see #243) |
| mid_proxy | `actuals/mid_price_da` | 00:27 | 08 Nov 00:00 | backfill only; fills GB history older than Nord Pool's ~60 days | OK (not a live source) |
| carbon tracing | `carbon/consumption_intensity`, `import_contributions` | 01:15 | 08 Nov 00:00 (GB); continent 21:00–23:00 | hourly, follows Energy-Charts | OK |
| scheduler forecasts | `forecasts/log` | 01:10 | made at 01:05 | hourly | OK |
| scorer | `scores/scores`, `scores/overall` | 01:12 | 301 forecasts scored | hourly | OK |
| features | `features/latest` | 01:10 | 08 Nov 01:00 to 10 Nov 01:00 | hourly | OK |
| freeze | `forecasts/frozen_monday` | 23:59 | 144 rows frozen at 23:59:02 (committed to devnet) | one-off | OK |

**BOALF:** wind bids last appear on 5 November at 19:00. This is the source, not the ingest. I queried Elexon's acceptance volumes directly, checking three settlement periods per day against the 286 mapped wind units:

| Day | Acceptance rows (3 periods) | Mapped wind-unit rows |
|---|---|---|
| 28 Oct | 1,540 | 370 |
| 3 Nov | 719 | 0 |
| 4 Nov | 612 | 0 |
| 5 Nov | 759 | 30 |

On 7 November, Elexon returns 245 acceptances in period 20, none of them for wind units. GB wind fell to an average of about 1 GW on 7 November, against about 8.7 GW on 5 November. So "last 24 h" ghost wind is genuinely zero tonight. The ghost wind story has to come from the replay of 26 October or the 7-day window, not from the last hours.

**Forecast count:** forecast rows per run fell from 912 to 816 after the 20:46 retrain. This is intended: NO2 load and wind are no longer targets, because Energy-Charts' Norway series cover the whole country (`train.target_frames`).

## Scheduler log, last 6 hours

| Time (UTC) | Event |
|---|---|
| 19:05–20:07 | Two runs completed; 912 forecasts each |
| 21:05 | "previous run still going, skipping"; it reran at 21:28 |
| 21:28–00:10 | Four runs completed; 816 forecasts each |
| 01:05–01:10 | Completed. One warning: `refresh failed for neso` (`httpx.ReadTimeout` from api.neso.energy); forecasts made from cache |

There were no other warnings or tracebacks in the window. The older errors in the log are from 7 November, 13:48–15:07, before this window:
- an Elexon "server disconnected" error;
- a `gas_carbon` timezone error;
- a merge-key dtype error.

None of them has recurred since.

## Endpoints

Each endpoint was called once, at about 01:20 UTC, from the VPS through the public proxy. "Newest" is the latest timestamp anywhere in the body; "≤ now" is the newest one not in the future.

| GET | Status | Latency | Size | Newest | ≤ now | Notes |
|---|---|---|---|---|---|---|
| /health | 200 | 0.02 s | 0 KB | – | – | `{"ok":true,"offline":false}` |
| /zones | 200 | 0.02 s | 74 KB | – | – | static |
| /state | 200 | 0.28 s | 5 KB | at 08 Nov 01:00 | 01:00 | carbon missing for NL, BE and NO2; NO2 load and mix empty (#242, #243) |
| /explain | 200 | 0.07 s | 1 KB | ts 08 Nov 02:00 | – | next forecast hour |
| /scores | 200 | 0.04 s | 47 KB | as_of 08 Nov 00:00 | 00:00 | 301 scored since 13:48; live MAE 33.0 against persistence 43.2; coverage 79.9%; battery 90.7% of perfect over 186 h |
| /scenarios | 200 | 0.01 s | 81 KB | 09 Nov 21:00 | 08 Nov 01:00 | |
| /household | 200 | 0.12 s | 5 KB | 09 Nov 00:30 | 01:00 | |
| /household/savings | 200 | 0.17 s | 3 KB | 08 Nov 22:30 | – | |
| /impact/renewables?zone=GB | 200 | 0.09 s | 5 KB | to 08 Nov 00:00 | 00:00 | #216 cache in place |
| /impact/renewables?zone=FR | 200 | 0.32 s | 6 KB | to 07 Nov 23:00 | 23:00 | |
| /regions | 200 | 0.70 s | 8 KB | 08 Nov 05:30 | at 00:00 | all 14 regions have carbon and published Agile prices |
| /replay | 200 | 0.02 s | 31 KB | 26 Oct 23:00 | 26 Oct 23:00 | fixed event |
| /reveal | 200 | 0.10 s | 17 KB | 09 Nov 22:00 | frozen 07 Nov 23:59 | |
| /timeline | 200 | **2.40 s** | 309 KB | 08 Nov 22:00 | 08 Nov 00:00 | slowest; acceptable for a one-off load |
| /unseen/carbon | 200 | 0.22 s | 3 KB | at 08 Nov 00:00 | 00:00 | all six zones |
| /unseen/ghost-wind | 200 | 0.62 s | 14 KB | to 08 Nov 01:00 | 01:00 | |
| /weather/grid | 200 | 0.02 s | 31 KB | to 09 Nov 23:00 | 08 Nov 01:00 | |
| /carbon/costs | 200 | 0.06 s | 5 KB | at 08 Nov 00:00 | 00:00 | |
| /compute | 200 | 0.87 s | 15 KB | deadline 09 Nov 02:00 | – | |
| /datacentre | 200 | 0.31 s | 2 KB | 08 Nov 13:00 | – | |
| /infrastructure | 200 | 0.53 s | 10 KB | to 07 Nov 23:00 | 23:00 | |

## SpacetimeDB (living-grid, public read)

| Table | Rows | Newest |
|---|---|---|
| actual | 6,363 | ts 08 Nov 22:00 (day-ahead prices) |
| forecast | 11,208 | made_at 08 Nov 01:05 |
| score | 108 | window_end 08 Nov 00:00 |
| ghost_wind | 102 | ts 08 Nov 01:00 |
| carbon | 284 | ts 08 Nov 00:00 |

The publisher is keeping up with the scheduler.

## Fix tasks opened

| Task | Lane | What |
|---|---|---|
| #242 | B | `engine/data.carbon_at` keeps only the last 3 hours (strict), but Energy-Charts runs 2–4 hours behind. So `/state` loses carbon for NL, BE and NO2 for most of each hour, while `/unseen/carbon` shows all six zones. Use the 6 h metered window or the per-zone rule. |
| #243 | B | `/state` NO2 load and mix are empty, because Elhub lands D+1 to D+2. Serve its latest hour with a label, or explain why it is empty in the note. Low priority. |

No task for the NESO timeout: it happened once, the next hourly run retries, and the costs it fetches lag a week anyway. If it recurs on two consecutive runs, raise the client timeout in `pipeline/ingest/neso.py` (lane A).
