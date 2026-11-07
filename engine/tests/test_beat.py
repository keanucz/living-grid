import copy
import json
import shutil
import subprocess
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from engine.beat import build
from engine.tests.test_choices import boalf_history, flows, replay_day

ROOT = Path(__file__).resolve().parents[2]


def call_score(n: int, confidence_pct: float, correct: bool) -> float:
    """Reference: Brier score of the probability vector (pick gets c, the rest share 1 - c) relative to a uniform guess."""
    c = confidence_pct / 100
    q = (1 - c) / (n - 1)
    b = (1 - c) ** 2 + (n - 1) * q**2 if correct else c**2 + (1 - q) ** 2 + (n - 2) * q**2
    return round(100 * (1 - b / ((n - 1) / n)), 1)


def test_scores_are_100_for_certain_and_right_0_for_a_guess_and_negative_for_confidently_wrong():
    for n in (2, 3, 5):
        assert call_score(n, 100, True) == 100.0
        assert call_score(n, 100, False) < -100
    assert call_score(2, 100, False) == -300.0
    assert call_score(2, 50, True) == 0.0 and call_score(2, 50, False) == 0.0  # a coin flip scores nothing either way
    assert call_score(5, 50, False) < 0 < call_score(5, 50, True)
    assert call_score(3, 90, True) > call_score(3, 60, True) > 0 > call_score(3, 60, False) > call_score(3, 90, False)


def test_the_rule_is_proper_honest_confidence_maximises_the_expected_score():
    """For a true probability p of the pick being right, the expected score is highest at c = p (within 50..100)."""
    for n in (2, 4, 5):
        for p in (0.5, 0.6, 0.75, 0.9):
            if p * 1.0 < 1 / n:
                continue
            grid = np.arange(50, 101)
            exp = [p * call_score(n, c, True) + (1 - p) * call_score(n, c, False) for c in grid]
            best = int(grid[int(np.argmax(exp))])
            assert abs(best - round(p * 100)) <= 3, (n, p, best)


def test_a_missing_answer_is_not_better_than_an_honest_guess():
    assert call_score(5, 50, True) > 0  # answering and being right beats the 0 for skipping
    assert call_score(2, 50, True) == 0


def test_module_scoring_matches_the_reference(tmp_path):
    esbuild = ROOT / "web" / "node_modules" / ".bin" / "esbuild"
    node = shutil.which("node")
    if not esbuild.exists() or not node:
        pytest.skip("node or esbuild not installed")
    out = tmp_path / "beat_math.mjs"
    subprocess.run([str(esbuild), str(ROOT / "spacetime/module/src/beat_math.ts"), "--bundle", "--format=esm", f"--outfile={out}", "--log-level=error"], check=True)
    cases = [(n, c, ok) for n in (2, 3, 4, 5) for c in (50, 55, 70, 85, 95, 100) for ok in (True, False)]
    script = tmp_path / "run.mjs"
    script.write_text(f"""import {{ callScore }} from './beat_math.mjs';
console.log(JSON.stringify({json.dumps(cases)}.map(([n, c, ok]) => callScore(n, c, ok))));
""")
    got = json.loads(subprocess.run([node, str(script)], capture_output=True, text=True, check=True).stdout)
    for (n, c, ok), g in zip(cases, got):
        assert g == pytest.approx(call_score(n, c, ok), abs=0.051), (n, c, ok)


# ---------------- the calls ----------------


def league_for(r: dict) -> dict:
    """Bot quantiles for every GB/price_da hour (and each zone's), each bot a shifted copy of the replay's band."""
    shifts = {"bot_yesterday": 1.3, "bot_engineer": 0.9, "lgbm_q": 1.0, "bot_committee": 1.05}
    series = []
    for s in r["series"]:
        pts = [{"ts": p["ts"], "bots": {n: {"p10": p["p10"] * k, "p50": p["p50"] * k, "p90": p["p90"] * k} for n, k in shifts.items()}} for p in s["points"]]
        series.append({"zone": s["zone"], "target": s["target"], "points": pts})
    return {"series": series}


def test_a_full_day_builds_five_valid_calls_with_the_model_and_every_bot():
    r = replay_day(5)
    cs = build.calls(r, boalf_history(), flows(), league_for(r))
    assert [c["kind"] for c in cs] == ["price_band", "battery", "import_export", "which_zone", "wind_over"]
    build.validate(cs)
    for c in cs:
        assert set(c["bots"]) == set(build.BOTS)
        assert c["model"]["reason"] and 50 <= c["model"]["confidence"] <= 95
    band = cs[0]
    assert len(band["options"]) == 5 and band["bots"]["lgbm_q"]["choice"] == band["model"]["choice"]
    assert {o["id"] for o in cs[1]["options"]} == {"charge", "hold", "sell"}


def test_model_and_bot_answers_never_depend_on_the_days_actuals_only_the_answer_does():
    r = replay_day(5)
    a = build.calls(r, boalf_history(), flows(), league_for(r))
    other = copy.deepcopy(r)
    for s in other["series"]:
        for p in s["points"]:
            p["actual"] = 999.0 - p["actual"] if p["actual"] < 999 else 1.0
    b = build.calls(other, boalf_history(), flows(), league_for(other))
    for x, y in zip(a, b, strict=True):
        assert x["model"] == y["model"] and x["bots"] == y["bots"] and x["options"] == y["options"]
    assert any(x["answer"] != y["answer"] for x, y in zip(a, b, strict=True))


def test_battery_rule_charges_before_a_rise_sells_before_a_fall_and_holds_when_flat():
    assert build.battery_action(100, 140) == "charge"
    assert build.battery_action(140, 100) == "sell"
    assert build.battery_action(100, 101) == "hold"
    assert build.battery_action(100, 100 / build.ROUND_TRIP + build.DEGRADATION / build.ROUND_TRIP + 0.1) == "charge"


def test_without_bot_data_only_our_model_answers_for_the_price_calls_and_thin_days_are_refused():
    r = replay_day(5)
    cs = build.calls(r, None, None, None)
    assert [c["kind"] for c in cs] == ["price_band", "battery", "which_zone"]
    assert all(set(c["bots"]) == {build.OUR_MODEL} for c in cs)
    thin = replay_day(2)
    with pytest.raises(ValueError, match="only 2 calls"):
        build.payload(date(2026, 10, 26), thin)


def test_payload_is_json_and_carries_no_secrets_in_the_public_shape():
    r = replay_day(5)
    day, regime, calls_json = build.payload(date(2026, 10, 26), r, boalf=boalf_history(), net_import=flows(), league=league_for(r))
    assert day == "2026-10-26" and regime in ("calm", "windy")
    cs = json.loads(calls_json)
    assert len(cs) == 5 and all(isinstance(c["bots"][b]["confidence"], int) for c in cs for b in c["bots"])


def test_confidence_is_a_whole_percent_between_50_and_95():
    assert build.conf(0.2) == 50 and build.conf(0.999) == 95 and build.conf(0.734) == 73
    assert build.pick({"a": 0.2, "b": 0.8}) == ("b", 80)
