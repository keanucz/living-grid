# Morning sweep, 8 Nov 2026 (#283)

The live site (https://htb.stefvuck.dev) as a judge sees it, from 06:30 UTC. Fresh browser storage, desktop 1440x900 and
iPhone 13 (390x844), Playwright Chromium with software WebGL under `nice -n 19`. Every screen was captured; the ones
below are in `morning-sweep/`. Phone game screens used the offline rehearsal (`#/play?demo=1`) and the lobby only, so
no test players were created in the production database.

## Problems, most demo-damaging first

| # | What a judge would see | Where | Status |
|---|---|---|---|
| 1 | **First load showed sample data.** At 06:30 the very first page showed the "Fixture data" chip and bundled prices (Britain £80.9, France €75.5, all-green map) because `/state` was slow (the API restarts on every merge). The page did not retry until the hour changed. `first-load-fixture.jpg` | App.jsx | **Fixed, #319**: retries live every 15 s while the sample is showing. Keanu's lg-warm service also shortens the cold start. |
| 2 | **"New version available · Reload" chip over the game's buttons on phones**, and a background tab reloaded itself, which would drop a player out of a round when they switch apps. The site redeploys on every merge, so this shows up often. `update-chip-over-button.jpg`, `update-chip-over-trade.jpg` | shell/UpdateChip.jsx | **Fixed, #324**: never reloads or shows on game and big-screen routes or during a tour; small, top-right, clear of buttons. |
| 3 | **History: "Why this price" showed a SAMPLE explanation** for 26 October (the API stores explanations for coming hours only, so `/api/explain?ts=2026-10-26T12:00Z` is 404). Invented reasons next to a real past day. `explain-sample-26oct.jpg` | panels/explain | **Fixed, #320**: past hours say plainly that no explanation is stored. |
| 4 | Phone: Now zone list squashed to 2 px and Hidden grid showed 2 of 4 tiles (tour wrappers broke `.m-sheet > *`). Same bug on desktop pushed the bottom-right cards off screen. | mobile.css, app.css | **Fixed, #309 and #264** (seen fixed in this sweep). |
| 5 | Phone: Bottlenecks label "Scotland to England: over the limit in 34% of hours" ran off the map. | layers/boundaries | **Fixed, #311** (short, wrapped label seen live). |
| 6 | Desktop Hidden grid: the France and Belgium bottleneck labels overlap in the Channel. `hidden-grid-desktop.jpg` | layers/boundaries | Open, cosmetic. Phones already label only busy links; the same rule could apply on desktop. |
| 7 | End of the first-visit intro: "This is the living grid of Europe" fades in over the page headline "Is power cheap right now?" for about a second. | intro/ | Open, cosmetic (keanu-4's #308 area). |
| 8 | Presenter tour (`#tour=main&autoplay`): every step lasts its set time (9, 8, 9, 12, 8, 10, 12, 10, 7 s), but the first step's timer starts at page load, so on a slow load the first caption is cut short (1.9 s here, under software WebGL). | tour/Tour.jsx | Open, minor: start the first step's timer when the first caption is shown. |
| 9 | Phone "Cheapest power tonight" was still "Working out the cheapest hours…" after 9 s (desktop loaded). | views/household | Watch: slow `/household` while other agents were hammering the box; not reproduced on desktop. |

## Checked and fine

- Welcome ("Where to?"), six doors and the 3-minute tour button; the first-visit intro (pylon, Edinburgh "You are here", zoom out) is skippable.
- Presenter mode on a fresh browser: no welcome or intro over it; plays all nine steps and loops.
- Now, Forecast, Hidden grid, What if, Proof on both sizes: the plain-English versions (answer line, one number, "For experts").
- Time bar back to 26 October: map and prices move (Britain £120, Germany €100 at 12:00), storm card with "Watch the movie".
- What if: four one-line cards; Hormuz gives "Britain +3.8p per kWh wholesale" on the map. (The data centre builder is behind "More detail", not a `.dc-toggle` any more.)
- Tonight (desktop), event movies, replay (map plays the day, £36.5m constraint bill), Where the grid is full.
- Day-ahead reveal: frozen Sat 23:59 UTC, six zones "waiting for auction", and **Verify: "Match: this file is exactly what was committed"**. `reveal-verify.jpg`
- Play lobby (Quick play, Market day solo, Host a room, Join with a code) and the rehearsal round (labelled as invented).
- No page errors on either size. The only failed request is the expected `/api/explain` 404 for a past hour.
