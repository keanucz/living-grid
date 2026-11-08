from datetime import date

from engine.replay_days import list_days


def test_list_days_keeps_day_files_and_skips_league_and_other_json(tmp_path):
    for name in ["2026-10-31.json", "2026-10-26.json", "2026-10-31.bots.json", "2026-10-31.json.tmp", "index.json", "2026-1-5.json"]:
        (tmp_path / name).write_text("{}")
    assert list_days(tmp_path) == [date(2026, 10, 26), date(2026, 10, 31)]


def test_list_days_of_a_missing_folder_is_empty(tmp_path):
    assert list_days(tmp_path / "nope") == []
