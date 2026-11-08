# Reveal day check: final freeze and result polling

Task #337, read-only. Checked Sunday 8 November 2026, 07:50 to 08:05 UTC. UK time is UTC this weekend.

**Update: everything is scheduled (verified by Keanu as root, 07:55 UTC).** Stefan's crontab has the 09:15 freeze, and `pipeline.reveal_poll --once` at 09:45, 09:50 and 09:55, then every 5 minutes from 10:00 to 12:55. The gaps below were jobs this account could not see, not missing jobs. No action is needed; the verdict below is superseded.

## Verdict

| Step | Due | Code | Scheduled? |
|---|---|---|---|
| Final freeze | 09:15 UTC | `pipeline.freeze` (default `LG_FREEZE_AT` includes `2026-11-08T09:15Z`) | **Not visible.** No timer, no `/etc/cron.d` entry, no `freeze --watch` process. The 20:00 and 23:59 Saturday freezes ran from a job I cannot see (stefan's crontab or `at` queue, not readable from keanu). |
| GB N2EX result | about 10:00 UTC | `pipeline.reveal_poll` (every 30 s, 09:45 to 13:30 UTC) | **Not running.** No process, nothing scheduled that I can see, and `data/reveal/` doesn't exist on the runner yet. |
| Continental results | about 11:55 to 12:10 UTC | same poller | **Not running**, same as GB. |
| Fallback | hourly at :05 | the scheduler's Nord Pool ingest, which already asks for 9 November (HTTP 204 so far) and merges into `actuals/nordpool_price_da`, which `/reveal` reads | **Running** (last run 07:05 to 07:07). |

**Without the poller, the continental result is likely to miss the 12:30 demo:**
- **GB:** shows on `/reveal` after the 10:05 or 11:05 run.
- **Continent:** published 11:55 to 12:10, so it lands at 12:07 only if Nord Pool has it by then. Otherwise it waits for the 13:05 run, after the demo.

## 1. The 09:15 freeze

- **Evidence that freezes run:**
  - `/srv/hack/logs/demo-jobs.log` shows `pipeline.freeze` at 20:00:02 and 23:59:01 Saturday.
  - Each one committed to Solana devnet (`freeze-20261107T200002Z`, `freeze-20261107T235902Z`). The first was partial (21 hours a zone); the second was complete (144 rows).
  - The log has no 09:15 entry yet, which is expected because it hasn't happened yet.
- **What schedules them:** not found from this account.
  - `crontab -l` for keanu has only the mirror job.
  - `/etc/cron.d` has only `lg-judging-freeze` (pause and resume the 5-minute auto-deploy at 11:45 and 14:30; it doesn't touch the scheduler or the poller).
  - `systemctl list-timers` lists only `lg-scoring` (:12), `lg-carbon` (:14) and `lg-warm`.
  - `atq` shows nothing for keanu.
  - Stefan's crontab, `at` queue and home folder are not readable.
  - 20:00 isn't in `LG_FREEZE_AT`'s default, so a one-off job (cron or `at`) ran it, not `--watch`.
- **What the freeze does when it runs:**
  - It writes a new `frozen_at` into `forecasts/frozen_monday.parquet`. Earlier freezes are never replaced.
  - It posts the memo through `commit_chain.safely(commit_frozen)`.
  - `/reveal` serves the latest `frozen_at`, so after 09:15 it would show `2026-11-08T09:15:..Z`.
  - It refuses to run at or after `LG_RESULT_PUBLIC_AT`, 10:00 UTC by default.
- **If it doesn't run:** `/reveal` keeps `frozen_at` 23:59:02 Saturday. That freeze is complete and committed, so the reveal still works; the forecast is just 9 hours older.
- **Live now:** `/api/reveal` shows `delivery_date` 2026-11-09, `frozen_at` 2026-11-07T23:59:02Z, 6 zones with 24 hours each, and 0 results.

## 2. Result polling

- **The poller exists:** `pipeline/reveal_poll.py`. Run without arguments, it does the following.
  - **Timing:** sleeps until 09:45 UTC, polls Nord Pool every 30 seconds, and stops when all six zones have 24 hours, or at 13:30.
  - **Writes:** appends to `data/reveal/results.parquet` (with `seen_at`) and merges into `actuals/nordpool_price_da.parquet`.
  - **Read by:** `/reveal` takes poller rows first, then cached actuals.
- **Not started:** no process is running it (`ps`), and no timer or cron entry points at it.
- **Offline:** the poller refuses to run with `LG_OFFLINE=1`, which is correct. `/reveal` offline falls back to the cached files and the fixture.

## 3. Dry run (read-only)

`reveal_poll.fetch_delivery` only reads Nord Pool; it is what `poll_once` calls before it writes. Run from the keanu-1 worktree:

- **Delivery 2026-11-08:** 144 rows, all six zones with 24 hours each. The fetch and parse work.
- **Delivery 2026-11-09:** 0 rows, not yet published, as expected.
- **Default poll window:** 09:45 to 13:30 UTC on 8 November. Delivery window: 8 November 23:00 to 9 November 23:00 UTC.

I didn't run `poll_once` or `freeze`, because both write to the runner.

## What is needed (for stefan or Keanu, who can see stefan's jobs)

1. **Confirm the 09:15 freeze:**
   - `sudo crontab -l -u stefan` and `sudo atq`. Look for a `pipeline.freeze` job at 09:15.
   - If there is none, either queue one with `at 09:15` as the runner user, or run `uv run python -m pipeline.freeze` by hand between 09:15 and 09:59 from `/srv/hack/runner`.
2. **Start the poller before 09:45:**
   - From `/srv/hack/runner`, as the runner user, without `LG_OFFLINE`: `nohup uv run python -m pipeline.reveal_poll >> /srv/hack/logs/reveal-poll.log 2>&1 &`.
   - It can be started now; it sleeps until 09:45.
   - Check on it after 10:05 (`/api/reveal` `zones_published` ≥ 1) and again at 12:10.
