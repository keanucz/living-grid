# Offline snapshot pack

A copy of every API response the web uses, so the demo keeps working if the engine or the venue Wi-Fi dies. `index.json` maps each request (`GET /state?at=...`, `POST /intervene?type=hormuz`) to its file, with the capture time and the API it came from.

## What is in it

- `/zones`, `/scenarios`, `/scores`, `/reveal`, `/replay?event=2026-10-26`
- `/unseen/ghost-wind` for the last 24 hours and for the 26 October storm
- `/household` for all 14 GB regions
- `/state` and `/unseen/carbon` for every hour from 24 hours before capture to 24 hours after (the scrubber's range)
- `/explain` for every zone with no time, and at each hour from 6 hours before capture to 6 hours after
- `POST /intervene` for the four default scenarios (Hormuz, Norway link, French nuclear, Scottish storm)

Server errors are left out, so a missing entry means the API failed at capture time. 404s are kept (for example `/reveal` before the Saturday freeze), because that is what the real API said.

## Refresh it

Run this close to the demo (Sunday morning, after the reveal freeze), so `/reveal` and `/scores` are current:

```bash
python3 demo/capture_snapshots.py capture --base https://htb.stefvuck.dev/api   # from the live site
python3 demo/capture_snapshots.py capture --base http://localhost:8000          # or a local API, e.g. LG_OFFLINE=1
```

It pauses between calls (`--pause`, default 0.3 s) and retries gateway errors, because `/state` takes several seconds on the shared VPS. A full capture from the live site takes about 15 to 20 minutes at `--pause 1`.

## Use it in the demo

The pack is served by a stand-in API on the port the web already proxies to, so nothing in `web/` changes:

```bash
python3 demo/capture_snapshots.py serve --port 8000    # instead of uvicorn
cd web && npm run dev                                  # /api proxies to :8000 as usual
```

Standard library only, so it runs on a laptop without uv or the engine's dependencies. The top-right chip will say **Live**, because the web cannot tell the stand-in from the engine; responses carry an `x-lg-source: snapshot` header if you need to check.

How it answers:

- An exact match is served as captured.
- Time-based requests (`/state?at=`, `/unseen/carbon?at=`, `/explain?ts=`) are moved by the same offset from now as from the capture hour, then clamped to the captured range. "Now plus 6 hours" during the demo gets "capture plus 6 hours". The `at` inside the response is still the captured time.
- `POST /intervene` returns the captured default result for that event type, whatever magnitude was asked for. Changing the slider will not change the numbers.
- Anything else answers 404, and the web falls back to its bundled fixtures.

If the stand-in is down too, `VITE_LG_OFFLINE=1 npm run dev` runs the web on its bundled fixtures alone.
