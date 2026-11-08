import time

import pandas as pd
import pytest

from engine import compute, data
from engine import datacentre as dc
from pipeline import cache

NOW = pd.Timestamp("2026-11-07T12:00Z")
HOURS = pd.date_range("2025-11-07", "2026-11-07T11:00", freq="h", tz="UTC")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setattr(compute, "clock", lambda: NOW)
    dc._MEMO.clear()
    data._concat_actuals.cache_clear()


def write(zone, offset=0.0):
    v = [(20.0 if 2 <= t.hour < 6 else 80.0) + offset + (t.day_of_year % 7) for t in HOURS]
    cache.write(f"actuals/energycharts_price_da_{zone}", pd.DataFrame({"ts": HOURS, "zone": zone, "series": "price_da", "value": v, "unit": "EUR/MWh"}))
    data._concat_actuals.cache_clear()


def setup_files():
    for z in ("FR", "DE-LU"):
        write(z)
    cache.write("carbon/consumption_intensity", pd.concat([pd.DataFrame({"ts": HOURS, "zone": z, "production_gco2_kwh": 90.0 + i * 50,
                "consumption_gco2_kwh": [100.0 + i * 50 + t.hour for t in HOURS], "imports_share": 0.1}) for i, z in enumerate(("FR", "DE-LU"))]))
    cache.write("markets/gas_carbon", pd.DataFrame({"ts": pd.date_range("2026-01-01", periods=300, tz="UTC"), "series": "eua",
                                                    "value": 70.0, "unit": "EUR/t", "source": "t"}))


def build(**kw):
    return dc.build(["FR", "DE-LU"], now=NOW.to_pydatetime(), **kw)


def test_cached_answer_is_identical_to_a_cold_one():
    setup_files()
    cold = build()
    warm = build()
    assert warm == cold
    dc._MEMO.clear()
    assert build(flexible_share=0.5, gpus=200) == (dc._MEMO.clear() or build(flexible_share=0.5, gpus=200))


def test_prepared_days_give_the_same_totals():
    setup_files()
    prices, _ = dc.hourly_prices("FR", NOW)
    carbon = dc.hourly_carbon("FR")
    assert dc.annual(prices, carbon, 500.0, 0.3, 900.0) == dc.annual(prices, carbon, 500.0, 0.3, 900.0, dc.complete_days(prices, carbon))


def test_second_call_is_fast():
    setup_files()
    build()
    t = time.perf_counter()
    build(flexible_share=0.4)  # a slider move: new parameters, same cached prices and carbon
    assert time.perf_counter() - t < 0.3


def test_a_new_price_file_is_read_again():
    setup_files()
    before = build()["sites"][0]["energy"]["mean_price_local_mwh"]
    time.sleep(0.01)
    write("FR", offset=10.0)
    after = build()["sites"][0]["energy"]["mean_price_local_mwh"]
    assert after == pytest.approx(before + 10.0)


def test_prices_up_to_any_minute_match_up_to_its_hour():
    setup_files()
    a, _ = dc.hourly_prices("FR", pd.Timestamp("2026-11-07T10:59Z"))
    dc._MEMO.clear()
    b, _ = dc._hourly_prices(data.actuals(), "FR", pd.Timestamp("2026-11-07T10:59Z"))
    assert a.equals(b) and a.index.max() == pd.Timestamp("2026-11-07T10:00Z")
