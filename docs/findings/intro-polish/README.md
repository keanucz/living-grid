# #322: intro polish, a clean map during the intro and the title fully gone before "Where to?"

Changes, all in `web/src/intro/Intro.jsx`:

1. **Clean map.** While the intro runs, a `data-intro` attribute on the root hides the app's UI: on desktop the top bar, headline, panel slots and legend; on phone the top bar, layer chips, selection card, sheet and tabs. Skip and the map stay.
   - The decision is taken when the intro module loads, before the first render, so neither the UI nor the welcome shows for a frame.
   - The UI fades back in (0.5 s) with the welcome. There is no fade on the way out, and none with reduced motion.
2. **One after the other.** The title fades out fully (0.4 s), a frame is drawn without it, and only then does the welcome come in. #317's overlapping cross-fade and z-index hand-off are removed. Skip still goes straight to the welcome, and the total length is unchanged.

**Checked:** Playwright Chromium under `nice -n 19`, one browser, fresh profile, `vite preview` of the branch with the live API. Frames are every 0.5 s of capture time, with repeats skipped, in `1920x1080/` and `390x844/`. The VPS was at load 25 to 30 (software WebGL), so the capture runs about 15 to 20 times slower than real time.

**In-page log**, sampled every 50 ms, with opacities as rendered:

| Run | UI (top bar or panels) | Title | Welcome |
|---|---|---|---|
| 1920×1080 | 0 from the first sample until after the hand-off, then 1 | 1.0, then 0.4, then 0.0 | Appears only when the title is 0.0. **Title and welcome at once: never** |
| 390×844 | 0 until the intro ends, then 1 | 1.0, then 0.4, then 0.0 | The phone has no welcome. Never at once |
| Reduced motion (1920×1080) | 0 during the short version, then 1 with the welcome | 1.0, then 0.4, then gone | After the title. Never at once |

Frames to look at:

| Frame | Shows |
|---|---|
| `1920x1080/t102.5s.jpg` | The Edinburgh close-up with only the dot and Skip |
| `1920x1080/t174.0s.jpg` | The title alone over a clean overview |
| `1920x1080/t189.0s.jpg` | The welcome with no title behind it, the UI coming back under its backdrop |
