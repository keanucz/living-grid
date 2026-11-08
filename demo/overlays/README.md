# Demo overlays

Transparent overlays for the in-person demo video: a title, name lower thirds, a caption per app section and number cards that count up. Film the demo with a camera, then lay these on top in your editor.

Built with Remotion, 1920x1080 at 30 fps. Every overlay except `Title` and `EndCard` has a transparent background. Title and EndCard fill the frame. Safe margins are 96 px.

## What there is

| Composition | Length | Where on screen |
|---|---|---|
| `Title` | 4 s | Full frame: The Living Grid, tagline, HackTheBurgh XIII |
| `LowerThird-Keanu`, `-Stefan`, `-Manu` | 5 s | Bottom left, above the caption's place. Name and role from `data/people.json` |
| `Beat-now`, `-hidden-grid`, `-what-if`, `-forecast`, `-proof`, `-tonight`, `-meter`, `-play`, `-reveal` | 6 s | Bottom left. Step label and one line (`src/copy.ts`) |
| `Callout-constraint-bill`, `-hormuz`, `-less-wrong`, `-in-range`, `-battery`, `-scored` | 5 s | Top right. Number counts up, label, source |
| `EndCard` | 6 s | Full frame: QR code, htb.stefvuck.dev, team, GitHub |

Every overlay slides and fades in over 0.4 s and out over the last 0.4 s, so you can cut it in anywhere without adding a transition.

## Numbers

The callouts read only `data/numbers.json`. Refresh it from the live site just before you render:

```
npm run snapshot
```

It fetches `/scores`, `/scenarios` and `/replay?event=2026-10-26` from https://htb.stefvuck.dev/api (GET only) and prints each value. If a value is missing, its card shows the label without a number. There are no typed fallbacks. Each card shows its source and fetch time.

## Render on the Mac

Needs Node 18 or later. Run these from `demo/overlays/`. The first render downloads a headless Chrome.

```
npm install
npm run snapshot
npm run render:all     # or one of the three below
npm run render:mov     # ProRes 4444 with alpha, out/mov/<Id>.mov (large, best for Final Cut, Premiere, DaVinci)
npm run render:webm    # VP9 with alpha, out/webm/<Id>.webm (small; CapCut, browsers)
npm run render:png     # one transparent PNG per overlay, at its fully-in frame, out/png/<Id>.png (iMovie, Keynote)
```

To render only some, name them: `node scripts/render.mjs mov Callout-hormuz Beat-proof`.

To preview or tweak: `npm run studio`.

`out/` is git-ignored. Do not render the full set on the VPS; it is shared.

## Putting them in your editor

Put the camera footage (or screen recording) on the main track and each overlay on a track above it, at the time the run sheet gives.

- **Final Cut Pro:** import the `.mov` files. Drag each one above the main storyline, as a connected clip. The alpha is read automatically.
- **Premiere Pro:** import the `.mov` files and put them on V2 above the footage. If you see black instead of transparency, right-click the clip, choose Modify, then Interpret Footage, and set Alpha Channel to Straight.
- **DaVinci Resolve:** import the `.mov` files and put them on Video 2. If the background shows black, right-click the clip in the Media Pool, open Clip Attributes and set Alpha mode to Straight.
- **CapCut:** add each `.webm` (or `.mov`) as an overlay, then stretch it to full frame. If your version shows a black background, use the PNGs instead.
- **iMovie:** iMovie ignores alpha in video files, so use the PNGs. Drag a PNG onto the timeline above a clip, open the video overlay settings and choose Cutaway; the transparent parts show the clip underneath. The PNGs do not animate, so add a short Cross Dissolve to fade them.

## Run sheets

- `runsheet-2min-solo.md`: Keanu alone, 2 minutes.
- `runsheet-3min-team.md`: Keanu, Stefan and Manu, 3 minutes.

## Changing words

- Captions, title and end card: `src/copy.ts`.
- Names and roles: `data/people.json`.
- Card labels: `callout()` in `src/Overlays.tsx`.
- Lengths and still frames: `src/list.json`.
