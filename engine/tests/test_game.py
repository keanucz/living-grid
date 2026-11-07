import httpx
import pandas as pd
import pytest

from engine.game import agent, settle
from engine.game.__main__ import run_once
from engine.game.settle import GameBattery
from engine.publisher.client import Client
from pipeline import cache

ALICE = "aa" * 32
BOB = "bb" * 32
T0 = pd.Timestamp("2026-11-07T10:00Z")


@pytest.fixture(autouse=True)
def offline(tmp_path, monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    monkeypatch.setattr(cache, "DATA", tmp_path)


def key(identity: str, slot: pd.Timestamp) -> str:
    return f"{identity}|{slot.value // 1000}"


def frame(*moves) -> pd.DataFrame:
    """moves: (identity, half-hours after T0, action[, settled])"""
    rows = [[key(i, T0 + settle.SLOT * n), a, s[0] if s else False] for i, n, a, *s in moves]
    return settle.decisions_frame(rows)


def hourly(values: dict[int, float]) -> pd.Series:
    return pd.Series({T0 + pd.Timedelta(hours=h): v for h, v in values.items()}, dtype=float)


def test_key_round_trip():
    identity, slot = settle.parse_key(key(ALICE, T0))
    assert identity == ALICE and slot == T0


def test_battery_clips_at_full_and_empty():
    b = GameBattery()
    soc = b.soc0_mwh
    grid = []
    for _ in range(4):
        e, soc = settle.step(soc, "charge", b)
        grid.append(e)
    assert soc == pytest.approx(2.0)
    assert grid[0] == pytest.approx(0.5) and grid[-1] == 0.0
    sold = 0.0
    for _ in range(6):
        e, soc = settle.step(soc, "discharge", b)
        sold -= e
    assert soc == pytest.approx(0.0, abs=1e-9)
    assert sold == pytest.approx(2.0 * b.eta)


def test_buy_low_sell_high_earns_and_round_trip_loses_energy():
    d = frame((ALICE, 0, "charge"), (ALICE, 1, "charge"), (ALICE, 2, "discharge"), (ALICE, 3, "discharge"))
    final = hourly({0: 40.0, 1: 140.0})
    out = settle.settle(d, final, pd.Series(dtype=float), T0 + pd.Timedelta(hours=3))
    assert out["final"].all()
    assert out["pnl"].sum() > 0
    charge = out[out["action"] == "charge"]
    assert charge["pnl"].iloc[0] == pytest.approx(-(40 * 0.5) - 2 * 0.5, abs=0.01)
    assert out["price"].tolist() == [40.0, 40.0, 140.0, 140.0]


def test_players_settle_independently_and_hold_is_free():
    d = frame((ALICE, 0, "discharge"), (BOB, 0, "hold"))
    out = settle.settle(d, hourly({0: 100.0}), pd.Series(dtype=float), T0 + pd.Timedelta(hours=1))
    pnl = out.set_index("identity")["pnl"]
    assert pnl[BOB] == 0.0
    assert pnl[ALICE] == pytest.approx(100 * 0.5 - 2 * 0.5, abs=0.01)


def test_provisional_until_system_price_then_final():
    d = frame((ALICE, 0, "discharge"), (ALICE, 2, "discharge"))
    now = T0 + pd.Timedelta(hours=2)
    out = settle.settle(d, hourly({0: 100.0}), hourly({0: 90.0, 1: 70.0}), now)
    by_slot = out.set_index("slot")
    assert bool(by_slot.loc[T0, "final"]) and by_slot.loc[T0, "price"] == 100.0
    later = T0 + settle.SLOT * 2
    assert not by_slot.loc[later, "final"] and by_slot.loc[later, "price"] == 70.0


def test_open_and_already_settled_slots_are_not_sent_but_still_move_the_battery():
    d = frame((ALICE, 0, "discharge", True), (ALICE, 1, "discharge"), (ALICE, 2, "discharge"), (ALICE, 9, "charge"))
    out = settle.settle(d, hourly({0: 100.0, 1: 100.0}), pd.Series(dtype=float), T0 + pd.Timedelta(hours=1, minutes=30))
    assert out["slot"].tolist() == [T0 + settle.SLOT, T0 + settle.SLOT * 2]
    b = settle.GameBattery()
    soc_after_settled = b.soc0_mwh - 0.5 / b.eta
    assert out["soc_mwh"].iloc[0] == pytest.approx(0.0, abs=1e-9)
    assert -out["grid_mwh"].iloc[0] == pytest.approx(soc_after_settled * b.eta)
    assert out["grid_mwh"].iloc[1] == 0.0 and out["pnl"].iloc[1] == 0.0


def test_no_price_means_no_settlement():
    d = frame((ALICE, 0, "charge"))
    assert settle.settle(d, pd.Series(dtype=float), pd.Series(dtype=float), T0 + pd.Timedelta(hours=1)).empty


def test_gb_prices_fall_back_to_day_ahead_on_fixtures():
    final, provisional = settle.gb_prices()
    assert final.empty, "no system price in the offline fixtures"
    assert len(provisional) >= 24 and provisional.index.tz is not None


def test_gb_prices_prefer_market_index_over_day_ahead():
    a = pd.DataFrame({"ts": [T0, T0, T0, T0], "zone": ["GB", "GB", "GB", "FR"],
                      "series": ["market_index", "price_da", "system_price", "system_price"],
                      "value": [91.0, 80.0, 120.0, 5.0], "unit": "GBP/MWh"})
    final, provisional = settle.gb_prices(a)
    assert final[T0] == 120.0 and provisional[T0] == 91.0


def test_agent_buys_cheap_and_sells_dear():
    fc = pd.DataFrame({"ts": [T0 + pd.Timedelta(hours=h) for h in range(4)],
                       "p50": [30.0, 30.0, 150.0, 150.0]})
    fc["p10"], fc["p90"] = fc["p50"] - 5, fc["p50"] + 5
    moves = agent.plan(fc, 0.0, T0 - pd.Timedelta(minutes=1))
    assert len(moves) == 8
    actions = [m["action"] for m in moves]
    assert actions[:2] == ["charge", "charge"] and "discharge" in actions[4:]
    assert all(m["slot_us"] % 1_800_000_000 == 0 for m in moves)


def test_agent_skips_slots_that_have_started():
    fc = pd.DataFrame({"ts": [T0], "p10": [50.0], "p50": [60.0], "p90": [70.0]})
    moves = agent.plan(fc, 1.0, T0 + pd.Timedelta(minutes=10))
    assert [m["slot_us"] for m in moves] == [(T0 + settle.SLOT).value // 1000]


def test_agent_uses_fixture_forecast():
    log = cache.read_file(cache.FIXTURES / "forecasts" / "log.parquet")
    now = log["made_at"].max()
    fc = agent.latest_forecast(now)
    assert len(fc) == agent.HORIZON_H and (fc["p10"] <= fc["p90"]).all()


def test_run_once_against_a_fake_spacetimedb():
    log = cache.read_file(cache.FIXTURES / "forecasts" / "log.parquet")
    now = log["made_at"].max() + pd.Timedelta(minutes=5)
    past = (now - pd.Timedelta(hours=2)).floor("h")
    rows = [[key(ALICE, past), "charge", False], [key(ALICE, past + settle.SLOT), "discharge", False]]
    calls = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sql"):
            return httpx.Response(200, json=[{"rows": rows}])
        calls[request.url.path.rsplit("/", 1)[-1]] = __import__("json").loads(request.content)
        return httpx.Response(200)

    client = Client("http://stdb", token="t", transport=httpx.MockTransport(handler))
    out = run_once(client, now)
    assert out["settled"] == 2 and out["final"] == 0
    assert [r["key"] for r in calls["settle_decisions"][0]] == [rows[0][0], rows[1][0]]
    name, zone, moves = calls["set_agent"]
    assert zone == "GB" and moves and all(m["slot_us"] > now.value // 1000 for m in moves)


def test_run_once_offline_without_client():
    assert run_once(None, pd.Timestamp("2026-11-07T23:05Z"))["decisions"] == 0
