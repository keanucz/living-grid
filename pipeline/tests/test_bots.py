import numpy as np
import pandas as pd
import pyarrow as pa
import pytest

from pipeline import backtest, schemas
from pipeline.models import bots, train
from pipeline.models.bots import base, committee, engineer, naive
from pipeline.models.bots.lgbm import OurModel
from pipeline.tests.test_backtest import KW
from pipeline.tests.test_features import populated  # noqa: F401  (fixture)

START = pd.Timestamp("2026-10-01T00:00Z")


def synthetic(days=60, zones=("GB", "FR"), seed=0):
    """Hourly frame with the columns the bots read: a price that rises with residual load plus gas and carbon."""
    rng = np.random.default_rng(seed)
    ts = pd.date_range(START, periods=24 * days, freq="h")
    frames, wide = [], {}
    for z in zones:
        rl = 30000 + 15000 * np.sin(np.arange(len(ts)) / 24 * 2 * np.pi) + rng.normal(0, 1500, len(ts))
        gas = 35 + 5 * np.sin(np.arange(len(ts)) / 500)
        eua = 70.0
        y = 0.002 * rl + 2 * gas + 0.37 * eua - 40 + rng.normal(0, 3, len(ts))
        frames.append(pd.DataFrame({"ts": ts, "zone": z, "residual_load_mw": rl, "gas_ttf_eur_mwh": gas, "eua_eur_t": eua, "y": y}))
        wide[z] = pd.Series(y, index=ts)
    return pd.concat(frames, ignore_index=True), pd.DataFrame(wide)


@pytest.fixture
def data():
    df, wide = synthetic()
    return df, base.Context(wide=wide, lead_h=12)


def is_sorted(q):
    return bool(np.all(q[:, 0] <= q[:, 1]) and np.all(q[:, 1] <= q[:, 2]))


def test_yesterday_uses_the_same_hour_a_day_earlier_and_a_band_from_its_errors(data):
    df, ctx = data
    tr, te = df[df.ts < START + pd.Timedelta(days=50)], df[df.ts >= START + pd.Timedelta(days=50)]
    bot = naive.Yesterday().fit(tr, ctx)
    q = bot.predict(te, ctx)
    assert is_sorted(q)
    expect = base.lagged(ctx, te, 24)
    np.testing.assert_allclose(q[:, 1], expect)
    lo, hi = bot.band["GB"]
    assert lo < 0 < hi
    np.testing.assert_allclose(q[:, 0], expect + np.array([bot.band[z][0] for z in te.zone]))


def test_last_week_looks_seven_days_back(data):
    df, ctx = data
    tr, te = df[df.ts < START + pd.Timedelta(days=50)], df[df.ts >= START + pd.Timedelta(days=50)]
    q = naive.LastWeek().fit(tr, ctx).predict(te, ctx)
    np.testing.assert_allclose(q[:, 1], base.lagged(ctx, te, 168))
    assert is_sorted(q)


def test_engineer_curve_is_monotone_and_follows_gas_and_residual_load(data):
    df, ctx = data
    tr, te = df[df.ts < START + pd.Timedelta(days=50)], df[df.ts >= START + pd.Timedelta(days=50)]
    bot = engineer.Engineer().fit(tr, ctx)
    for zone in ("GB", "FR"):
        ky = [k["price_ex_fuel"] for k in bot.knots(zone)]
        assert ky == sorted(ky)
    q = bot.predict(te, ctx)
    assert is_sorted(q)
    assert np.abs(q[:, 1] - te.y.to_numpy()).mean() < 6  # the synthetic price really is this function
    dearer = te.assign(gas_ttf_eur_mwh=te.gas_ttf_eur_mwh + 20)
    assert (bot.predict(dearer, ctx)[:, 1] > q[:, 1]).all()
    tight = te.assign(residual_load_mw=te.residual_load_mw + 8000)
    assert (bot.predict(tight, ctx)[:, 1] >= q[:, 1]).all()


def test_engineer_fuel_cost_is_gas_and_carbon_in_each_zones_currency():
    f = pd.DataFrame({"zone": ["FR", "GB"], "gas_ttf_eur_mwh": [30.0, 30.0], "eua_eur_t": [80.0, 80.0]})
    eur = 2.0 * 30 + 0.37 * 80
    np.testing.assert_allclose(engineer.fuel_cost(f), [eur, eur / 1.15])


def test_committee_weights_the_better_component_and_calibrates(data):
    df, ctx = data
    tr, te = df[df.ts < START + pd.Timedelta(days=50)], df[df.ts >= START + pd.Timedelta(days=50)]

    class Noisy(naive.Yesterday):
        name = "noisy"

        def predict(self, d, c):
            q = super().predict(d, c)
            return q + np.random.default_rng(1).normal(0, 25, (len(q), 1))

    make = lambda: [engineer.Engineer(), Noisy()]  # noqa: E731
    parts = [engineer.Engineer().fit(tr, ctx), Noisy().fit(tr, ctx)]
    bot = committee.Committee(parts, make).fit(tr, ctx)
    assert bot.fits is not None
    w = bot.weights
    assert w["bot_engineer"] > 0.5 > abs(w["noisy"])
    q = bot.predict(te, ctx)
    assert is_sorted(q)
    y = te.y.to_numpy()
    assert np.abs(q[:, 1] - y).mean() <= np.abs(parts[1].predict(te, ctx)[:, 1] - y).mean()
    assert 0.6 < ((y >= q[:, 0]) & (y <= q[:, 2])).mean() <= 1.0


def test_committee_without_a_stack_falls_back_to_the_mean_of_its_components(data):
    df, ctx = data
    tr, te = df[df.ts < START + pd.Timedelta(days=50)], df[df.ts >= START + pd.Timedelta(days=50)]
    parts = [engineer.Engineer().fit(tr, ctx), naive.Yesterday().fit(tr, ctx)]
    bot = committee.Committee(parts).fit(tr, ctx)
    assert bot.fits is None
    np.testing.assert_allclose(bot.predict(te, ctx), np.stack([p.predict(te, ctx) for p in parts]).mean(axis=0))


def test_pinball_and_prob_above():
    y = np.array([10.0, 20.0])
    exact = np.column_stack([y, y, y])
    assert base.pinball(y, exact) == 0
    assert base.pinball(np.array([10.0]), np.array([[0.0, 0.0, 0.0]])) == pytest.approx(10 * (0.1 + 0.5 + 0.9) / 3)
    assert base.prob_above(100, 80, 100, 120) == pytest.approx(0.5)
    assert base.prob_above(80, 80, 100, 120) == pytest.approx(0.9)
    assert base.prob_above(1000, 80, 100, 120) == 0.02 and base.prob_above(-1000, 80, 100, 120) == 0.98


def test_naive_predictions_ignore_actuals_after_each_forecast_origin(data):
    df, ctx = data
    tr, te = df[df.ts < START + pd.Timedelta(days=50)], df[df.ts >= START + pd.Timedelta(days=50)]
    te = te.head(48)
    for cls in (naive.Yesterday, naive.LastWeek):
        bot = cls().fit(tr, ctx)
        before = bot.predict(te, ctx)
        for i in (0, 13, 47):
            row = te.iloc[[i]]
            wide = ctx.wide.copy()
            wide[wide.index >= row.ts.iloc[0] - pd.Timedelta(hours=ctx.lead_h)] = 1e9  # nothing known after this row's origin
            np.testing.assert_allclose(bot.predict(row, base.Context(wide=wide, lead_h=ctx.lead_h)), before[[i]])


def test_every_bot_is_fitted_only_on_the_training_frame_and_leakage_is_refused(data):
    df, ctx = data
    cut = START + pd.Timedelta(days=50)
    tr = df[df.ts < cut]
    parts = [naive.Yesterday(), naive.LastWeek(), engineer.Engineer()]
    for b in parts:
        b.fit(tr, ctx)
        base.assert_no_leakage(b, cut)
        with pytest.raises(ValueError, match="refusing"):
            base.assert_no_leakage(b, cut - pd.Timedelta(days=2))
    with pytest.raises(ValueError, match="not been fitted"):
        base.assert_no_leakage(engineer.Engineer(), cut)


def test_fit_asof_trains_only_before_the_date_and_every_bot_passes_the_check(populated):  # noqa: F811
    hist = train.build.build_history()
    date = hist["ts"].max().floor("D") - pd.Timedelta(days=3)
    seen = []
    real = train.build.build_history
    train.build.build_history = lambda **kw: (seen.append(kw.get("end")), real(**kw))[1]
    try:
        fitted, ctx = bots.fit_asof(date, params=KW["params"])
    finally:
        train.build.build_history = real
    assert seen and all(pd.Timestamp(e) < date for e in seen)
    assert set(fitted) == {"lgbm_q", *bots.NAMES}
    for b in fitted.values():
        assert b.trained_through < date
    rows = hist[hist.ts >= date].head(24)
    q = bots.predict_league(fitted, rows.reset_index(drop=True), ctx)
    assert set(q) == set(fitted) and all(v.shape == (24, 3) for v in q.values())


def test_league_specs_name_every_member():
    s = bots.specs()
    assert [x["name"] for x in s] == ["lgbm_q", *bots.NAMES]
    assert all(x["title"] and x["method"] for x in s)


def test_backtest_scores_every_bot_on_the_same_rows_as_the_model(populated):  # noqa: F811
    wf, lg = backtest.run_with_league(targets=["price_da", "load"], bots=True, **KW)
    backtest.check(wf)
    assert list(wf.columns) == schemas.WALK_FORWARD.names
    price = wf[wf.target == "price_da"]
    assert set(price.model) == {"lgbm_q", "persistence", "yesterday", *bots.NAMES}
    assert set(wf[wf.target == "load"].model) == {"lgbm_q", "persistence", "yesterday"}  # bots are for prices
    assert (wf.groupby(["fold", "zone", "target"])["n"].nunique() == 1).all()
    assert set(lg.model) == {"lgbm_q", *bots.NAMES}
    pa.Table.from_pandas(lg[schemas.BOT_LEAGUE.names], schema=schemas.BOT_LEAGUE, preserve_index=False, safe=True)
    assert lg.pinball.notna().all() and (lg.pinball >= 0).all()
    summ = backtest.league_summary(lg)
    assert summ.groupby("target")["rank_pinball"].min().eq(1).all()
    assert "bot_committee" in backtest.league_report(lg)


def test_bot_rows_never_use_a_fit_at_or_after_their_fold_test_start(populated, monkeypatch):  # noqa: F811
    seen = []
    real = bots.committee.Committee._fit

    def spy(self, df, ctx):
        seen.append(df["ts"].max())
        return real(self, df, ctx)

    monkeypatch.setattr(bots.committee.Committee, "_fit", spy)
    wf, _ = backtest.run_with_league(targets=["price_da"], bots=True, **KW)
    hist_ts = train.build.build_history()["ts"]
    folds = backtest.make_folds(hist_ts.min(), hist_ts.max(), KW["n_folds"], KW["test_days"], KW["purge_h"])
    assert len(seen) == wf["fold"].nunique()
    for k, (train_end, test_start, _) in enumerate(folds):
        assert seen[k] < train_end <= test_start


def test_our_model_wrapper_matches_the_raw_boosters(populated):  # noqa: F811
    hist = train.build.build_history()
    wides = train.target_frames(train.build.Inputs())
    df = train.training_frame(hist, wides["price_da"], pd.Timestamp.max.tz_localize("UTC"))
    ctx = base.Context(wide=wides["price_da"], params=KW["params"])
    m = OurModel(calibrate_bands=False).fit(df, ctx)
    q = m.predict(df.head(10), ctx)
    assert is_sorted(q) and q.shape == (10, 3)
