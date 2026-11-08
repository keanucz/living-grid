import httpx
import pandas as pd
import pytest

from pipeline import schemas
from pipeline.ingest import mid_proxy

START = pd.Timestamp("2025-06-01", tz="UTC")


@pytest.fixture(autouse=True)
def online(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def client():
    rows = []
    for i, (price, vol) in enumerate([(10.0, 5), (20.0, 5), (30.0, 5), (0.0, 0)]):
        t = START + pd.Timedelta(minutes=30 * i)
        rows.append({"startTime": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "dataProvider": "APXMIDP", "price": price, "volume": vol})
        rows.append({"startTime": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "dataProvider": "N2EXMIDP", "price": 0.0, "volume": 0})
    return httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, json={"data": rows})))


def test_fetch_hourly_price_da_for_gb_without_zero_volume_rows():
    df = mid_proxy.fetch(START, START + pd.Timedelta(hours=3), client=client())
    schemas.validate(df, "actuals")
    assert set(df["series"]) == {"price_da"} and set(df["zone"]) == {"GB"} and set(df["unit"]) == {"GBP/MWh"}
    assert df["value"].tolist() == [15.0, 30.0]


def test_write_merges_under_its_own_source(tmp_path, monkeypatch):
    from pipeline import cache

    monkeypatch.setattr(cache, "DATA", tmp_path)
    df = mid_proxy.fetch(START, START + pd.Timedelta(hours=3), client=client())
    assert mid_proxy.write(df) == ["actuals/mid_price_da"]
    assert mid_proxy.write(df) == ["actuals/mid_price_da"]
    assert len(cache.read("actuals/mid_price_da")) == 2
