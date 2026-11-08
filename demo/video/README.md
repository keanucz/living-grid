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
