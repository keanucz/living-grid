# What if and Proof right column (#306)

Checked in headless Chromium under `nice -n 19` (one browser, closed after), against the live API. Viewports: 1440x900, 1280x720, 1920x1080 and 390x844. Each run opened What if, ran "Gas gets dearer" and opened More detail; then it opened Proof. `before-*` and `after-*` screenshots are in this folder.

## Cause

Every right-column panel is wrapped in a `display: contents` element. So the column rule `.slot-bottomRight > .panel { width: 100% }` never matches, and each panel keeps its own fixed `width: 560px` inside a 520 px column.

## Overflow fixes

Overflow probe: elements wider than the column, plus any horizontal scroller inside it.

- **Before:** at all three desktop sizes, 12 elements overflowed (the impact card, the battery card and its zone tabs, the More drawer), and the drawer scrolled sideways.
- **After:** 0 elements overflow at every size, and nothing scrolls sideways.

| Panel | Fix |
|---|---|
| `statTiles` (What it would change) | Takes the column width. The three tiles shrink (`minmax(0, 1fr)`, `min-width: 0`) and long notes wrap. |
| `more` (More detail drawer) | `overflow-x: hidden`. Panels inside take the drawer's width. |
| `battery` | Width capped at the column. The head and the zone tabs (BE, DE-LU, FR, GB, NL, NO2) wrap. Rows use flexible columns, so "ceiling" and the values show in full, and the sentence wraps. |
| `compute` (Cost of running AI) | Width capped. The summary ("100 MW data centre: €44M/yr between NO2 and DE-LU") wraps under the title instead of being cut. Zone tabs and the hero grid can shrink. |

## Stray box: not fixed here

The "stray rounded box" is the What-if zoom controls (`.slot-right .map-controls` in `web/src/map/MapView.jsx`). They sit vertically centred on the right edge, behind the column, and one button peeks out. `MapView.jsx` is held by #307 (keanu-3), so I handed it over on the bus with a suggested fix: place them beside the column (`right: 560, bottom: 28`).

## Proof

`shell/sections.js`: Proof no longer has More detail.

- The leaderboard (room game, QR code) did not belong in Proof.
- Bot league only renders while a mystery-day round is running. Otherwise the drawer opened onto nothing.
