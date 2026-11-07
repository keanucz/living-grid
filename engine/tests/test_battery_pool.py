import copy
import json
import shutil
import subprocess
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from engine.game import battery_pool, settle

ROOT = Path(__file__).resolve().parents[2]


def replay_day(cost=36_000_000.0):
    hours = pd.date_range("2026-10-26", periods=24, freq="h", tz="UTC")
    actual = 60 + 90 * np.sin(np.arange(24) / 24 * 2 * np.pi - 1.5)
    pts = [{"ts": t.isoformat(), "actual": float(a), "p10": float(a * 0.6), "p50": float(a * 0.9 + 5), "p90": float(a * 1.4 + 10)}
           for t, a in zip(hours, actual)]
    return {"event": "2026-10-26", "constraint_cost_gbp": cost,
            "series": [{"zone": "GB", "target": "gb_system_price", "unit": "GBP/MWh", "points": pts},
                       {"zone": "FR", "target": "price_da", "unit": "EUR/MWh", "points": pts}]}


def test_payload_has_one_price_and_one_action_per_half_hour_slot():
    day, reg, start_slot, n, prices, plans = battery_pool.payload(date(2026, 10, 26), replay_day())
    plans, prices = json.loads(plans), json.loads(prices)
    assert (day, reg, start_slot, n) == ("2026-10-26", "windy", 24, 18)
    assert len(prices) == 18 and prices[0] == prices[1] and prices[2] == prices[3]
    for kind in ("median_only", "risk_aware"):
        assert len(plans[kind]) == 18 and set(plans[kind]) <= {"charge", "hold", "discharge"}
        assert plans[kind][0::2] == plans[kind][1::2]  # each hourly action covers both half-hours


def test_plans_come_from_the_forecast_only_never_the_actuals():
    r = replay_day()
    other = copy.deepcopy(r)
    for p in other["series"][0]["points"]:
        p["actual"] = 999.0 - p["actual"]
    a, b = battery_pool.payload(date(2026, 10, 26), r), battery_pool.payload(date(2026, 10, 26), other)
    assert a[5] == b[5] and a[4] != b[4]


def test_regime_comes_from_the_file_else_the_constraint_cost():
    assert battery_pool.regime({"regime": "calm", "constraint_cost_gbp": 9e9}) == "calm"
    assert battery_pool.regime({"constraint_cost_gbp": 36e6}) == "windy"
    assert battery_pool.regime({"constraint_cost_gbp": 1e5}) == "calm"


def test_incomplete_day_is_refused():
    r = replay_day()
    r["series"][0]["points"] = r["series"][0]["points"][:20]
    with pytest.raises(ValueError):
        battery_pool.payload(date(2026, 10, 26), r)
    r = replay_day()
    r["series"] = r["series"][1:]
    with pytest.raises(ValueError, match="no GB"):
        battery_pool.payload(date(2026, 10, 26), r)


def test_module_battery_rules_match_the_settlement_reference(tmp_path):
    """spacetime/module/src/battery_math.ts run with node against engine.game.settle; skipped without node or esbuild."""
    esbuild = ROOT / "web" / "node_modules" / ".bin" / "esbuild"
    node = shutil.which("node")
    if not esbuild.exists() or not node:
        pytest.skip("node or esbuild not installed")
    out = tmp_path / "battery_math.mjs"
    subprocess.run([str(esbuild), str(ROOT / "spacetime/module/src/battery_math.ts"), "--bundle", "--format=esm", f"--outfile={out}", "--log-level=error"], check=True)
    cases = [(soc, a, p) for soc in (0.0, 0.2, 1.0, 1.9, 2.0) for a in ("charge", "hold", "discharge") for p in (-20.0, 55.5, 310.0)]
    script = tmp_path / "run.mjs"
    script.write_text(f"""import {{ step, slotPnl }} from './battery_math.mjs';
const cases = {json.dumps(cases)};
console.log(JSON.stringify(cases.map(([soc, a, p]) => {{ const [g, s] = step(soc, a); return [g, s, slotPnl(p, g)]; }})));
""")
    got = json.loads(subprocess.run([node, str(script)], capture_output=True, text=True, check=True).stdout)
    b = settle.GameBattery()
    for (soc, a, p), (g, s, pnl) in zip(cases, got):
        grid, new = settle.step(soc, a, b)
        assert g == pytest.approx(grid, abs=1e-9) and s == pytest.approx(new, abs=1e-9), (soc, a)
        assert pnl == pytest.approx(round(-p * grid - b.degradation_per_mwh * abs(grid), 2), abs=0.011), (soc, a, p)


def test_module_action_grammar_sizes_and_offers(tmp_path):
    """charge:50 moves half the energy; an offer below its limit does not trade; bad actions are refused."""
    esbuild = ROOT / "web" / "node_modules" / ".bin" / "esbuild"
    node = shutil.which("node")
    if not esbuild.exists() or not node:
        pytest.skip("node or esbuild not installed")
    out = tmp_path / "battery_math.mjs"
    subprocess.run([str(esbuild), str(ROOT / "spacetime/module/src/battery_math.ts"), "--bundle", "--format=esm", f"--outfile={out}", "--log-level=error"], check=True)
    script = tmp_path / "run.mjs"
    script.write_text("""import { parseAction, step } from './battery_math.mjs';
const bad = ['', 'explode', 'charge:0', 'charge:101', 'charge:5.5', 'hold:50', 'offer:charge:5', 'offer:discharge', 'offer:discharge:x', 'charge:50:1'];
console.log(JSON.stringify({
  full: step(1, 'charge'), half: step(1, 'charge:50'), quarter: step(1, 'discharge:25'),
  belowLimit: step(1, 'offer:discharge:180', 100), atLimit: step(1, 'offer:discharge:180', 180), noPrice: step(1, 'offer:discharge:180'),
  offerHalf: step(1, 'offer:discharge:100:50', 150), unknown: step(1, 'explode'),
  bad: bad.map(a => parseAction(a)), ok: ['hold', 'charge', 'charge:100', 'offer:discharge:180:50'].map(a => parseAction(a)),
}));
""")
    got = json.loads(subprocess.run([node, str(script)], capture_output=True, text=True, check=True).stdout)
    assert got["half"][0] == pytest.approx(got["full"][0] / 2)
    assert got["quarter"][0] == pytest.approx(settle.step(1, "discharge", settle.GameBattery())[0] / 4)
    assert got["belowLimit"] == [0, 1] and got["unknown"] == [0, 1]
    assert got["atLimit"][0] == pytest.approx(settle.step(1, "discharge", settle.GameBattery())[0])
    assert got["offerHalf"][0] == pytest.approx(settle.step(1, "discharge", settle.GameBattery())[0] / 2)
    assert all(x is None for x in got["bad"]) and all(x is not None for x in got["ok"])
