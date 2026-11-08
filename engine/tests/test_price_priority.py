"""Day-ahead prices from several sources are picked by source priority (Nord Pool first, the MID proxy last), never by file order."""

import pandas as pd
import pytest

from engine import data
from engine.battery import compare
from engine.game import settle
from engine.market.library import CacheData
from pipeline import cache

H = pd.date_range("2026-11-06T15:00Z", periods=4, freq="h")
NP = [300.0, 310.65, 305.0]  # Nord Pool has no row for the last hour
MID = [250.0, 281.47, 260.0, 270.0]


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    data._concat_actuals.cache_clear()
    yield
    data._concat_actuals.cache_clear()


def frame(source, values, zone="GB", series="price_da"):
    return pd.DataFrame({"ts": H[: len(values)], "zone": zone, "series": series, "value": values, "unit": "GBP/MWh", "source": source})


def rows(order):
    parts = {"mid": frame("mid", MID), "nordpool": frame("nordpool", NP)}
    return pd.concat([parts[s] for s in order], ignore_index=True)


EXPECT = pd.Series(NP + [MID[3]], index=H)


def same(s):
    s = s.sort_index()
    assert list(s.index) == list(H) and s.tolist() == pytest.approx(EXPECT.tolist())


@pytest.mark.parametrize("order", [("mid", "nordpool"), ("nordpool", "mid")])
def test_best_rows_prefers_nord_pool_whatever_the_order_and_mid_fills_gaps(order):
    best = data.best_rows(rows(order), "price_da")
    s = best.set_index("ts")["value"].sort_index()
    same(s)
    assert best.set_index("ts")["source"].tolist() == ["nordpool"] * 3 + ["mid"]


def test_best_rows_ranks_unknown_sources_before_the_mid_proxy():
    best = data.best_rows(pd.concat([frame("mid", MID), frame("someone", [1.0] * 4)]), "price_da")
    assert set(best["source"]) == {"someone"}


def test_best_rows_averages_sub_hourly_rows_within_a_source():
    q = pd.DataFrame({"ts": pd.date_range("2026-11-06T15:00Z", periods=4, freq="15min"), "zone": "FR", "series": "price_da",
                      "value": [298.26, 299.59, 299.0, 303.15], "unit": "EUR/MWh", "source": "energycharts"})
    best = data.best_rows(q, "price_da")
    assert len(best) == 1 and best["value"].iloc[0] == pytest.approx(300.0)


@pytest.mark.parametrize("order", [("mid", "nordpool"), ("nordpool", "mid")])
def test_game_provisional_price_is_nord_pool_whatever_the_file_order(order):
    _, provisional = settle.gb_prices(rows(order))
    same(provisional.sort_index())


def test_game_market_index_still_comes_before_day_ahead():
    a = pd.concat([rows(("nordpool", "mid")), frame("elexon", [111.0], series="market_index")])
    _, provisional = settle.gb_prices(a)
    assert provisional.iloc[0] == 111.0 and provisional.iloc[1] == NP[1]


def test_market_library_cache_data_uses_priority_not_the_mean():
    cache.write("actuals/nordpool_price_da", frame("nordpool", NP).drop(columns="source"))
    cache.write("actuals/mid_price_da", frame("mid", MID).drop(columns="source"))
    data._concat_actuals.cache_clear()
    s = CacheData().get("GB", "price_da")
    same(s)


def test_battery_compare_actuals_use_priority_not_the_mean():
    cache.write("actuals/nordpool_price_da", frame("nordpool", NP).drop(columns="source"))
    cache.write("actuals/mid_price_da", frame("mid", MID).drop(columns="source"))
    _, actual = compare.load_inputs()
    s = actual[actual["zone"] == "GB"].set_index("ts")["value"].sort_index()
    same(s)
