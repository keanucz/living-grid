# Demo dry run: both judge tours on live

Task #328. Run on 8 November 2026 from 07:25 to 08:05 UTC on https://htb.stefvuck.dev. The live bundle was `index-eiuj5YRV.js`, built from the `web/` tree of 194238b, which includes #321 (tour live cache) and #322 (intro polish). Read-only.

**Setup**
- One headless Chromium under `nice -n 19`, closed after each run.
- 1920×1080, plus 390×844 with touch for the phone run.
- The load average was 20 to 24 throughout, mostly other headless browsers. Software WebGL on this box is many times slower than a laptop with a GPU, so treat the timings as worst case, not demo pace.

## Verdict

**The demo path works end to end.**
- The 3-minute tour passes on desktop and phone: every caption showed live figures, the card never covered its ring, and nothing failed except one known 404 (below).
- Both presenter orders (G-Research and HRT) play every step in order and loop back to the start. The card never covers a ring.
- Nothing is broken, so no fix tasks. There are three things to know before 12:30 (below).

## Before the demo

1. **Warm the page before presenter mode.** On a cold load, the first step (prices) can show its fallback words, "Britain is the price on the map; southern Norway is its own price", until `/state` arrives.
   - G-Research run: the fallback stayed for the whole first step (19 s) and only went live on the second loop.
   - HRT run: it went live during the first step.
   - Fix: open the site once (or run the tour once) before starting `#tour=…&autoplay`.
2. **Presenter mode runs on a clock.** Each step lasts its `duration` (7 to 12 s) and then moves on, whether or not the screen has caught up.
   - On this starved box, the explain and Proof steps moved on before their panels had painted, so no ring was drawn in those two steps.
   - In the manual tour, the same steps settled in 18 to 20 s and were ringed.
   - On a laptop with a GPU this should not happen, but run each presenter order once on the demo machine before recording or presenting.
3. **The intro takes about 7 s on a laptop, but took 94 s here.** That is the per-frame cap doing its job on a stalled page. The title was gone before "Where to?" appeared (#322): `main-1920-00-where-to.png`.

## 1. Fresh profile at 1920×1080: intro, Where to?, Take the 3-minute tour

"Seconds to settle" is the time from Next until the card was up and the camera had stopped, on this loaded box.

| # | Step | Seconds to settle | Caption as shown | Live? | Card on its ring |
|---|---|---|---|---|---|
| 1 | prices | 12 | Electricity is invisible, so we drew it. Each country is coloured by its price for this hour, set in yesterday's auction. Britain is £177/MWh; southern Norway is €192/MWh. | live | no (0 px²) |
| 2 | flows | 12.5 | The lines between countries are power flowing through the cables that link them, many under the sea. Thicker lines are bigger cables. The Layers button switches the other views on and off. | live | no (0 px²) |
| 3 | forecast | 16 | The faint block shows our forecast for the next few hours. The fainter it is, the less sure we are. | live | no (0 px²) |
| 4 | history | 17.3 | The time bar goes back to January 2024. Drag it, pick a date or press play. Orange ticks are big events: this one is the storm on 26 October. Press Live to jump back. | live | no (0 px²) |
| 5 | explain | 18.4 | Each forecast comes with its reasons in plain words: what pushed the price up and what pulled it down. | live | no (0 px²) |
| 6 | ghostwind | 18.5 | When the lines to the south are full, Scottish wind farms get paid to stop generating. The grid's published bills for that come to £205.4 million over the 11 days published so far, 17 October to 29 October. The numbers here are estimates, and we say so. | live | no (0 px²) |
| 7 | hormuz | 15.2 | Close the Strait of Hormuz and watch dearer gas push up electricity prices across Europe. The bill comes out in pounds. | live | no (0 px²) |
| 8 | proof | 20.4 | We've scored 879 live forecasts so far, each saved before the real price was known. On past weeks it never saw, the model was off by 33.3 per MWh on average. Guessing that the price stays put was off by 52.3. Where we lose, we show it. | live | no (0 px²) |
| 9 | play | 3.9 | Think you can read the grid better than our model? Play a real day from the past, with the date hidden. | live | no (0 px²) |

Screenshots: `main-1920-00-where-to.png` and `main-1920-01-prices.png` to `main-1920-09-play.png`.

**Console:** one 404, `GET /api/explain?zone=GB&ts=2026-10-26T12:00:00Z`, from the history step. The time bar jumps to the 26 October storm, and the explanation endpoint has no row for that hour. The panel handles it (no page error), and it was already in the #316 runs. It is cosmetic, so no task.

## 2. Presenter mode at 1920×1080: `#tour=g-research&autoplay` and `#tour=hrt&autoplay`

An in-page recorder logged every change to the card every 250 ms, with no screenshots during the run, because screenshots stall this box. Times are measured inside the page.

**G-Research order**

| # | Step | Start (s) | On screen (s) | Tab lit | Caption | Card on its ring |
|---|---|---|---|---|---|---|
| 1 | prices | 0.7 | 18.8 | Now | **fallback** ("the price on the map … its own price"); live on the second loop | no (0 px²) |
| 2 | ghostwind | 19.5 | 17.0 | Hidden grid | live: "£205.4 million over the 11 days published so far, 17 October to 29 October" | no |
| 3 | carbon | 36.5 | 12.2 | Hidden grid | live (no figures in this caption) | no |
| 4 | explain | 48.7 | 13.3 | Forecast | live (no figures) | no ring drawn (panel not painted in time, see above) |
| 5 | hormuz | 62.0 | 11.3 | What if | live (no figures) | no |
| 6 | proof | 73.3 | 15.7 | Proof | live: "We've scored 879 live forecasts … off by 33.3 per MWh … off by 52.3" | no ring drawn (as for step 4) |
| loop | prices | 89.0 | 15.5 | Now | live | no |

**HRT order**

| # | Step | Start (s) | On screen (s) | Tab lit | Caption | Card on its ring |
|---|---|---|---|---|---|---|
| 1 | prices | 2.8 | 13.7 | Now | fallback at first, then live during the step | no |
| 2 | forecast | 16.5 | 10.7 | Forecast | live (no figures) | no |
| 3 | hormuz | 27.2 | 13.6 | What if | live (no figures) | no |
| 4 | battery | 40.8 | 15.6 | What if | live (no figures) | no |
| 5 | proof | 56.4 | 14.4 | Proof | live: 879 / 33.3 / 52.3 | no ring drawn (as above) |
| 6 | replay | 70.8 | 17.2 | Proof | live (no figures) | target is the map: no ring by design |
| 7 | reveal | 88.0 | 7.2 | Proof | live (no figures) | target is the map: no ring by design |
| loop | prices | 95.2 | – | Now | live | no |

**Console:** no errors in either order.

**Screenshots:** `gresearch-1920-*.png` and `hrt-1920-*.png`. They lag the step in their file name by a few seconds, because each screenshot itself takes seconds on this box. For example, `hrt-1920-06-replay.png` already shows the Reveal page loading.

## 3. Phone, 390×844: the tour once (`#tour=main`)

| # | Step | Seconds to settle | Caption as shown | Live? | Card on its ring |
|---|---|---|---|---|---|
| 1 | prices | 26 | Electricity is invisible, so we drew it. Each country is coloured by its price for this hour, set in yesterday's auction. Britain is £177/MWh; southern Norway is €192/MWh. | live | no (0 px²) |
| 2 | flows | 14.3 | The lines between countries are power flowing through the cables that link them, many under the sea. Thicker lines are bigger cables. The Layers button switches the other views on and off. | live | no (0 px²) |
| 3 | forecast | 15.3 | The faint block shows our forecast for the next few hours. The fainter it is, the less sure we are. | live | no (0 px²) |
| 4 | history | 13.3 | The time bar goes back to January 2024. Drag it, pick a date or press play. Orange ticks are big events: this one is the storm on 26 October. Press Live to jump back. | live | no (0 px²) |
| 5 | explain | 13.8 | Each forecast comes with its reasons in plain words: what pushed the price up and what pulled it down. | live | no (0 px²) |
| 6 | ghostwind | 17.1 | When the lines to the south are full, Scottish wind farms get paid to stop generating. The grid's published bills for that come to £205.4 million over the 11 days published so far, 17 October to 29 October. The numbers here are estimates, and we say so. | live | no (0 px²) |
| 7 | hormuz | 14.6 | Close the Strait of Hormuz and watch dearer gas push up electricity prices across Europe. The bill comes out in pounds. | live | no (0 px²) |
| 8 | proof | 12.9 | We've scored 879 live forecasts so far, each saved before the real price was known. On past weeks it never saw, the model was off by 33.3 per MWh on average. Guessing that the price stays put was off by 52.3. Where we lose, we show it. | live | no (0 px²) |
| 9 | play | 3.5 | Think you can read the grid better than our model? Play a real day from the past, with the date hidden. | live | no ring (by design) |

Screenshots: `main-phone-01-prices.png` to `main-phone-09-play.png`. The console showed the same 404 as on desktop, and nothing else.

## Cosmetic, noted only

- **The explain 404 for 26 October 12:00** (above).
- **Presenter captions without figures** (flows, forecast, explain, hormuz, battery, replay, reveal) cannot fall back. Only prices, ghostwind and proof carry live figures.
