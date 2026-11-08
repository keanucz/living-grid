# #308: tour camera, captions, card placement and the Edinburgh intro

Checked on 8 November 2026 in Playwright Chromium, under `nice -n 19` with one browser that was closed afterwards. The pages were a local `vite preview` of the branch with the live API, read-only (the tour's Hormuz step posts nothing). The VPS was at load 20 to 30 throughout, so every camera move ran several times slower than on a laptop. Each check below waits for the move to finish before it measures.

## 1. Camera on Back and fast Next (`tour/engine.js`, `map/MapView.jsx`)

- **Every step now aims the camera.**
  - A step entered forwards flies from wherever the camera is, so a move still running is taken over cleanly.
  - A step entered with Back first snaps to the previous step's view, then plays its own move. Back to Proof replays the un-tilt from What if.
  - A step without its own camera aims at its section's view: flat for overview, tilted for What if.
  - A newer step cancels an older step's pending move.
- **Late maps:** coming back from a page with no map (Play), the map remounts. It holds the request until deck has loaded, then plays it. A camera set while deck is still starting up is otherwise overwritten by deck's first view report.

| Check (1280×720, 1440×900, 1920×1080) | Result |
|---|---|
| Back from Proof to What if, then Next: 0.7 s later | Tilted (pitch 54 to 56, bearing −16): the move replays |
| …when it settles | Flat (pitch 0, bearing 0) |
| Back then Next within 250 ms, twice | Ends flat, never part-way |
| Play to Proof with Back (map remounts) | Tilt, then flat. Event log at 1280×720: request at 11.2 s, tilt at 16.9 s, flat at 20.7 s on this loaded box |

`window.lgViewState` is a read-only mirror of the camera for these QA scripts.

## 2. Captions (`tour/tours.js`)

- **Text:** all 13 captions come from Keanu's `/tmp/tour-captions.md`, verbatim. A script compares them: 0 differences.
- **Proof tokens:** the proof step uses two new tokens, `model` and `baseline` (`headline.mae_model` and `mae_persistence`, one decimal). They are plain numbers because the errors are pooled across £ and € zones, and the caption already says "per MWh".
- **Bill token:** it now reads "£205.4 million over the 11 days published so far, 17 October to 29 October", which follows "come to" naturally. The old wording ("…days it has published") had an unclear "it". The 11 days fall within a 13-day span.
- **Fallbacks:** if `/scores` is slow, the proof sentence still reads naturally: "off by a few tens per MWh … was off by more".
- `verifyTours()`: no problems.

## 3. Card beside the ring (`tour/Tour.jsx`, from keanu-1's #305)

- **Desktop:** the card goes left or right of the ring, whichever has more room, aligned with the ring's top. Otherwise it goes above or below. A target as big as the screen gets the roomiest side.
- **Phone:** the full-width card goes above or below.

Overlap between the card and the ring (px²), once the ring had settled, for every main-tour step:

| | prices | flows | forecast | history | explain | ghostwind | hormuz | proof | play |
|---|---|---|---|---|---|---|---|---|---|
| Live site (before), 1440×900 | 0 | 0 | 0 | 0 | 0 | **45,292** | 0 | **65,572** | 0 |
| Branch, 1440×900, 1280×720, 1920×1080 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Branch, 390×844 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no ring (no tab bar on the phone Play page) |

The card was fully on screen in every case. Screenshots: `before-card-proof-1440x900.png`, `after-card-proof-1440x900.png` and `after-card-proof-390x844.png`.

## 4. Intro (`intro/`, `layers/intro/`)

- **Kept:** stefan-6's pylon shot (0 to 2.6 s) and the cross-fade into the map (2.6 to 3.0 s). `intro/pylon.js` is untouched.
- **Replaced:** the tilted fly-out that followed. The map now turns north-up and flat on a clear dot labelled "Edinburgh, You are here" (3.0 to 3.6 s) and holds to 4.6 s. It then zooms out to Scotland, the whole UK and the six countries by 6.8 s. "This is the living grid of Europe" fades in from 6.2 s, and the intro ends at 7.3 s.
- **Unchanged behaviour:** first visit only. Any click, key or the Skip button lands on the overview.
- **Robustness:**
  - Intro time advances at most 0.25 s a frame, so a page that stalls plays the intro late rather than skipping it.
  - The map part waits at the cross-fade until the map has loaded.
  - If the intro ends before its last stage was sent, it lands on the overview.
- **Title:** it was inside the faded pylon layer before, so it never showed. It now sits outside that layer.
- **In-page camera log at 1440×900, in order:** pylon match cut (zoom 7.5, pitch 75, bearing 149), Edinburgh (zoom 7.5, pitch 0, bearing 0), Scotland (5.8), the UK (4.9), the six countries (4.05), then the overlay ends. Screenshot: `after-intro-edinburgh-1440x900.png`.

Manu's recorder selectors are not touched: the section tabs, `.wi-card`, `#/replay .rp-play` and the `#/reveal` structure.
