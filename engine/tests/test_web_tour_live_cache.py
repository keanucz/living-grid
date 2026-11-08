"""web/src/tour/liveCache.js: the tour's live caption figures are fetched once per API path and shared by every step,
prefetched when a tour starts, and only given up after 12 s, so a busy page shows numbers, not fallback words (#321)."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
MOD = ROOT / "web" / "src" / "tour" / "liveCache.js"

# A fake fetch that counts calls per URL and answers after `ms`, or fails for paths containing 'bad'.
FAKE = """
const calls = {}
const fakeFetch = (ms = 5) => (url, { signal } = {}) => new Promise((ok, no) => {
  calls[url] = (calls[url] ?? 0) + 1
  const t = setTimeout(() => url.includes('bad') ? ok({ ok: false, status: 500 }) : ok({ ok: true, json: async () => ({ url }) }), ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); no(new Error('aborted')) })
})
"""


def run(js: str):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    src = f"import * as L from {json.dumps(MOD.as_uri())};\n{FAKE}\n;(async () => {{ {js} }})()"
    out = subprocess.run([node, "--input-type=module", "-e", src], capture_output=True, text=True, check=True, timeout=30).stdout
    return json.loads(out)


def test_one_fetch_per_path_shared_by_every_caller():
    got = run("""
      const f = fakeFetch()
      const a = await Promise.all([L.getJSON('/scores', { fetchImpl: f }), L.getJSON('/scores', { fetchImpl: f }), L.getJSON('/state', { fetchImpl: f })])
      await L.getJSON('/scores', { fetchImpl: f })
      console.log(JSON.stringify({ calls, a }))
    """)
    assert got["calls"] == {"/api/scores": 1, "/api/state": 1}
    assert got["a"][0] == got["a"][1] == {"url": "/api/scores"}


def test_prefetch_takes_every_path_the_steps_use_once_and_peek_sees_it():
    got = run("""
      const f = fakeFetch()
      const steps = [{ live: { gb: { path: '/state' }, no2: { path: '/state' } } }, { say: 'no figures' }, { live: { model: { path: '/scores' }, scored: { path: '/scores' } } }]
      const paths = L.prefetch(steps, { fetchImpl: f })
      const before = L.peek('/scores') ?? null
      await new Promise((r) => setTimeout(r, 30))
      console.log(JSON.stringify({ paths, calls, before, after: L.peek('/scores') }))
    """)
    assert sorted(got["paths"]) == ["/scores", "/state"]
    assert got["calls"] == {"/api/state": 1, "/api/scores": 1}
    assert got["before"] is None and got["after"] == {"url": "/api/scores"}


def test_a_slow_answer_inside_12_s_still_counts():
    got = run("""
      const f = fakeFetch(60)
      const v = await L.getJSON('/slow', { fetchImpl: f, timeout: 200 })
      console.log(JSON.stringify({ v, timeout: L.TIMEOUT_MS }))
    """)
    assert got["v"] == {"url": "/api/slow"}
    assert got["timeout"] == 12000


def test_timeout_and_errors_reject_and_are_retried_later():
    got = run("""
      const out = {}
      await L.getJSON('/slow', { fetchImpl: fakeFetch(100), timeout: 20 }).catch((e) => { out.slow = 'rejected' })
      await L.getJSON('/bad', { fetchImpl: fakeFetch() }).catch((e) => { out.bad = 'rejected' })
      out.retry = await L.getJSON('/slow', { fetchImpl: fakeFetch(5), timeout: 200 })
      out.peekBad = L.peek('/bad') ?? null
      console.log(JSON.stringify({ out, calls }))
    """)
    assert got["out"] == {"slow": "rejected", "bad": "rejected", "retry": {"url": "/api/slow"}, "peekBad": None}
    assert got["calls"]["/api/slow"] == 2
