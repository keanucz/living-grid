import json

import numpy as np
import pandas as pd
import pytest

from pipeline import bot_league, cache
from pipeline.models import bots
from pipeline.tests.test_backtest import KW
from pipeline.tests.test_features import populated  # noqa: F401  (fixture)

TS = pd.date_range("2026-10-20T00:00Z", periods=96, freq="h")


def frame(models: dict, y=None, zone="GB", target="price_da", line=100.0):
    """Synthetic league rows: models maps name -> (p10, p50, p90) arrays (p10/p90 None for a point model)."""
    y = np.asarray(y if y is not None else 100 + 10 * np.sin(np.arange(len(TS)) / 4))
    parts = []
    for m, (lo, mid, hi) in models.items():
        parts.append(pd.DataFrame({"ts": TS, "zone": zone, "y": y, "model": m, "p10": lo if lo is not None else np.nan,
                                   "p50": mid, "p90": hi if hi is not None else np.nan, "source": "backtest",
                                   "fold": 0, "day": None, "target": target, "line": line}))
    return pd.concat(parts, ignore_index=True)


def test_dm_finds_a_clearly_better_model_and_not_an_identical_one():
    rng = np.random.default_rng(1)
    ours = np.abs(rng.normal(0, 1, 500))
    worse = ours + 1 + np.abs(rng.normal(0, 0.2, 500))
    r = bot_league.diebold_mariano(ours, worse)
    assert r["significant"] and r["mean_gain"] > 0
    assert not bot_league.diebold_mariano(ours, ours.copy())["significant"]
    assert bot_league.diebold_mariano(ours[:10], worse[:10])["dm_stat"] is None  # too few rows


def test_metrics_brier_and_coverage_on_known_rows():
    y = np.full(len(TS), 100.0)
    rows = frame({"lgbm_q": (y - 10, y, y + 10), "bot_wide": (y - 50, y + 20, y + 60), "persistence": (None, y + 5, None)}, y=y)
    rows = bot_league.add_questions(rows)
    assert (rows["threshold"] == 100).all() and (rows["above"] == 0).all()  # y equals the line: not above
    assert (bot_league.add_questions(frame({"lgbm_q": (y, y, y)}, y=y, line=104.0))["threshold"] == 100).all()
    by = {m: bot_league.metrics(g) for m, g in rows.groupby("model")}
    assert by["lgbm_q"]["mae"] == 0 and by["lgbm_q"]["coverage_p10_p90"] == 1
    assert by["bot_wide"]["mae"] == pytest.approx(20)
    assert by["persistence"]["pinball"] is None and by["persistence"]["coverage_p10_p90"] is None
    # ours puts P(above 100) at 0.5, the point model is "certain" it is above (0.98), the wide bot in between
    assert by["lgbm_q"]["brier"] == pytest.approx(0.25)
    assert by["persistence"]["brier"] == pytest.approx(0.98 ** 2)
    assert by["lgbm_q"]["brier"] < by["bot_wide"]["brier"] < by["persistence"]["brier"]


def test_regimes_split_on_gb_wind_and_report_ranks_and_dm():
    rng = np.random.default_rng(0)
    y = 100 + rng.normal(0, 5, len(TS))
    good = y + rng.normal(0, 1, len(TS))
    rows = frame({"lgbm_q": (good - 3, good, good + 3), "bot_yesterday": (y - 30, y + 15, y + 30),
                  "persistence": (None, y + 12, None)}, y=y)
    wind = pd.DataFrame({"ts": TS, "zone": "GB", "series": "gen_wind", "value": np.where(TS.day == 22, 15000.0, 5000.0)})
    storms = bot_league.storm_days(wind, q=0.75)
    assert storms == {pd.Timestamp("2026-10-22").date()}
    rep = bot_league.report(rows, storms, {"test": True})
    t = rep["targets"]["price_da"]
    assert t["regime_days"] == {"calm": 3, "storm": 1}
    assert [r["model"] for r in t["overall"]][0] == "lgbm_q" and t["overall"][0]["rank_pinball"] == 1
    assert t["winner"]["all"] == {"pinball": "lgbm_q", "brier": "lgbm_q"}
    dm = {r["model"]: r for r in t["dm_vs_ours"]["all"]}
    assert dm["bot_yesterday"]["verdict"] == "ours better" and dm["persistence"]["mean_gain"] > 0
    assert set(t["dm_vs_ours"]) == {"all", "calm", "storm"}
    assert rep["headline"] and "Our model" in rep["headline"][0]
    json.dumps(rep)


def test_collect_scores_every_bot_on_backtest_and_replay_rows_without_leakage(populated, monkeypatch):  # noqa: F811
    seen = []
    real = bots.base.Bot.fit

    def spy(self, df, ctx):
        seen.append((self.name, df["ts"].max()))
        return real(self, df, ctx)

    monkeypatch.setattr(bots.base.Bot, "fit", spy)
    day = "2026-11-08"
    rows = bot_league.collect(targets=["price_da"], replay_days=[day], **KW)
    assert set(rows["model"]) == {"lgbm_q", *bots.NAMES, "persistence", "yesterday"}
    assert set(rows["source"]) == {"backtest", "replay"}
    # every model is scored on exactly the same rows in each block
    n = rows.groupby(["source", "fold", "model"]).size().unstack("model")
    assert (n.nunique(axis=1) == 1).all()
    rp = rows[rows["source"] == "replay"]
    assert (rp["ts"] >= pd.Timestamp(day, tz="UTC")).all()
    assert max(t for _, t in seen) < pd.Timestamp(day, tz="UTC")
    assert rows["line"].notna().mean() > 0.9  # the week-mean line is known at almost every origin
    banded = rows[rows["p10"].notna()]
    assert (banded["p10"] <= banded["p50"] + 1e-9).all() and (banded["p50"] <= banded["p90"] + 1e-9).all()


def test_main_writes_the_json_and_rows(populated, monkeypatch):  # noqa: F811
    real = bot_league.collect
    monkeypatch.setattr(bot_league, "collect", lambda *a, **k: real(targets=["price_da"], replay_days=[], **{**KW, "params": {**KW["params"], **k["params"]}}))
    assert bot_league.main(["--targets", "price_da", "--no-replay"]) == 0
    rep = json.loads((cache.DATA / "backtest" / "bot_league.json").read_text())
    assert set(rep["targets"]) == {"price_da"}
    assert {m["name"] for m in rep["models"]} >= {"lgbm_q", *bots.NAMES}
    assert cache.read(bot_league.ROWS)["model"].nunique() == 7
