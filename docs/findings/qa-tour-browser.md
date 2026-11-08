# QA: onboarding tour in a real browser (#239, #240, #241)

Task #257. Tested 8 November 2026, 02:00 to 02:45 UTC, on the live site https://htb.stefvuck.dev.

- **Bundle:** `index-C2mlyqO3.js`, which contains `main`, `g-research` and `hrt`.
- **Browser:** Playwright Chromium headless shell with software WebGL.
- **Viewports:** 1440×900 desktop and 390×844 phone (touch).
- **Setup:** `lg-welcomed=1` set.
- **Read-only:** POST `/api/intervene` was blocked in the browser so nothing reached the shared screens. The Hormuz step does not POST anyway: it only sets local state from `/scenarios`.

**Method**

- **Manual:** load `#tour=<name>`, wait 4.5 s per step (plus 8 s more if the target was not visible), record the step id, caption, ring and target boxes, and card overlap, then press Next. A Done press must close the tour.
- **Autoplay:** load `#tour=<name>&autoplay` and record each `data-tour-step` change with `performance.now()` inside the page.
- **verifyTours:** run `verifyTours()` from `web/src/tour/index.js` on current main through Vite's module loader. The #231 debug page does not call it yet.

**Caveat:** the VPS was at load average 31-36 on 8 cores throughout.

- Inside the headless page, `/api/state`, `/api/scores` and `/api/unseen/ghost-wind` took 10-19 s, even 25 s after load.
- `curl` from the same box took 0.06-0.6 s for the same calls.
- So anything that depends on fetch speed or timer accuracy in the browser is **not verdicted here**: live caption figures, the ring appearing, and autoplay pacing. Each is listed under "Unverified" with what to check on a laptop.

## Verdict

All three tours run end to end on desktop and phone.

- Every step opens its own section or page, in order. The ids match `tours.js`, and the step dots and Back/Next/Done behave.
- Done closes the tour, and autoplay loops with no buttons.
- `verifyTours()` reports no problems: every section, layer, panel and target id exists, and every `{token}` has a live entry.
- Every step's target exists in the DOM once its section is open.
- No console errors from the tour itself. No horizontal overflow on phone.

**One clear bug, opened as #279 (lane C):** on phone, the tour does not scroll its target into view.

## Bug: phone steps can point at something below the fold (#279)

- At 390×844 the main tour's **history** step rings `data-tour="scrubber"` at y≈1,105. The ring is drawn off screen.
- The caption ("The time bar reaches back to January 2024. Drag it…") talks about a bar the viewer cannot see.
- `web/src/tour/` never calls `scrollIntoView`.
- All other phone steps happened to have their target on screen in this run. Nothing guarantees that, since the phone sections scroll.

## Minor, no task opened

- **Card over its target (desktop):**
  - Ghost-wind and carbon: the 340 px caption card sits over the bottom of the tall `stories` panel (the bar chart and B6/B4 rows). The panel fills the right column, so there is no free corner. A smaller card or `top` placement for tall targets would help.
  - Reveal: the card covers the right half of the page header's "Zones…" figure.
- **Reading time.** These steps ask for more than 3 words a second, too fast to read while also watching the map:

| Step | Words | Duration | Words per second | Suggested duration |
|---|---|---|---|---|
| proof | 40 | 10 s | 4.0 | about 14 s |
| battery | 34 | 9 s | 3.8 | about 12 s |
| ghostwind | 31 | 10 s | 3.1 | |
| flows | 24 | 8 s | 3.0 | |

  The rest are 1.9 to 2.9 words per second.
- **Targets that never ring:**
  - **reveal:** targets `map` on `#/reveal`, which has no map.
  - **play (phone):** targets `tab-play`, which the phone Play page does not show.
  - Neither breaks anything. The card simply shows without a ring.
- **`/api/explain` 404 on the history step** (both main runs): the explain panel asks for GB at 2026-10-26 12:00. `/explain` only covers the forecast hours ahead ("have 2026-11-08T03:00Z to 2026-11-10T02:00Z"). Expected, but the panel has nothing for past hours. Serving past explanations from the replay files would be a lane B follow-up.
- **"Sample data" badges** on the ghost-wind panel during the run. While the API was this slow, the site fell back to fixture data. That is a load effect, not a tour effect.

## Unverified here (check on a laptop or the demo machine)

- **Live caption figures:**
  - Every token (`gb`, `no2`, `bill`, `scored`, `mae`) showed its fallback text in all six manual runs.
  - The live bundle does fetch them: `OFFLINE` is false, and the response shapes match the `get()` functions (checked with `curl`).
  - The tour aborts each fetch after 4 s, and in-page fetches took 10-19 s here, so this is the load.
  - Cold `/api/scores` took 4.2 s once from `curl` too, so a cold API can still produce fallbacks on a fast machine.
  - Suggestion (lane C): reuse the app's cached `api` client responses (`/state` and `/scores` are already loaded by the panels) instead of separate fetches with a 4 s abort.
- **Ring placement:**
  - Under this load the ring trailed its target by more than 4.5 s. Twice it was still on the previous step's box, and on proof and explain it had not appeared because the panel was still loading.
  - With 25 s to settle, the proof ring wrapped the scoreboard correctly.
  - On a normal machine this should be under a second. Worth a glance on the demo laptop.
- **Autoplay pacing:**
  - Order and looping are correct.
  - Measured step lengths were 1.5-2× the configured durations, because timers in the starved page fire late.
  - Time one pass on the demo laptop: main should take 85 s, g-research 59 s, hrt 68 s.

## Per-step results (desktop / phone)

Each cell is the target, then whether it was visible on desktop / phone. `fallback` means the live tokens showed fallback text (see Unverified).

| Tour | Steps |
|---|---|
| main | prices: zoneList ✓/✓ fallback · flows: layers ✓/✓ · forecast: zoneChart ✓/✓ · history: scrubber ✓/**below fold** · explain: explain ✓/✓ · ghostwind: stories ✓ card overlaps/✓ fallback · hormuz: simDock ✓/✓ · proof: scoreboard ✓ (late)/✓ (late) fallback · play: tab-play ✓/no tab on phone |
| g-research | prices ✓/✓ fallback · ghostwind ✓ overlap/✓ fallback · carbon ✓ overlap/✓ · explain ✓/✓ (late) · hormuz ✓/✓ · proof ✓ (late)/✓ (late) fallback |
| hrt | prices ✓/✓ fallback · forecast ✓/✓ · hormuz ✓/✓ · battery ✓/✓ · proof ✓ (late)/✓ (late) fallback · replay: page opens ✓/✓ · reveal: page opens, no ring (no map)/same |
