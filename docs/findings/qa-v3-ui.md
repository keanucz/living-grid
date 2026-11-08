# QA: v3 UI merges #175, #181, #183 in a real browser

Task #209. Tested 8 November 2026, 00:00 to 00:40 UTC, on the live site https://htb.stefvuck.dev (bundle `index-UbL4XYtc.js`, which includes all three merges), in Playwright Chromium on the VPS with software GL. Viewports were 1440×900 desktop and 390×844 phone (touch), with `lg-welcomed=1` set. The scripts recorded console errors, HTTP errors, API calls over 3 s, element boxes and overflow, and the API payloads behind each card. Read-only: nothing was fixed.

No JavaScript errors or page errors were seen in any flow. The only console errors were the one transient 502 below and WebGL performance warnings from software rendering.

## Summary

| # | Merge | Severity | Finding | Follow-up |
|---|---|---|---|---|
| 1 | #181 | High | GB region sites return exactly the same price, cost and carbon as GB | task added (B) |
| 2 | #181 | Medium | "Chasing cheap hours adds carbon here: X t" prints the total, not the increase | task added (C) |
| 3 | #175 | Medium | Unseen at 1440×900: the wind card overfills the right column and pushes the constraint-bill card's title and tabs under the top bar | task added (C, after #207/#208) |
| 4 | #175 | Medium | Layer chips at 1440×900: "Wind" is clipped to "Wi" and the share button is hidden | same task as 3 |
| 5 | #175 | Medium | `GET /impact/renewables` takes 15 to 20 s, so the card says "Loading…" for that long | task added (B) |
| 6 | #175 | Info | Live weather is synthetic: the card shows PLACEHOLDER DATA, and wind speed and direction are not real | lane A ingest (#201 schedules weather_grid) |
| 7 | #181 | Low | Builder shows every cost in €, including GB, while the rest of the app shows GB in £ | in task 2 |
| 8 | #183 | Low | Hourly movies show dates with no year; four of the seven events are from 2024 to 2025 | task added (C) |
| 9 | #183 | Low | At 1440×900 the Play, speed and autoplay controls are below the fold | same task as 8 |
| 10 | #181 | Low | GPU slider default reads 977, not 1,000 | in task 2 |
| 11 | #181 | Known gap | No "drop a pin on the map"; sites come from a list (declared in the handoff because of the UI freeze) | none |
| 12 | live | Transient | One `GET /api/replay?event=2026-10-26` returned 502; repeated calls return 200 in under 0.1 s | watch |

## #175 Wind and sun layers, renewables card

What works:
- The Wind and Sun chips toggle.
- Wind draws as drifting streaks across the whole map, coloured by speed.
- The card appears only while a layer is on, in Unseen on desktop and on the Map tab on phone. It follows the selected zone, with a price line, a wind-bar sparkline and clear "estimate" and "modelled" labels.
- Phone: no horizontal overflow (document width 390).

Findings:
- **3. Unseen right column overfills at 1440×900.**
  - With Wind on, the bottom-right slot stacks three cards from y=69 to y=872: constraint bill, wind card and carbon legend.
  - The constraint-bill card then grows (the 26 Oct view with B6/B4/B7a bars), and its title row ("Wind paid to switch off", Last 24 h / 26 Oct storm tabs) and its first row of labels end up behind the top bar. Screenshot: `live2-wind-anim`.
  - The cause is that #175 adds `renewables` to the Unseen section's panels without a height budget.
- **4. Chip strip overflows at 1440×900.**
  - The top-bar layer chips measure 596 px of content in a 542 px strip.
  - The new Sun and Wind chips push "Wind" to "Wi" and hide the share button. The strip scrolls, but with no visible scrollbar.
- **5. Slow endpoint.** `/api/impact/renewables` took 15.5 to 20.0 s for GB, FR and DE-LU, on cold and warm calls alike, so the card's price section reads "Loading…" for about 16 s after every zone change.
- **6. Synthetic weather on live.**
  - `/weather/grid` reports `kind: synthetic`, so the card is badged PLACEHOLDER DATA with the note "SYNTHETIC placeholder weather (nothing ingested yet), not real data".
  - It is honest, but not demo-ready.
  - Values seen: GB 4.0 m/s from the S, DE-LU 14.9 m/s from the SE, both at Sun 00:00 UTC.
- On Overview and Forecast, the Wind and Sun chips draw the layer but no card explains it, because the card is only in the Unseen section's panel list. This is by design per the handoff; noted for #208, one panel per section.

## #181 Data centre builder (Simulate, collapsed card under World events)

What works:
- The card opens.
- Sites can be added from 6 zones and 14 GB regions, up to three, with removal and a "cheapest" marker.
- The GPU type tabs, the four sliders and the debounced refetch all work.
- The left column scrolls (content 1656 px in a 784 px column).
- On phone it is single-column with no horizontal overflow.

Checked against `GET /api/datacentre?locations=GB,N,NO2&gpus=977&gpu_type=h100&pue=1.5&utilisation=0.6&flexible_share=0.2`:
- Draw: 977 × 1.275 kW (DGX H100 per GPU) × PUE 1.5 gives 1,246 kW peak IT. At 60% this averages 1.12 MW and 9,821 MWh a year. That matches the card's "1.1 MW · 9.8 GWh/yr".
- Cost: £1,034,781 at £105.4/MWh, which is €1.19m at 1.15. That matches.

Findings:
- **1. GB regions are cosmetic.**
  - `engine/datacentre.py` resolves a region letter to zone GB plus a display name.
  - "South and Central Scotland (GB N)" therefore returns the identical price (£105.37/MWh), cost (€1.19m), flexible saving and carbon (189 g/kWh, 1,859 t) as GB.
  - Showing Scottish carbon at GB's 189 g/kWh is wrong in a way judges will notice, since Scotland is much cleaner.
  - Either use regional carbon intensity (Carbon Intensity API, already ingested for #119), or label the regions as "same prices and carbon as GB for now", or drop regions from the picker.
- **2. Carbon warning shows the wrong number.**
  - `Builder.jsx:104` prints `tonnes(s.carbon.tonnes_flex)` after "adds carbon here".
  - At NO2 with 199,526 GPUs: tonnes 76.4k, tonnes_flex 80.4k, so the card says "adds … 80.4k t a year" when the increase is 4.0k t. It should print `tonnes_flex - tonnes`.
- **7. Currency.**
  - Every cost uses `cost_eur`.
  - The API returns `currency: GBP` with `cost_local` for GB and its regions, and the battery card beside it shows GB in £.
- **10. GPU default.** `unlog(1000)` then `logGpu` round-trips to 977.
- "Best start … 07:00 UTC (actual)": `kind: actual` means published prices, but "(actual)" next to "in the next 24 h" reads oddly. Suggest "(published prices)".
- **11.** No map pin, as declared in the handoff.

## #183 Event movies (Replay, second tab)

What works:
- Seven movies listed.
- Playback advances: GB wind and system price fill in with a moving cursor, the clock and moment captions update, and 4× speeds it up.
- Chapter dots have `aria-label`s ("Chapter: …").
- Switching movies updates the title, headline and range.
- "Open the forecast replay" returns to the replay.
- Phone: no horizontal overflow.

Findings:
- **8. Missing year.**
  - Hourly events format dates without a year ("9 Dec, 00:00 UTC to 15 Dec, 00:00 UTC").
  - Dunkelflaute is 2024-12. Price spike is 2025-01, the cable outage 2025-08/09, and the sunny weekend 2026-04.
  - The dunkelflaute and price-spike movies will read as if they happened this winter.
  - Only the daily gas-crisis movie shows a year.
- **9. Controls below the fold at 1440×900.**
  - The chart card runs to y≈870 and the Play / 1× 2× 4× / Big screen row starts at y≈886.
  - On the 2022 movie, Play sits at y=656 because the card is shorter.
- At the start of the gas-crisis movie both series read "—" until the cursor passes the first daily point. That is cosmetic.
- The storm movie's headline says "£36,530,869 of constraint costs in a day", with a range of 24 to 28 Oct. That is consistent with the title and the 26 Oct day. The caption honestly notes the cache holds only recent NESO days.
- Not tested: Big screen autoplay (fullscreen is not meaningful headless).

## Screenshots

These are on the VPS in the keanu-3 session's scratchpad (`qa209/`), named `live-*` and `live2-*` (00-start, 01-wind, 03-unseen-wind, wind-anim, dc, dc3, 06-movies, 07-movie-playing, 08-movie-later, gas, 10-phone-wind, 11-phone-dc, 12-phone-movies). Ask keanu-3 to copy any of them.
