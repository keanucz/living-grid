# Keanu's 04:3x list, checked on live

Task #316. Checked on 8 November 2026 between 06:15 and 06:55 UTC on https://htb.stefvuck.dev. The deployed web tree was 8d416bc6, which is the `web/` tree of 07d238c and includes #305 to #309 and #312 to #314. Read-only.

**Setup**
- One headless Chromium under `nice -n 19`, closed after each run, so only one browser was open at a time while Manu was recording.
- 1440×900, plus 390×844 with touch where relevant. Fresh profiles: no `lg-intro-seen` for the intro, and no `lg-welcomed` for the Welcome and tour.
- The load average was 8 at the start of the first run and 26 during the second. Camera moves and the intro ran many times slower than on a laptop, so each check waited for the camera to settle.

**Result: all 8 items pass.** There were no page errors and no failed API requests. Three minor notes follow the table; none needs a fix task.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Price legend no longer overlaps the Hidden grid story buttons or the Forecast time bar | **Pass** | Overlap 0 px² between `.legend` and the story panel and its buttons for all four stories; 0 px² against the Forecast time bar; 0 px² against the Proof card. Phone Hidden grid shows all 4 tiles. `1-hidden-Scotland.png`, `1-hidden-sunny.png`, `1-4-forecast.png` |
| 2 | Proof has no More detail with the game QR | **Pass** | Desktop and phone: no "More detail" button and no QR element. The right column holds only "Can we trust the forecast?". `2-proof.png` |
| 3 | What if right column: What it would change fits, no stray box, More detail not horizontally scrollable, battery and Cost of running AI fully visible | **Pass** | After "Gas gets dearer", closed and open: 0 elements wider than the 520 px column, and no sideways scroller. Battery (520 px) and Cost of running AI are shown in full in the drawer, which scrolls vertically. The zoom controls stand alone at the right edge (x 1364 to 1412, y 368 to 532), and nothing peeks out behind the column. `3-6-whatif.png`, `3-more-batt.png`, `3-more-cmp.png`, phone `p-whatif.png` |
| 4 | Forecast time bar no longer overlaps Why this price | **Pass** | Overlap 0 px². The time bar is now at the bottom right, and Why this price is in the left column. `1-4-forecast.png` |
| 5 | No square box behind the countries | **Pass** | Forecast at 12:00 UTC (daylight, Sun layer on) and the sunny-Sunday story: no rectangle, and the sea is clear. `1-4-forecast.png`, `1-hidden-sunny.png` |
| 6 | What if 3D: pins and effects sit on their own country and are readable | **Pass** | The gas pins sit on top of Britain's, the Netherlands' and Germany's bars. Each LNG terminal is named on a dark label (Isle of Grain, Dunkirk, Zeebrugge, Rotterdam (Gate), Wilhelmshaven), and "Illustrative effect" is readable on France. The callout now reads "Britain +3.8p per kWh wholesale" (#301). `3-6-whatif.png` |
| 7 | Tour: new captions, Back on Proof replays the camera, fast Next never leaves it half-way, the card never covers its target | **Pass** | See below. `7-tour-05-ghostwind.png`, `7-tour-07-proof.png`, `p-tour-7-proof.png` |
| 8 | First-load intro: pylon, then north-up Edinburgh dot, zoom out Scotland, UK, six countries, title visible | **Pass** | See below. `8-intro-1.png` (pylon), `8-intro-2.png` (Edinburgh), `8-after-intro.png` |

## Item 7: the tour

- **Captions.** The 9 main-tour captions read as in #308, for example: "Electricity is invisible, so we drew it … Britain is £179/MWh; southern Norway is €192/MWh."
- **Live figures.** Started at those steps, the live figures fill in: "£205.4 million over the 11 days published so far, 17 October to 29 October", and "We've scored 779 live forecasts … off by 33.3 per MWh".
  - During the full walk-through at load 26, the ghost wind and Proof steps showed their fallback words instead ("millions of pounds …", "many", "a few tens", "more"). Every request returned 200 in under 0.25 s, so the most likely cause is the 4-second timer in `Tour.jsx` firing before the busy page handled the response.
  - The fallbacks read naturally, and on a normal laptop this should not happen. It is worth one run-through of the tour on the demo machine.
- **Back on Proof.** From Proof, Back to the Hormuz step tilts the camera (pitch 56, bearing −16). Next then returns it to flat (pitch 0, bearing 0, zoom 4.05), so the move replays.
  - At this load the camera mirror showed no in-between frames, so smoothness cannot be judged here.
- **Fast Next.** Back then Next twice, 150 ms apart, ends on Proof, flat, with no half-finished camera.
- **Card placement.** Overlap between the card and the ring was 0 px² on all 9 steps, at 1440×900 and at 390×844. The card was fully on screen every time. The phone Play step has no ring, as #308 notes.

## Item 8: the intro

The camera, sampled every 100 ms inside the page, went through the stages in order:

| Stage | Camera |
|---|---|
| Pylon match cut | zoom 7.5, pitch 75, bearing 149 |
| Edinburgh, north-up | zoom 7.5, pitch 0, bearing 0, at 55.95° N, 3.19° W. The dot is labelled "Edinburgh, You are here". |
| Scotland | zoom 5.8 |
| UK | zoom 4.9 |
| Six countries | zoom 4.05 |

The title "This is the living grid of Europe" reached an opacity of 0.94, then the intro ended on the overview. On this box the whole intro took about 70 s instead of about 7 s, because intro time advances at most 0.25 s a frame. That is the intended behaviour on a stalled page.

## Minor notes (no task)

- **Why this price runs past the left column at 1440×900.** Its bottom is at 937 px, below the 900 px screen, and the column ends at 872 px. The column scrolls (`overflow-y: auto`, with a hidden scrollbar), so "For experts" can be reached, but it is cut off at the bottom edge until you scroll.
- **Cost of running AI's small print** in What if's More detail still says "the forecast's P10 to P90 band". This is behind More detail, so outside the ELI5 rule.
- **Zoom controls with More detail open.** In the screenshot the controls do not show over the drawer, but a hit test at their centres still returns the buttons. If they are invisible but on top, clicks on that strip of the right column (x 1364 to 1412, y 368 to 532) would zoom the map. That strip is the right edge of the impact tiles, which are not clickable. Worth a quick look, not a fix before the demo.
