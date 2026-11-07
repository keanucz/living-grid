import numpy as np
import pandas as pd
import pytest

from engine.interventions import passthrough as pt
from pipeline import cache

# The live pipeline estimate (#33) for November: co-movement with gas, inverted for GB and NO2.
LIVE_NOV = {"GB": 0.066, "NO2": 0.477, "BE": 0.148, "FR": 0.161, "DE-LU": 0.109, "NL": 0.093}


@pytest.fixture
def inverted_estimate(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    feats = pd.read_parquet(cache.FIXTURES / "features" / "latest.parquet")
    share = pd.DataFrame({"zone": feats["zone"], "hour_of_day": feats["ts"].dt.hour, "month": feats["ts"].dt.month}).drop_duplicates()
    share["share"] = share["zone"].map(LIVE_NOV)
    (tmp_path / "features").mkdir()
    share.to_parquet(tmp_path / "features" / "gas_marginal_share.parquet")
    return feats


def by_zone(feats, delta):
    return pd.Series(delta, index=feats["zone"].to_numpy()).groupby(level=0).mean()


def test_hormuz_40pct_at_ttf_28_moves_gb_about_10_gbp_and_norway_far_less(inverted_estimate):
    feats = inverted_estimate
    delta, source = pt.power_delta(feats, d_gas_eur_mwh=0.40 * 28)
    d = by_zone(feats, delta)
    assert 8.0 <= d["GB"] <= 13.0, d["GB"]
    assert d["NO2"] <= 0.25 * d["GB"]
    assert d["NL"] > d["NO2"] and d["DE-LU"] > d["NO2"]
    assert "bounded by standard estimates" in source and "GB at least 60%" in source


def test_bounds_clip_only_where_the_estimate_is_outside_them():
    zones = pd.Series(["GB", "GB", "NO2", "NL", "DE-LU", "BE", "FR"])
    out = pt.bounded(np.array([0.066, 0.9, 0.477, 0.093, 0.7, 0.148, 0.161]), zones)
    assert out.tolist() == pytest.approx([pt.GB_GAS_MARGINAL_SHARE, 0.9, 0.10, 0.40, 0.7, 0.148, 0.161])


def test_priors_already_sit_inside_the_bounds():
    zones = pd.Series(list(pt.PRIOR_GAS_MARGINAL_SHARE))
    prior = np.array(list(pt.PRIOR_GAS_MARGINAL_SHARE.values()))
    assert pt.bounded(prior, zones).tolist() == pytest.approx(prior.tolist())
