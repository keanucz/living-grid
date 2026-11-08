# #317: one smooth zoom-out, the title holds, then a clean hand-off to the welcome

**What changed (`web/src/intro/`, `web/src/layers/intro/`, `web/src/map/MapView.jsx`):**

- **Kept:** stefan-6's pylon shot and the cross-fade (0 to 3.0 s). `pylon.js` is untouched.
- **Edinburgh:** north-up on the "Edinburgh / You are here" dot (3.0 to 3.6 s), holding to 4.8 s.
- **One zoom-out:** a single eased fly from Edinburgh to the six-country overview over 3 s. It uses deck's linear interpolator with ease-in-out instead of three fly-to hops, because a fly-to arcs out and back in on long moves.
- **Captions:** "Scotland" and then "United Kingdom" fade in as the zoom passes them. They are tied to how far out the camera actually is (peaks at 40% and 75% of the way, by zoom), so they stay in step even on a slow page.
- **Title:** it waits until the camera has actually stopped on the overview, measured on the map's own camera and not a timer. It then fades in for 0.5 s and holds for 1.5 s. The Edinburgh dot goes as the title comes in, so the title stands alone.
- **Hand-off:** over 0.4 s the title fades out while the welcome fades in. The intro first drops below the welcome's layer and the welcome comes in on the next tick, so the welcome fades in over the fading title rather than the title sitting on top of it.
- **Never early:** the welcome never appears before the camera has stopped.
- **Skip:** a click, a key or the Skip button still goes straight to the welcome.
- **Welcome flash at load:** the welcome is now hidden before the first paint (a layout effect), so it no longer flashes for a frame on first load.
- **Phone:** the phone has no welcome (the mobile shell does not show it), so there the title fades out to the map.
- **Total:** about 10 s on a normal machine.

## Recordings (fresh profile, `vite preview` of the branch, live API)

- **Files:** `intro-1440x900.webm` and `intro-390x844.webm`, assembled from Chrome screencast frames at their real timing.
- **They are slowed down.** The VPS was at load 25 to 30, and Chromium renders WebGL in software, so each frame took one to three seconds. The recordings run about 100 to 130 s and the 3 s zoom-out shows as a jump of one or two frames.
- **What they do show:** the order of the sequence (pylon, cross-fade, Edinburgh hold, overview, title alone, then the welcome fading in over the title).
- **What they do not show:** the captions, nor the smoothness. Please judge both on a laptop.

**Sequence seen in the 1440×900 capture:**

1. Pylon shot.
2. Cross-fade.
3. Edinburgh with "You are here".
4. The settled overview with the title alone.
5. The welcome fading in over the blurred, fading title.

An earlier in-page log at 1440×900 (before the two hand-off fixes) recorded:

- Edinburgh flat at zoom 7.5.
- One zoom-out to 4.05, settling at 71.3 s.
- The title in from 77.6 s and at full by 80.4 s.
- The welcome at 99.6 s, as the title fades. Never before the camera stopped.

**Caption opacity by zoom-out progress** (from `route.js` CAPTIONS):

| Progress | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 |
|---|---|---|---|---|---|---|---|---|---|
| Scotland | 0.13 | 0.76 | 1 | 0.76 | 0.13 | 0 | 0 | 0 | 0 |
| United Kingdom | 0 | 0 | 0 | 0 | 0.45 | 1 | 1 | 0.45 | 0 |

The section tabs, `.wi-card`, `#/replay .rp-play` and the `#/reveal` structure are untouched.
