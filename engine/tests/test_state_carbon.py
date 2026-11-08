import pandas as pd
import pytest

from engine import data


def frame(ends: dict[str, str]):
    rows = []
    for zone, end in ends.items():
        for h in range(8):
            ts = pd.Timestamp(end, tz="UTC") - pd.Timedelta(hours=h)
            rows.append({"ts": ts, "zone": zone, "production_gco2_kwh": 100.0 + h, "consumption_gco2_kwh": 150.0 + h, "imports_share": 0.1})
    return pd.DataFrame(rows)


AT = pd.Timestamp("2026-11-08 01:00", tz="UTC")
# As seen live at 01:00: GB current, NL three hours behind, BE and NO2 four hours behind.
ENDS = {"GB": "2026-11-08 00:00", "FR": "2026-11-07 23:00", "NL": "2026-11-07 22:00", "BE": "2026-11-07 21:00", "NO2": "2026-11-07 21:00"}


def test_every_zone_keeps_its_newest_hour_when_zones_end_at_different_hours(monkeypatch):
    monkeypatch.setattr(data, "carbon", lambda: frame(ENDS))
    out = data.carbon_at(AT)
    assert set(out) == set(ENDS)
    assert out["NL"]["production_gco2_kwh"] == 100.0 and out["BE"]["consumption_gco2_kwh"] == 150.0  # each zone's own latest row
    assert all(v["kind"] == "modelled" for v in out.values())


def test_a_zone_older_than_the_metered_window_is_still_dropped(monkeypatch):
    monkeypatch.setattr(data, "carbon", lambda: frame({"GB": "2026-11-08 00:00", "NO2": "2026-11-07 18:00"}))
    assert set(data.carbon_at(AT)) == {"GB"}  # 7 h old: stale, not shown as current


def test_rows_after_the_asked_hour_are_ignored(monkeypatch):
    monkeypatch.setattr(data, "carbon", lambda: frame({"GB": "2026-11-08 05:00"}))
    out = data.carbon_at(AT)
    assert out["GB"]["production_gco2_kwh"] == pytest.approx(100.0 + 4)  # the 01:00 row, 4 h before the newest
