import pandas as pd

from engine import data


def _rows(source_zone_series):
    ts = pd.Timestamp("2026-11-07 12:00", tz="UTC")
    return pd.DataFrame(
        [{"ts": ts, "zone": z, "series": s, "value": v, "unit": "MW", "source": src} for src, z, s, v in source_zone_series]
    )


def test_zone_series_drops_country_level_norway_but_keeps_other_sources(monkeypatch):
    rows = _rows(
        [
            ("energycharts", "NO2", "load", 15300.0),
            ("entsoe", "NO2", "load", 5100.0),
            ("energycharts", "FR", "load", 52000.0),
            ("energycharts", "FR", "gen_nuclear", 41000.0),
        ]
    )
    monkeypatch.setattr(data, "actuals", lambda: rows)
    load, mix = data.zone_series(pd.Timestamp("2026-11-07 12:30", tz="UTC"))
    assert load == {"NO2": 5100.0, "FR": 52000.0}
    assert mix == {"FR": {"nuclear": 41000.0}}


def test_zone_series_ignores_rows_outside_the_metered_window(monkeypatch):
    rows = _rows([("energycharts", "FR", "load", 52000.0)])
    monkeypatch.setattr(data, "actuals", lambda: rows)
    load, _ = data.zone_series(pd.Timestamp("2026-11-08 12:00", tz="UTC"))
    assert load == {}


def test_actuals_is_memoised_until_a_file_changes(tmp_path, monkeypatch):
    d = tmp_path / "actuals"
    d.mkdir()
    f = d / "elexon_load.parquet"
    _rows([("elexon", "GB", "load", 30000.0)]).drop(columns="source").to_parquet(f)
    monkeypatch.setattr(data, "_files", lambda sub: {"elexon_load": f})
    first = data.actuals()
    assert data.actuals() is first
    _rows([("elexon", "GB", "load", 31000.0)]).drop(columns="source").to_parquet(f)
    import os

    st = f.stat()
    os.utime(f, (st.st_atime, st.st_mtime + 5))
    second = data.actuals()
    assert second is not first
    assert second["value"].tolist() == [31000.0]
