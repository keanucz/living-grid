# The Living Grid presentation

One general presentation, about three minutes (185 s), built with [Remotion](https://www.remotion.dev) 4.0.541. It is rendered to MP4 and can also run live in the Remotion Player, advancing on a click. Same story and numbers as the onboarding tour.

## Scenes

| Scene | Seconds | What it shows |
|---|---|---|
| Hook, "Electricity is invisible" | 15 | Europe lit by today's prices |
| The problem | 20 | the 26 October price swing, the constraint bill, carbon that arrives by cable |
| What we built | 20 | the layers, then the forecast with its honest range |
| The product | 65 | five 13 s segments: hidden grid, Hormuz, 26 October replay, cheapest hours tonight, data centre builder |
| Proof | 25 | error against persistence, band coverage, Monday's frozen forecast and its Solana commitments |
| Play | 15 | beat our model |
| How we built it | 15 | a dot per merged hub task |
| Close | 10 | the link and a QR code |

## Where the numbers come from

Every number on screen is read from `data/snapshot.json`, built by `npm run snapshot` from the live API (`https://htb.stefvuck.dev/api`, GET only) plus a count from the hub database. Nothing is typed by hand: `src/data.ts` and `src/figs.ts` are the only readers, and a figure the snapshot lacks shows a dash. Each scene prints its source and the snapshot time in the footer. The list of figures, with a check against the live API, is in `docs/findings/presentation-facts.md`. Numbers move with the data, so render again after a model or data change.

## Run it

```
cd demo/presentation
npm ci
npm run snapshot          # fresh numbers from the live API
npm run studio            # Remotion Studio, scene by scene
npm run player            # click-to-advance Player for the live pitch (Space, arrows, F for full screen)
npm run typecheck && npm run build
```

Do not render on the build server (it is shared and slow). Render on the Mac.

## Render on the Mac

`~/hackhub-admin/mac-render.sh` on the server does everything. From the Mac:

```
scp stefan@htb.stefvuck.dev:hackhub-admin/mac-render.sh ~/ && chmod +x ~/mac-render.sh
~/mac-render.sh clips     # pull main, fresh snapshot, record the screen clips, render MP4, GIF and poster
~/mac-render.sh           # the same without recording clips (title cards instead)
~/mac-render.sh studio    # review scene by scene
~/mac-render.sh player    # the live click-to-advance version
~/mac-render.sh upload    # copy out/ to /srv/hack/runner/demo/presentation/out on the server
COMP=Scene-proof ~/mac-render.sh    # re-render one scene
```

It needs git, Node 20 or newer, ssh to the server, and `ffmpeg` (`brew install ffmpeg`) for clips. Output goes to `demo/presentation/out/` (`living-grid.mp4`, `living-grid.gif`, `poster.png`), which is git-ignored. Stefan hands the Mac session the prompt at https://claude.ai/artifact/E6Z3SNeHgrvYYLaFAhKrqd, which also checks six frames and compares the numbers on screen with `docs/findings/presentation-facts.md`.

## Clips

Clips are screen recordings of the live site, made on the Mac with `demo/record/record.mjs --tour main --per-step --out demo/presentation/public/clips`, which writes `public/clips/main/<step>.mp4` (steps: prices, flows, forecast, history, explain, ghostwind, hormuz, proof, play). `public/clips/` is git-ignored: never commit the MP4s.

The product scene plays `ghostwind` (hidden grid), `hormuz` and `history`. "Cheapest hours tonight" and the data centre builder have no tour step, so they always show a title card with the figure. Any missing clip also falls back to the card, so the deck renders with or without clips. The check uses `getStaticFiles`, which works in the render and in Studio; the live Player probably shows cards.

## Other pieces

- `src/geo.json`: country boundaries for the map, slimmed from `web/public/geo/europe.json` by `scripts/slim-geo.mjs`.
- `src/qr.json`: the QR code module matrix, from the web app's `qrcode` package by `scripts/qr.mjs [url]`.
- `src/theme.ts`: the site's look (near-black, Geist) and the fixed price colour scale.

## Known gaps

- No Diebold-Mariano p-values on screen: no API serves them, so the Proof caption says in words that the test agrees we beat persistence and that against a strong day-ahead rival it is a tie (README of the repo has the p-values).
- Clips recorded headless can look choppy; the frame rate follows the machine.
- The 60 fps claim of the web app is not a property of the video.
