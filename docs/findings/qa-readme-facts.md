# README fact-check

Task #255. Every number, date and claim in `README.md` on main (as of 8 November 2026, about 01:45 UTC) traced to the runner's data (`/srv/hack/runner/data`), the live API (`https://htb.stefvuck.dev/api`), `engine/reference/facts/`, the code, or a primary web page.

**Result:** 6 claims are stale or wrong and 2 lines are filler; all are fixed in the same change. 6 claims cannot be fully verified, and the rest check out.

## Stale or wrong (fixed in README.md)

| README line | Claim | Evidence | Fix |
|---|---|---|---|
| 112 | 64.0% of day-ahead outcomes inside P10 to P90 before calibration | The only stored pre-calibration run, `walk_forward.parquet.pre-calibration-1653` (16:53 UTC), gives **63.3%** (n-weighted, day-ahead price, lgbm_q). The 23:45 file stores only calibrated coverage. | "63.3% in the 16:53 run without it" |
| 118 | 2 November (calm): 136 of 168 hours inside the band (81%) | No 2 November replay exists on the runner (`data/replay/` has 13 days, not 2 Nov). The live `/replay?event=2026-11-02` answers 404 ("no replay for 2026-11-02"). Cannot be reproduced. | Row removed. The calm-day contrast now comes from the backtest by regime (see 119). |
| 119 | 26 October (storm): 83 of 168 (49%) | Runner `data/replay/2026-10-26.json` and the live `/replay?event=2026-10-26` both say **78 of 168** (46%), after the replay was regenerated. | "78 of 168 (46%)" |
| 125 | Bot league results in `data/backtest/bot_league.json` | That file is not on the runner. The run was made in a worktree (keanu-5, 20:57 UTC). The numbers in the table are all correct against that file (checked: every MAE, pinball, coverage, Brier, p-value and the 6 of 43 storm days). | Say where the run was made, and that it can be re-run on the runner. |
| 162 | Every constant researched with the Parallel Task API; 51 of 53 pass | `engine/reference/facts/` now holds **59** facts. 53 were researched (51 verified, 2 flagged: `con_wind_curtailment_2025`, `hh_ev_charge_kwh`). 6 were entered by hand with sources (`dc_dgx_h100_kw`, `dc_dgx_b200_kw`, `dc_rtx4090_tgp_w`, `dc_pue`, `hh_price_cap_unit_rates`, `hh_tumble_dryer_kwh`). | "53 were researched ... 51 of those pass ... 6 more were entered by hand with their source" |
| 181 | The day-ahead SCOTEX limit was 3.6 GW on 7 Nov 2026 | Runner `data/neso/boundary_flows.parquet`: SCOTEX `limit_mw` on 7 Nov ranges **3,300 to 3,600** over the 24 hours. | "3.3 to 3.6 GW" |
| 110, 158 | Filler: "The backtest says so.", "because it is." | Style only. | Removed. |

## Cannot be verified

| README line | Claim | What I found |
|---|---|---|
| 83 | Elexon outcomes about 15 minutes after each period | The project brief says the system price lags about 20 minutes. Not re-measured. |
| 96 | About 66 junk memos on the retired wallet | Devnet RPC (`getSignaturesForAddress`) shows 69 memo transactions on `H82mx…`. The two named as real exist with the stated memos (`lg1|freeze|20261107T200002Z|…` and `lg1|run|20261107T200504Z|…`), so 67 are junk. "About 66" is close enough. Left as is. |
| 168 | Elexon Insights: 7-day windows | Taken from the project brief (FUELHH maximum range). Elexon's API page lists FUELHH but does not state the range in what I fetched. |
| 178 | NO2 load roughly 5 GW | Energy-Charts' Norway-wide load averages **15.6 GW** on the runner (2024 to 7 Nov 2026), which supports "about 15 GW". I found no primary figure for NO2 alone. |
| 181 | ETYS 2025: "limited to 6.7 GW due to thermal constraint on the Harker-Moffat 400kV circuit" for B6 | The quote is word for word in [ETYS 2025](https://www.neso.energy/document/383876/download), and `con_b6_capability` is verified. **Worth a human look:** in the PDF's text it sits under the "Boundary B5 – North to South SP Transmission" heading, just before the B6 heading. Harker–Moffat crosses the Scotland–England border, which points to B6, but the layout is ambiguous. |
| 201 | 63 of 89 tasks merged by 16:40 Saturday | 63 merges with a task number on main by 16:40 UTC (`git log` on `repo.git`). The 89 total is not checkable after the fact. |

## Checked and correct

| Line | Claim | Evidence |
|---|---|---|
| 5 | 7 to 8 November 2026, HRT and G-Research track names | Project brief. |
| 24 | 7 Nov evening: £268/MWh GB, €322 continental, €205 NO2 | Runner `nordpool_price_da.parquet`, 16:00 to 18:00 UTC: GB 268 to 270, BE/DE-LU/FR/NL 322 to 323, NO2 201 to 205. |
| 74, 82, 84 | Scheduler at :05, scorer at :12, publisher once a minute | Forecast log `made_at` minutes are 05 on every scheduled run. `lg-scoring.timer` fires at :12. `lg-publisher.service` runs `engine.publisher` with `--every 60` as the default. |
| 88 | Freeze 09:15 UTC Sunday; GB auction 09:50; continental 11:00 UTC | `pipeline/freeze.py` default `2026-11-08T09:15Z`. N2EX gate closure "09:50 GMT / 10:50 CET" ([Nord Pool](https://support.nordpoolgroup.com/support/solutions/articles/8000088463-about-the-n2ex-day-ahead-auction)). SDAC "Gate Closure: 12:00 CET on D-1" = 11:00 UTC ([Nord Pool product specifications](https://www.nordpoolgroup.com/4a7444/globalassets/download-center/rules-and-regulations/sdac-15-min-product-specifications-wce.pdf)). |
| 92 to 98 | Wallet, devnet, memo format | `FYgaq…` holds 8 memo transactions, e.g. `lg1|freeze|20261107T235902Z|<sha256>` and hourly `lg1|run|…`. `pipeline/commit_chain.py` defaults to devnet. |
| 102 to 110 | 33.0 / 36.6 / 43.2, 24% better, 6,039 hours, NO2 ratio 1.12, beats yesterday in 4 of 6 zones, 13 of 17 pairs, the four named losses | Runner `walk_forward.parquet` (written 23:45 UTC), n-weighted: 33.00 / 36.62 / 43.25; per zone NO2 24.7 against persistence 22.0 (1.12); losses FR price (yesterday), NO2 price (both), NL load (yesterday), FR wind (persistence: 2,911 against 2,454). The live `/scores` shows the same 33.0 and 43.2. |
| 112 | 79.9% after calibration; load 80.2%, wind 77.1%, GB system price 73.6% | Same file: 0.799, 0.802, 0.771, 0.736. Live `/scores` coverage 0.799. |
| 121 | NESO puts 26 Oct constraint costs at £36.5m | Runner replay `constraint_cost_gbp` 36,530,869 ("NESO daily total"). |
| 125 to 144 | Bot league table and every bullet | `bot_league.json` (20:57 UTC): calm/storm MAE, pinball, coverage per model as printed; DM p = 0.94 (Committee), 0.62 (Yesterday, calm), 0.61 (system price, Committee); system price MAE 42.5 against 43.1; Brier 0.129 / 0.146 / 0.155 / 0.222 / 0.168; storm coverage 65.5% to 71.5%; Yesterday storm coverage 57%; 6 of 43 days. |
| 150 to 158 | Event constants | `engine/reference/facts/`, all verified: four 1,450 MW units and 63 GW (`ev_fr_reactor_size`, `ev_fr_nuclear_capacity`, IAEA); power curve 3 / 12 to 13 / 25 m/s (`wind_power_curve`); 2,400 MW per °C (`ev_fr_temp_sensitivity`, RTE Bilan 2020: "Environ 2 400 MW par degré Celsius"); 0.334 tCO₂/MWh (`gas_ccgt_co2_intensity`); 58% and 1.72 MWh (`gas_ccgt_efficiency`, EU BAT conclusions); 6.7 GW (`con_b6_capability`). |
| 9 | Gas sets the price in GB most hours | About 55% of hours in 2025 (Cadent, "The price of Energy Security", July 2026) and "60% of the time" in 2026 ([Institute for Government](https://www.instituteforgovernment.org.uk/explainer/uk-electricity-market)). |
| 166, 169, 172 | Energy-Charts 2 per minute per endpoint; Open-Meteo 10,000 a day; Agile around 16:00 | [Energy-Charts API](https://api.energy-charts.info/): "The default is 2 requests per minute with a burst of 4". [Open-Meteo terms](https://open-meteo.com/en/terms): "Less than 10'000 API calls per day". [Octopus](https://octopus.energy/agile): "Between 4-8pm every day (usually nearer 4pm)". |
| 178 | 816 forecasts per run instead of 912 | Every hourly run in `data/forecasts/log.parquet` since 21:25 UTC has 816 rows. |
| 181 | NESO Q&A quote, January 2025 | Word for word in the [Constraints Collaboration Project Q&A](https://www.neso.energy/document/350981/download), published 9 January 2025. |
| 201 | Main mirrored to GitHub every minute | crontab: `* * * * * mirror-living-grid.sh`. |
| 203 | Python 3.12, SpacetimeDB 2.14, deck.gl 9.4, MapLibre 5.24 | `web/package.json`: spacetimedb 2.14.1, deck.gl 9.4.1, maplibre-gl 5.24.0. uv fetches Python 3.12. |

## Outside the README (not changed here)

`demo/writeup/devpost.md` and `demo/scripts/` (#62) still quote the earlier numbers: backtest MAE 31.6 against persistence 43.7, and calm-day coverage 81% against storm 49%. They should match the README: 33.0 against 43.2, and 78 of 168 hours (46%) on 26 October.
