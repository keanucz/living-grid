# Fallback video

`living-grid-fallback.mp4`: 34 s, 1280x720, H.264, 12 fps, recorded from https://htb.stefvuck.dev on 8 Nov 2026 between 06:57 and 08:05 UTC, on the plain-English UI (sections Now, Hidden grid, Forecast, What if, Proof).
Captioned beats: the live map with flows, Hidden grid, Forecast, the Strait of Hormuz scenario (cost in pounds), Proof, the 26 October storm
replay and the day-ahead reveal. Play it if the live site or the venue Wi-Fi fails.

How it was made: the page clock is frozen and stepped 1/12 s per screenshot (Playwright `page.clock`), so the motion is smooth even though
software WebGL on the build server renders a frame every ~15 s. Frames encoded with ffmpeg (`-c:v libx264 -crf 23 -pix_fmt yuv420p`).
The GIF thumbnail is in `demo/thumbnail/` (640 px, 6 fps).

Note: the What if beat runs Hormuz live, so its bill reads about £1.81bn; the pre-computed figure in the demo scripts is £1.75bn (same
method, newer prices). Both sit inside the P10 to P90 range of £1.05bn to £2.46bn.

The presenter-mode tour (`#tour=main&autoplay`, demo/record/) is the newer alternative; prefer a recording of it if one exists.

## Demo video (`living-grid-demo-video.mp4`)

About 1:30, 1920x1080, made on 8 November 2026 from 10:45 to 11:40 UTC. It opens with the why, then shows the live app:

1. Electricity is invisible (deck hook), then Europe's prices right now with the coupled market switched on.
2. A case study, 26 October 2026: why one day cost £19, then £200, and why Scottish wind farms are paid to stop (the app's own Scotland view, `wind-slide.png`).
3. The app, recorded with Playwright at 1920x1080 on the live site: data centre builder, What if (Strait of Hormuz), Hidden grid, Forecast, Proof, the day-ahead reveal.
4. Cheapest power tonight next to photos of the ESP32 meter (`home.png`), then the end card.

Captions are the transparent overlays from `demo/overlays/`. The narrated slide deck is `living-grid-deck.mp4` (about 2 minutes, rendered from `demo/presentation/` with the 10:45 snapshot).
