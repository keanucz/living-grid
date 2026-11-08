# Regression pass: views merged since 00:30, and the #244 price source

Task #258. Read-only. Tested on live https://htb.stefvuck.dev, 8 November 2026, 01:45 to 02:20 UTC:
- **Browser:** Playwright Chromium (software GL) on the VPS, desktop 1440×900 and phone 390×844 (touch), with `lg-welcomed=1`.
- **Bundles:** the first pass loaded `index-cFI6fMnE.js`, the bundle from before the 01:50 deploy. The second pass loaded `index-C2mlyqO3.js`, deployed at 01:50 (runner `affb68c`, then `9228e99`), which includes #212, #243 and #250.
- **Server:** load average 26 to 36 throughout, from other agents' browsers and test runs. The slow-API findings depend on that.

## Summary

| Merge | What | Desktop | Phone | Verdict |
|---|---|---|---|---|
| #186 | Hidden grid story cards | 4 cards, each opens its detail and layers | same | **Works**; figures check out (below). Ghost wind panel can fall back to sample data under load (#268) |
| #212 | Proof › Replay plays the day | playhead moves, table and map stay on 00:00 | same | **Broken under load** (#267) |
| #223 | History scrubber back to 2024, GB proxy label | 15 Jan 2024 and 1 Jun 2025 load, proxy label shown; 26 Oct shows the storm event | same | **Works**; harmless 404s for past weather and explanations |
| #242 | `/state` carbon for all zones | – | – | **Works**: all six zones carry carbon at 01:00 (NL, BE, NO2 were missing before) |
| #243, #250 | NO2 metered load and mix, "a day behind" label | NO2 row showed 6.4 GW demand, no label | "4.3 GW demand · a day behind" | **API works; desktop row wrong** (#269) |
| #244 | GB day-ahead from Nord Pool where it exists | – | – | **Works** in `/state`, `/replay` and `/timeline` |

There were no JavaScript errors or page errors in either pass. The only console errors were the 404s listed under #223.

## #244: GB price source

`/api/state?at=` GB price against the runner's cached sources (GBP/MWh):

| Hour (UTC) | `/state` value and source | Nord Pool | Elexon MID | System price |
|---|---|---|---|---|
| 08 Nov 01:00 | 181.00 nordpool | 181.00 | – | – |
| 07 Nov 18:00 | 268.46 nordpool | 268.46 | 241.30 | 238.75 |
| 07 Nov 12:00 | 185.69 nordpool | 185.69 | 173.28 | 150.76 |
| 26 Oct 12:00 | 119.92 nordpool | 119.92 | 176.77 | 233.00 |
| 15 Aug 12:00 | 122.61 mid, kind `estimated` | – | 122.61 | 148.00 |
| 01 Jun 2025 12:00 | −5.285 mid, kind `estimated` | – | −5.28 | −17.58 |

Nord Pool wins wherever it exists. MID is used only where Nord Pool has no data, and is labelled `estimated`.

Other endpoints agree:
- **`/replay`:** GB price_da actuals for 26 October 10:00–13:00 (154.08, 130.00, 119.92, 129.63) equal Nord Pool.
- **`/timeline`:** daily GB means equal Nord Pool on 26 October (119.21; MID would give 161.21) and 6 November. 15 August uses MID, flagged by the "GB before September 2026 is the Elexon market index" note.

## #242 and #243: `/state`

At 01:44 UTC, `/state` (at 01:00) had carbon for GB 348, FR 92, DE-LU 588, NL 540, BE 379 and NO2 30 g/kWh.

After #243 deployed (01:50), NO2 has:
- `load_mw` 4,267;
- mix: hydro 6,411, thermal 14, other 8, wind 0.7 and solar 0.3 MW;
- `metered_as_of` 2026-11-06T22:00Z.

The phone zone list shows "4.3 GW demand · a day behind", as #250 intends.

**Desktop problem (#269):** at 02:11 the desktop zone list showed NO2 as "6.4 GW demand", Hydro 95% / Wind 5%, with no "a day behind" label (screenshot `desktop-no2.png`). The desktop had the SpacetimeDB live overlay; the phone was still on `/state`. `web/src/live/overlay.js` replaces demand and mix with SpacetimeDB rows from the last 3 hours. Those tables carry two kinds of NO2 rows:
- Energy-Charts rows that cover the whole of Norway: `load` 16,671 MW and `gen_hydro_water_reservoir` 13,991 MW at 07 Nov 22:00;
- Elhub NO2 rows.

`/state` excludes the whole-Norway rows on purpose (`engine.data.COUNTRY_LEVEL`); the publisher does not. I could not pin down exactly which rows produced 6.4 GW and 95/5. Either way, desktop and phone show different NO2 demand, and the desktop figure is unlabelled.

## #186: Hidden grid story cards

On the new bundle, both viewports show all four cards, and clicking each one opens its detail:

| Card | Headline | Detail text (live) | Check |
|---|---|---|---|
| Scotland's wind, paid to stop | 0.0 GWh, last 24 h | "No wind was paid to switch off in the last 24 hours. The newest published daily constraint bill was £18.8m (NESO, 29 Oct; newest, ~1 week lag)." Plus "B6 … forecast over its limit in 34% of hours over the last 21 days" | Matches `/unseen/ghost-wind` (no wind bids since 5 Nov; 29 Oct £18,759,764) and `/infrastructure` (SCOTEX `hours_over_limit_share` 0.342) |
| Carbon that comes in by cable | +37 g/kWh (desktop), +29 (phone, later hour) | "Belgium generates 342 g/kWh but consumes 379 g/kWh"; later "Southern Norway generates 12 but consumes 41" | Matches `/state` carbon for that hour; labelled modelled |
| The bottleneck | £57.7m, 11 days | "of constraint cost, and 271 GWh of wind, would have been avoided over 11 days with 2 GW more across Scotland to England (B6) … An upper bound"; "The Norway cable was importing at full capacity in 74% of hours" | Matches `/infrastructure` counterfactual: `avoided_cost_gbp` 57,736,384, `avoided_wind_mwh` 271,228 |
| A sunny Sunday, negative prices | −€414/MWh, 26 Apr 2026 | "the German day-ahead price was negative for 8 hours as solar peaked at 44.9 GW" | Energy-Charts DE-LU: minimum −413.77 at 11:00 UTC, 8 negative hours |

Notes:
- **Bottleneck card:** while `/infrastructure` loads (about 7 s under load), it first shows the sample figure "£2.1m, 7 days" from `layers/boundaries` mock data, flagged `sample`. It switches to the live £57.7m once loaded. Low severity.
- **Ghost wind panel, first pass (#268):** on the pre-deploy bundle under load, the desktop panel showed **SAMPLE DATA**, with switched off **−0.8 GWh**, constraint bill **−£164k**, 3.3m "homes for a day" and a "24 GWh" card headline. The code is the same on the current bundle. `layers/ghostWind/data.js` aborts `/unseen/ghost-wind` after 12 s and swaps in `fixture.json`, and that call took 11.3 s in the browser; on its own it takes 0.6 s. The negative figures are not real data, but a judge would read them as if they were.
- No horizontal overflow (document width 1440 and 390).

## #212: Replay plays the day

On both viewports, Replay opens with the map, the event list and the playhead panel, which shows "GB constraint bill that day £36.5m" and the model note. "Play the day" advances the playhead and the slider, but the values do not follow:

| Playhead | Table GB price / P50 (shown) | `/replay` GB actual / P50 for that hour |
|---|---|---|
| 01:00 | £20 / £55 | 19.5 / 52.9 |
| 02:00 | £20 / £55 | 19.6 / 48.8 |
| 06:00 | £20 / £55 | **187.0 / 101.4** |

- **Table:** at 06:00 every zone still shows its 00:00 values (France €47, where 06:00 is €236), and "loading this hour…" never clears.
- **Map:** the label still shows GB £19.8 (00:00), and the "Why" line is for 03:00.
- **Wind:** "Wind paid to switch off, that day so far" stays "—". The page asked for `ghost-wind?from=2026-10-26T00:00Z&to=2026-10-26T00:00Z`; even that returns 3,256 MWh, and to 06:00 it is 18,145 MWh.

The cause is timing. Each hour fetches `/state?at=` (3–10 s under this load), the playhead moves on every few seconds, and so no hour lands. This is the storm replay, hero moment 3, and it currently looks frozen at midnight while the clock runs. The `/replay` payload already holds actual and P10/P50/P90 for every hour and zone, so the table does not need `/state` at all (#267).

## #223: History scrubber

On both viewports, setting the date field to 15 January 2024, 1 June 2025 and 26 October 2026 moves the map and the strip:

| Date | Scrubber shows |
|---|---|
| 15 Jan 2024 | "15 Jan 2024, 12:00 · 1028 days ago", with the note "GB price before September 2026 is the Elexon market index, a proxy for the day-ahead auction." |
| 1 Jun 2025 | Same note. "History not loaded" briefly while the window loads (4 s) |
| 26 Oct 2026 | No proxy note (Nord Pool era); the event "The storm that cost £36.5 million · £36,530,869 of constraint costs in a day · Watch the movie · Replay" |

The zoom pills include "Since 2024".

Each past hour produces 404s:
- `GET /api/weather/grid?t=<past>` (the grid only holds recent days);
- `GET /api/explain?zone=GB&ts=<past>` (explanations only exist for forecast hours).

They show up as console errors only; nothing on screen breaks. No task.

## Performance under load

- **Live API:** a single uvicorn worker (`/etc/systemd/system/lg-api.service`, no `--workers`).
- **Browser:** on page load the browser fires about ten API calls at once. Under load they took 3–11 s each in the browser: `/unseen/ghost-wind`, `/unseen/carbon`, `/infrastructure` 7–11 s; `/carbon/costs` 5–8 s.
- **Curl:** the same ten calls in parallel from curl took 0.1–3.1 s at load 26.
- **Demo-day risk:** with the box quieter on demo day this should improve. The fixes:
  - `--workers 2` or more on `lg-api` (Stefan, ops). The engine's caches are per process, so each worker warms its own.
  - The front-end fallbacks above (#267, #268).

## Tasks opened

| Task | Lane | What |
|---|---|---|
| #267 | C | Replay playhead table and map stay on 00:00 while the day plays; fill from `/replay`, hold or prefetch `/state` hours; fix the wind "so far" window |
| #268 | C | Ghost wind panel shows the fixture (SAMPLE DATA, negative figures) when the live call exceeds 12 s |
| #269 | B | Publisher sends whole-Norway Energy-Charts load and generation to SpacetimeDB as NO2, so the live overlay can show it in the NO2 row |

Ops (no task, sent to Stefan): `lg-api` runs one uvicorn worker.
