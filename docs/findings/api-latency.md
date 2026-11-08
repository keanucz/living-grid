# Page-load API latency (#300)

Measured from the VPS on 8 Nov 2026, 03:50 to 04:15 UTC, at load average 3 to 15 on 8 cores. Read-only: no service, systemd or deploy change was made.

**Recommendation for judging at 12:30:**
1. Stop restarting lg-api after about 11:45.
2. Warm the API after every restart and after each hourly data refresh.
3. Optionally, run 2 workers.

The first page load is slow because the API is cold, not because one worker is too few. Each restart, and each hourly data refresh, throws away the in-memory results, and `/scores` then recomputes the battery comparison: 5 to 6 s alone, about 9.5 s for the whole first page.

## How it was measured

- **Live API:** `curl` to lg-api at `127.0.0.1:8000`, the same process Caddy serves at `/api`. Each call was timed sequentially (three times), then with all 10 fired at once.
- **Cold:** a scratch copy of the engine (this worktree's `main`) on another port, reading `/srv/hack/runner/data`. It was started fresh for each run, then called sequentially or all at once. The cold `/scores` and `/timeline` were profiled with cProfile in a scratch process.
- **Workers:** the same scratch copy under `uvicorn --workers 1|2|3`.
- **Endpoints**, the ones the first screens call: `/zones`, `/state`, `/scores`, `/scenarios`, `/unseen/ghost-wind`, `/unseen/carbon`, `/infrastructure`, `/household?region=C`, `/regions`, `/timeline`.

## Results

### Warm, one call at a time (live lg-api)

| Endpoint | Time |
|---|---|
| /regions | 0.53 to 0.57 s |
| /infrastructure | 0.48 to 0.52 s |
| /timeline | 0.33 to 0.46 s |
| /state | 0.28 to 0.31 s |
| /unseen/carbon | 0.14 to 0.16 s |
| /household | 0.08 s |
| /scores | 0.05 s |
| /zones, /scenarios, /unseen/ghost-wind | under 0.02 s |

Past hours of `/state` that were not yet cached: 0.26 to 0.28 s each.

### Warm, all 10 at once (live lg-api, one worker)

The last response arrives after 2.0 to 2.3 s, roughly the sum of the sequential times. With one worker and the GIL, simultaneous requests queue: the fast ones return first and `/regions` ends last. Eight uncached `/state` hours at once take 1.6 to 1.8 s each.

### Cold: first call after a start (scratch copy)

| Endpoint | Sequential | All 10 at once |
|---|---|---|
| /scores | **5.2 to 6.4 s** | **9.7 s** |
| /timeline | 1.7 to 2.2 s | 5.5 s |
| /state | 1.2 s | 3.9 s |
| /unseen/ghost-wind | 0.6 s | 3.5 s |
| /regions | 0.57 s | 4.4 s |
| /infrastructure | 0.50 s | 3.6 s |

The rest stay under 1.3 s. Python start-up to the first `/zones` takes 2.4 to 3.5 s.

Memory: RSS is about 300 MB at start and **1.26 to 1.43 GB** once every endpoint has been served. Live lg-api is at 1.26 GB.

### Why the cold calls are slow (cProfile)

- **`/scores` (6.1 s cold):** `engine.battery.compare.run()` re-solves the receding-horizon battery DP for 6 zones and 2 modes: 210 optimiser runs, 2,352 DP plans. That is 5.4 s, plus 0.6 s reading inputs. The result is memoised (`_battery_run`, an `lru_cache` keyed on the input files' modification times), so warm it is 0.05 s.
- **`/timeline` (2.2 s cold):** builds the hourly panel (1.7 s) and concatenates all actuals (0.4 s). It is memoised the same way, so warm it is 0.35 s.
- **`/state`:** concatenates actuals on first use, then serves cached per-hour results.

Every cache is in-process and keyed on the data files' modification times. Two things therefore make the API cold again.

1. **lg-api restarts.** `journalctl -u lg-api` shows a stop and start every 5 to 25 minutes: 12 restarts between 01:35 and 03:45 UTC (`NRestarts=0`, so these are deliberate restarts, not crashes). They follow SSH sessions on the box, which are deploys after merges.
2. **The hourly data refresh.** The runner rewrites `actuals/*.parquet` and `forecasts/log.parquet` at about :05 to :08 past each hour; `lg-scoring` runs at :12 and `lg-carbon` at :14. The first request after each refresh pays the cold cost again.

The 11 s `/unseen/ghost-wind` (#268) and the 3 to 10 s per-hour `/state` (#267) fit this picture: cold work queued behind other cold work in one worker, at load 26 to 33.

### Workers (scratch copy, same data, 10 calls at once)

| Workers | First page load (cold) | Warm page load | Memory |
|---|---|---|---|
| 1 | 9.5 s | 2.2 to 2.3 s | ~1.4 GB |
| 2 | 8.7 s | 1.3 to 1.4 s | ~2.8 GB (est.) |
| 3 | 11.3 s | 0.88 to 0.95 s | ~4.2 GB (est.) |

- Workers help warm loads: they cut the queue by 40 to 60%.
- Workers do not help the first, cold load. Each worker has its own caches, so the expensive `/scores` work is repeated in every worker that receives a request, and three cold workers compete for CPU.
- Memory per worker is an estimate. `ps` could not attribute the spawned workers to the scratch run, so it assumes the single-worker figure of about 1.3 to 1.4 GB per worker. The box has about 8 GB available.

## Proposal (nothing applied)

### 1. Freeze lg-api restarts before judging (no code change; biggest effect)

From about 11:45, do not restart lg-api. Each restart costs the next visitor about 10 s on first load and at least 6 s on `/scores`.

- **Change:** process only. If a fix must ship, restart, then warm (step 2).
- **Risk:** none.

### 2. Warm after every start and after each data refresh (small ops change)

A warm-up script hits the endpoints once, one at a time:

```
for p in /scores /timeline /state /infrastructure /regions /unseen/ghost-wind /unseen/carbon /household?region=C /zones /scenarios; do
  curl -s -o /dev/null -m 60 "http://127.0.0.1:8000$p"
done
```

The full pass takes about 10 s of one CPU.

- **After a restart:** add to the lg-api unit `ExecStartPost=-/bin/sh -c 'sleep 4; <the loop>'`. The `-` prefix means a failed warm-up never fails the service. Or add the loop to the deploy step right after `systemctl restart lg-api`.
- **After a data refresh:** add a small `lg-warm.timer` running the loop at :10 and :16 past the hour, just after the refresh (:05 to :08) and after `lg-scoring` (:12) and `lg-carbon` (:14).
- **Risk:** low. It is about 10 s of CPU per run. If a warm-up overlaps a visitor, the visitor waits as they do today, no worse.

### 3. Two workers (optional; only together with step 2)

Add `--workers 2` to `ExecStart`.

- **Gain:** a warm page load drops from about 2.2 s to about 1.3 s.
- **Cost:** about 1.4 GB more memory.
- **Risks:**
  1. Each worker has its own caches, so warming must reach both. Run the loop 2 or 3 times, or with requests in parallel; uvicorn spreads them, but not deterministically.
  2. Memory: headless-browser QA runs also use the box.
  3. In-process state is per worker. As far as I can see the engine keeps none beyond caches; intervention results go to SpacetimeDB.

  Do not go to 3 workers before judging: the gain is only 0.4 s more, and memory and cold cost grow.

### 4. Later (code change, lane B; not for today)

Have `lg-scoring` compute the battery comparison and write it to parquet, so `/scores` only reads it. That removes the 5 to 6 s cold cost for good. Likewise, the timeline panel could be persisted.
