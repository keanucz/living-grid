import numpy as np
import pandas as pd

from engine import household


def ts(*stamps):
    return pd.DatetimeIndex([pd.Timestamp(x, tz="UTC") for x in stamps])


def test_zero_vat_window_follows_uk_dates():
    f = household.vat_factor(ts("2026-09-30T22:59", "2026-09-30T23:00", "2026-11-08T03:00", "2027-03-31T22:59", "2027-04-01T00:00"))
    # 23:00 UTC on 30 Sep is 00:00 BST on 1 Oct; 1 Apr 2027 00:00 UTC is 01:00 BST, after the window
    assert f.tolist() == [1.05, 1.0, 1.0, 1.0, 1.05]


def test_forecast_agile_has_no_vat_in_november_2026():
    t = ts("2026-11-08T03:00")
    price = household.agile_from_wholesale(np.array([100.0]), t, d=2.2, p=12.0)  # GBP 100/MWh = 10p/kWh, overnight
    assert price[0] == 2.2 * 10.0


def test_forecast_agile_keeps_5pc_vat_outside_the_window():
    t = ts("2026-09-01T03:00")
    price = household.agile_from_wholesale(np.array([100.0]), t, d=2.2, p=12.0)
    assert np.isclose(price[0], 2.2 * 10.0 * 1.05)
