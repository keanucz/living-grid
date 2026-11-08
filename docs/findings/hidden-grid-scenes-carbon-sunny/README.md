# Hidden grid scenes 2 and 4 (#353)

Screens at start, middle and end of each scene, desktop 1440x900 and iPhone 13 (390x844), software WebGL, live API, 8 Nov 09:xx UTC.
Taken with a local QA harness that mounts stefan-1's scene runner over the live map; the scenes are `web/src/views/unseen/scenes/carbon.js` and `sunny.js`, the overlay is `web/src/layers/carbonPuffs/` (hidden from the Layers menu).

- carbon: puffs ride the cables into GB with g/kWh tags; the counter climbs to the tonnes of CO2 an hour arriving at today's flows (modelled: MW x neighbour consumption intensity).
- sunny: 26 April 2026 from the event file, 06:00 to 19:00 UTC; zones turn the negative colour as prices drop below zero and the counter reaches 8 hours.

Needs from the runner: a `{ at, time }` step (sets the map hour). The sunny scene needs `await prepare()` first (the client keeps only the newest per-hour request, so it warms the hours one at a time).
