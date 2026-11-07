import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
K = 32.0


def elo_deltas(entries, k=K):
    """Reference: every pair plays one game; a player's change is k/(n-1) times the sum of (score - expected)."""
    n = len(entries)
    out = {e["id"]: 0.0 for e in entries}
    if n < 2:
        return out
    for a in entries:
        for b in entries:
            if a["id"] == b["id"]:
                continue
            score = 1.0 if a["points"] > b["points"] else 0.0 if a["points"] < b["points"] else 0.5
            expected = 1 / (1 + 10 ** ((b["rating"] - a["rating"]) / 400))
            out[a["id"]] += k / (n - 1) * (score - expected)
    return out


def tally(votes, players):
    start, wait = votes.count("start"), votes.count("wait")
    if start * 2 > players:
        return "start"
    if wait > 0 and wait * 2 >= players:
        return "wait"
    return "none"


def wait_seconds(since):
    left = 120 - since
    return 0 if left < 5 else min(30, int(left))


def entrants(n, spread=0.0):
    return [{"id": f"p{i}", "rating": 1000.0 + spread * i, "points": float(100 - 10 * i)} for i in range(n)]


def test_ratings_are_zero_sum_and_follow_the_result():
    e = entrants(5, spread=40)
    d = elo_deltas(e)
    assert sum(d.values()) == pytest.approx(0, abs=1e-9)
    assert d["p0"] > 0 > d["p4"]  # the winner gains, the last loses
    assert elo_deltas(entrants(1)) == {"p0": 0.0}


def test_beating_a_stronger_entrant_gains_more_than_beating_a_weaker_one():
    strong = elo_deltas([{"id": "a", "rating": 1000, "points": 10}, {"id": "b", "rating": 1400, "points": 5}])
    weak = elo_deltas([{"id": "a", "rating": 1000, "points": 10}, {"id": "b", "rating": 600, "points": 5}])
    assert strong["a"] > weak["a"] and strong["a"] == pytest.approx(K * (1 - 1 / (1 + 10 ** 1)))
    even = elo_deltas([{"id": "a", "rating": 1000, "points": 7}, {"id": "b", "rating": 1000, "points": 7}])
    assert even == {"a": 0.0, "b": 0.0}  # a draw between equals moves nobody


def test_votes_start_on_a_majority_and_wait_on_half():
    assert tally(["start", "start"], 3) == "start"
    assert tally(["start"], 3) == "none"
    assert tally(["wait", "wait"], 3) == "wait"
    assert tally(["start", "wait"], 2) == "wait"  # a tie goes to waiting
    assert tally([], 4) == "none"
    assert wait_seconds(0) == 30 and wait_seconds(100) == 20 and wait_seconds(116) == 0


def test_module_rules_match_the_reference(tmp_path):
    """spacetime/module/src/rating_math.ts run with node against the reference above; skipped without node or esbuild."""
    esbuild = ROOT / "web" / "node_modules" / ".bin" / "esbuild"
    node = shutil.which("node")
    if not esbuild.exists() or not node:
        pytest.skip("node or esbuild not installed")
    out = tmp_path / "rating_math.mjs"
    subprocess.run([str(esbuild), str(ROOT / "spacetime/module/src/rating_math.ts"), "--bundle", "--format=esm", f"--outfile={out}", "--log-level=error"], check=True)
    rooms = [entrants(2), entrants(4, 25), entrants(7, -60), [{"id": "a", "rating": 1234.5, "points": 1}, {"id": "b", "rating": 987.0, "points": 1}, {"id": "c", "rating": 1500, "points": -4}]]
    votes = [(["start", "start"], 3), (["wait"], 2), (["start", "wait"], 2), ([], 5), (["wait", "wait", "start"], 5)]
    secs = [0, 1, 60, 90, 100, 116, 119, 120, 500]
    script = tmp_path / "run.mjs"
    script.write_text(f"""import {{ eloDeltas, tally, waitSeconds }} from './rating_math.mjs';
console.log(JSON.stringify({{ rooms: {json.dumps(rooms)}.map(r => eloDeltas(r)), votes: {json.dumps(votes)}.map(([v, n]) => tally(v, n)),
  secs: {json.dumps(secs)}.map(s => waitSeconds(s)) }}));
""")
    got = json.loads(subprocess.run([node, str(script)], capture_output=True, text=True, check=True).stdout)
    for room, g in zip(rooms, got["rooms"]):
        want = elo_deltas(room)
        assert g == pytest.approx(want, abs=1e-9)
    assert got["votes"] == [tally(v, n) for v, n in votes]
    assert got["secs"] == [wait_seconds(s) for s in secs]
