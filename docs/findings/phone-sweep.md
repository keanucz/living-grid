# Phone sweep on live (#335)

Run on 8 November 2026 from 07:35 to 07:58 UTC on https://htb.stefvuck.dev, in one Chromium under `nice -n 19` (closed afterwards), as a touch phone (iPhone user agent, device scale 2) at **390×844** and **360×780**. Each step was checked for horizontal scroll, text cut off at the screen edge, text under 12 px, tap targets under 40 px, console errors and HTTP errors. The raw figures are in `phone-sweep/metrics.json`, and screenshots are in `phone-sweep/`.

**Overall: it holds up.** At both sizes there were no console errors, no HTTP errors, no fixture fallback and no horizontal scroll on any screen. Every section opened, all four Hidden grid stories and all four What if events ran, the region picker on Tonight worked, Replay played, and Quick play matched two phones into a game.

## Per screen

| Screen | 390×844 | 360×780 | Notes |
|---|---|---|---|
| Intro (fresh profile) | OK | OK | The camera flies in over the map, with Skip bottom right. |
| Welcome | Not shown | Not shown | After the intro, a fresh phone goes straight to Now. The phone has no Welcome doors; the intro and the tab bar take their place. |
| Now | OK, see 1 | OK, see 1 | The answer card reads well ("Britain £177/MWh wholesale, about 18p per kWh…"). |
| Forecast | OK | OK, see 4 | The chart and legend fit. Scrubber pills are small. |
| Hidden grid, 4 stories | OK | OK | The tiles fit in two columns. Story text sits below the tiles, so you scroll to read it. |
| What if, 4 events | OK, see 2 and 3 | OK, see 2 and 3 | All four ran in about 9 s. French nuclear outage: the callout runs off the right edge. |
| Proof | OK, see 1 | OK, see 1 | "Our price forecasts are 36% less wrong… 78%", tagged BACKTEST. |
| Play | OK | OK | Two cards: Beat the model and Market day. |
| Play lobby | OK | OK | Name field, avatars, Quick play and Market day solo all fit. |
| Quick play | OK | OK | Two phones were matched into a game ("Game WMEK starts in 9"). The first question was not reached in the 20 s window. |
| Tonight (#/household) | OK | OK | Changing the region to North East England updated both cards and the chart. |
| Reveal | OK | OK | The four headline figures wrap in narrow columns ("INSIDE / OUR / LIKELY / RANGE"), but stay readable. |
| Replay | OK, see 1 | OK, see 1 | Play/Pause and 1×/2×/4× work. |

## Findings

1. **Real: the Belgium price label covers Germany's** on every phone map (Now, Forecast, Hidden grid, Proof, Replay). It reads "Germany €220" with the G hidden under "Belgium €220". Fix task **#339** (lane C).
2. **Real: the What if callout runs off the right edge** for "France loses nuclear power". "France +€12.6 per MWh / Modelled · French nuclear outage" runs from x 241 to 394 on a 390 screen, so it is cut, and it covers the "Illustrative effect" label. This is in the same fix task, **#339**.
3. **Cosmetic: the What if answer is below the fold.** After you tap an event, the map changes but the answer sentence sits under the four event cards. You scroll to read it, and the screen gives no hint to do so.
4. **Cosmetic: small tap targets.**
   - The Forecast scrubber pills (1×, 10×, 60×, 2 days to Since 2024) are 22 px high, and play is 30×26.
   - The layer chips are 32 px high.
   - Replay's event chips are 33 px high, and its zone buttons are 28 px.
   - Glossary words are 15 to 21 px high, which is normal for inline text.
5. **Cosmetic: text under 12 px.**
   - The tab bar labels and the LIVE, MODELLED, ESTIMATED tags are 10 px.
   - The forecast chart axis is 9 px, and the zone list mix ("Gas 67%") is 11 px.
   - All of it is still legible on a real phone at scale 2 or 3.
6. **Transient: "New version available · Reload".** This chip appeared after a deploy during the run. On the phone it sits at the top right, over the map chips and page headings (Reveal title, Replay intro, Play title). It goes away on reload, and nothing deploys after the 09:00 freeze.
7. **Not a bug: the layer chip row scrolls sideways** ("GB regions", "Wind" and "Sun" run past the edge inside their own scroller). It is cut on purpose, as a hint to swipe.

## Test players created

Quick play needs two players, so the sweep created four QA players, which may show on the leaderboards: **QA k3 3900, QA k3 3901, QA k3 3600, QA k3 3601**. They can be removed with the admin `delete_keys` from #304.
