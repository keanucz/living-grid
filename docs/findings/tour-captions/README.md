# #321: tour captions keep their live figures on a slow page

**The problem (#316):** under load, the ghost wind and Proof steps showed their fallback words ("millions of pounds", "many", "a few tens", "more"). The API answered within 0.25 s, but `useLive` in `web/src/tour/Tour.jsx` aborted each request after 4 s, and a busy page did not get to the answer in time.

## The fix

The new module is `web/src/tour/liveCache.js`.

- **One request per API path per page load,** shared by every step (a Map of path to Promise). A failure or a timeout is not cached, so a later step tries again.
- **Prefetch:** every path the tour's captions use is requested as soon as a tour starts. That includes presenter mode (`#tour=…&autoplay`), which runs through the same component.
- **12 s timeout** instead of 4 s.
- **Shown at once, or updated in place.** A figure already in hand is shown as the step opens, so it never flashes its fallback. One that arrives later replaces the fallback in the caption.
- **Fallback words are kept** for offline mode (`VITE_LG_OFFLINE`), for real failures, and for a response with an unexpected shape.

`tours.js` (the caption copy) is not touched. The chapters player (`tour/numbers.js`) already waits 12 s and is unchanged.

## Checks

- **Tests:** `engine/tests/test_web_tour_live_cache.py` runs the module in node with a fake fetch (4 tests):
  - one request per path, shared by all callers;
  - prefetch takes each path once, and `peek` sees the answer;
  - a slow answer inside the timeout still counts, and the timeout is 12 s;
  - a timeout or HTTP error rejects and is retried later.
- **Browser:** a full main tour at 1920×1080 in one Chromium under `nice -n 19`, closed afterwards. It used a local build with the live API, and delayed `/scores` and `/unseen/ghost-wind` by **6 s** on purpose, which is longer than the old 4 s cut-off. Every live figure was already in its caption when its step opened:
  - prices: "Britain is £177/MWh; southern Norway is €192/MWh"
  - ghost wind: "£205.4 million over the 11 days published so far, 17 October to 29 October" (`1920x1080-ghostwind.png`)
  - Proof: "We've scored 779 live forecasts … off by 33.3 per MWh … off by 52.3" (`1920x1080-proof.png`)
- **Requests:** the tour requested `/state`, `/scores` and `/unseen/ghost-wind` once each. The second request for each of the last two came from the app's own scoreboard and ghost wind layer.
- **Errors:** none on the page.
