import pytest

from engine.battery import compare


def res(zone, risk, perfect, cur="EUR"):
    return [{"zone": zone, "strategy": "risk_aware", "profit": risk, "currency": cur},
            {"zone": zone, "strategy": "perfect_foresight", "profit": perfect, "currency": cur}]


FIVE = res("BE", 90.0, 100.0) + res("DE-LU", 95.0, 100.0) + res("FR", 97.0, 100.0) + res("GB", 80.0, 100.0, "GBP") + res("NL", 98.0, 100.0)
HOURS = {z: 24 for z in ("BE", "DE-LU", "FR", "GB", "NL")}


def test_a_zone_with_zero_perfect_profit_and_a_loss_does_not_change_the_pooled_share():
    base, n, _ = compare.pooled_share(FIVE, HOURS)
    with_no2, n2, note = compare.pooled_share(FIVE + res("NO2", -44.98, 0.0), {**HOURS, "NO2": 24})
    assert with_no2 == base and n2 == n == 5 * 24  # NO2's hours are not pooled either
    assert "Pooled over 5 zones" in note and "NO2" in note  # counted and named


def test_the_pool_is_the_five_scored_zones_not_six():
    expected = (90 + 95 + 97 + 80 * compare.EUR_PER_GBP + 98) / (100 * 4 + 100 * compare.EUR_PER_GBP)
    share, _, _ = compare.pooled_share(FIVE + res("NO2", -44.98, 0.0), {**HOURS, "NO2": 24})
    assert share == pytest.approx(expected, abs=1e-4)


def test_a_zone_with_too_few_hours_is_left_out_even_if_it_earned():
    share, n, note = compare.pooled_share(FIVE + res("NO2", 50.0, 60.0), {**HOURS, "NO2": 4})
    base, _, _ = compare.pooled_share(FIVE, HOURS)
    assert share == base and n == 5 * 24 and "NO2" in note


def test_no_scored_zone_gives_a_reason_not_a_number():
    flat, n, note = compare.pooled_share(res("NO2", -5.0, 0.0), {"NO2": 24})
    assert flat is None and n == 24 and "too flat" in note
    few, n, note = compare.pooled_share(res("GB", 50.0, 60.0, "GBP"), {"GB": 3})
    assert few is None and n == 3 and "Too few settled hours" in note
    assert compare.pooled_share([], {})[0] is None


def test_headline_pools_exactly_the_zones_that_summarise_gives_a_share():
    from engine.tests.test_scores_battery import settled

    good = [50.0] * 12 + [250.0] * 12
    flat = [200.0] * 24
    sell_high = [1.0] + [0.0] * 11 + [-0.9] + [0.0] * 11
    lose = [1.0] + [0.0] * 23
    good_s = settled(good, {"median_only": sell_high, "risk_aware": sell_high, "naive": sell_high, "perfect_foresight": sell_high})
    flat_s = settled(flat, {"median_only": lose, "risk_aware": lose, "naive": [0.0] * 24, "perfect_foresight": [0.0] * 24})
    rows = compare.summarise("FR", good_s) + compare.summarise("NO2", flat_s)
    share = {r["zone"]: r["share_of_perfect"] for r in rows if r["strategy"] == "risk_aware"}
    assert share["FR"] is not None and share["NO2"] is None
    pooled, n, note = compare.pooled_share(rows, {"FR": 24, "NO2": 24})
    only_fr, _, _ = compare.pooled_share([r for r in rows if r["zone"] == "FR"], {"FR": 24})
    assert pooled == only_fr and n == 24 and "Pooled over 1 zone and 24" in note
