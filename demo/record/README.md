# Recorded tour (fallback video)

`record.mjs` plays `#tour=<name>&autoplay` in headless Chromium and writes an MP4 and a GIF thumbnail, so the fallback video is
always the current product. Tours live in `web/src/tour/tours.js`: `g-research` and `hrt` follow `demo/scripts/`, `main` is the
3-minute onboarding tour. Output goes to `demo/record/out/` (git-ignored; videos are not committed).

```
npm i --no-save playwright-core            # or point PLAYWRIGHT_NODE_MODULES at a folder that has it
CHROME=~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome \
  node demo/record/record.mjs --tour g-research --base https://htb.stefvuck.dev
node demo/record/record.mjs --tour hrt --base https://htb.stefvuck.dev
node demo/record/record.mjs --tour main --phone    # 390x844
```

ffmpeg (stitches CDP screencast frames; Playwright's own video recorder is not used): uses `$FFMPEG`, then `ffmpeg` on PATH, then `uv run --with imageio-ffmpeg` (no sudo). Software WebGL is slow on a busy server;
the recording starts when the first caption shows, but frame rate follows the machine, so record when the load is low.
Presenter mode on the big screen is the same URL in a browser: `#tour=hrt&autoplay` (loops, no buttons).
