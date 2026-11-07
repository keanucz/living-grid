"""Memoised world-event results, keyed on the request and the modification times of every input file.

The four preset events are computed in a background thread whenever the inputs change, so one tap is served
from memory. A cached result whose inputs have since changed is still served at once while a fresh one is
computed in the background (the scheduler updates inputs hourly; a result at most one refresh old is fine for a
what-if); only default preset requests are served stale, since the warmer keeps exactly those fresh. A custom
magnitude is computed while the caller waits, unless an identical request was computed on the same inputs.
"""

import logging
import os
import threading
import uuid
from collections import OrderedDict
from collections.abc import Callable
from datetime import UTC, datetime

from pipeline import cache
from pipeline.models.quantile import models_dir

log = logging.getLogger(__name__)

PRESETS = ("hormuz", "interconnector_trip", "nuclear_outage", "scottish_storm")
INPUT_DIRS = ("features", "actuals", "markets", "forecasts", "carbon")
MAX_ENTRIES = 64
WARM_EVERY_S = 60.0


def signature() -> tuple:
    """Data roots, file count and newest mtime over every input file; cheap enough for each request (~2 ms)."""
    roots = [base / sub for base in (cache.DATA, cache.FIXTURES) for sub in INPUT_DIRS] + [models_dir()]
    n, newest = 0, 0
    for root in roots:
        for dirpath, _, files in os.walk(root):
            for f in files:
                try:
                    st = os.stat(os.path.join(dirpath, f))
                except FileNotFoundError:
                    continue
                n += 1
                newest = max(newest, st.st_mtime_ns)
    return str(cache.DATA), str(models_dir()), n, newest


def key(req) -> tuple:
    return req.type, req.target, req.magnitude, req.hours


def is_default_preset(req) -> bool:
    return req.type in PRESETS and req.target is None and req.magnitude is None and req.hours is None


def stamp(result: dict, req) -> dict:
    """A cached result as a new event: its own id, trigger time and the caller's request."""
    return {**result, "id": uuid.uuid4().hex[:12], "triggered_at": datetime.now(UTC).isoformat(), "request": req.model_dump()}


class ResultCache:
    def __init__(self):
        self._store: OrderedDict[tuple, tuple[tuple, dict]] = OrderedDict()
        self._lock = threading.Lock()
        self._refreshing: set[tuple] = set()

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def peek(self, k: tuple):
        with self._lock:
            return self._store.get(k)

    def put(self, k: tuple, sig: tuple, result: dict) -> None:
        with self._lock:
            self._store[k] = (sig, result)
            self._store.move_to_end(k)
            while len(self._store) > MAX_ENTRIES:
                self._store.popitem(last=False)

    def compute(self, req, compute: Callable[[object], dict], sig: tuple | None = None) -> dict:
        sig = signature() if sig is None else sig
        result = compute(req)
        self.put(key(req), sig, result)
        return result

    def _refresh(self, req, compute, sig) -> None:
        k = key(req)
        with self._lock:
            if k in self._refreshing:
                return
            self._refreshing.add(k)

        def work():
            try:
                self.compute(req, compute, sig)
            except Exception:
                log.exception("refreshing cached %s failed", k)
            finally:
                with self._lock:
                    self._refreshing.discard(k)

        threading.Thread(target=work, daemon=True, name=f"intervene-refresh-{k[0]}").start()

    def get(self, req, compute: Callable[[object], dict]) -> tuple[dict, str]:
        """(result stamped as a new event, 'hit' | 'stale' | 'miss')."""
        sig = signature()
        hit = self.peek(key(req))
        if hit and hit[0] == sig:
            return stamp(hit[1], req), "hit"
        if hit and hit[0][:2] == sig[:2] and is_default_preset(req):
            self._refresh(req, compute, sig)
            return stamp(hit[1], req), "stale"
        return stamp(self.compute(req, compute, sig), req), "miss"

    def warm(self, compute_for: Callable[[str], Callable], make_request: Callable[[str], object]) -> int:
        """Recompute presets whose inputs changed. Returns how many were computed."""
        sig = signature()
        done = 0
        for t in PRESETS:
            run = compute_for(t)
            if run is None:
                continue
            req = make_request(t)
            hit = self.peek(key(req))
            if hit and hit[0] == sig:
                continue
            try:
                self.compute(req, run, sig)
                done += 1
            except Exception:
                log.exception("warming %s failed", t)
        return done


RESULTS = ResultCache()


def start_warmer(compute_for, make_request, every_s: float = WARM_EVERY_S) -> threading.Thread:
    def loop():
        stop = threading.Event()
        while True:
            try:
                n = RESULTS.warm(compute_for, make_request)
                if n:
                    log.info("intervene cache: computed %d presets", n)
            except Exception:
                log.exception("intervene warmer failed")
            stop.wait(every_s)

    t = threading.Thread(target=loop, daemon=True, name="intervene-warmer")
    t.start()
    return t
