"""web/src/views/replay/labels.js: the 26 October replay's series chips name the zone and price in plain words,
never a zone code (DE-LU, NO2) or 'GB GB system price' (#313)."""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
MOD = ROOT / "web" / "src" / "views" / "replay" / "labels.js"
SERIES = [("GB", "gb_system_price"), ("GB", "price_da"), ("FR", "price_da"), ("DE-LU", "price_da"),
          ("NL", "price_da"), ("BE", "price_da"), ("NO2", "price_da")]


def labels(series):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    arg = json.dumps([{"zone": z, "target": t} for z, t in series])
    src = f"import {{ seriesLabel }} from {json.dumps(MOD.as_uri())};\nconsole.log(JSON.stringify({arg}.map(seriesLabel)))"
    out = subprocess.run([node, "--input-type=module", "-e", src], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_storm_series_read_as_plain_names():
    assert labels(SERIES) == ["Britain system price", "Britain day-ahead price", "France", "Germany",
                              "Netherlands", "Belgium", "Southern Norway"]


def test_no_codes_and_no_duplicates():
    got = labels(SERIES)
    assert len(set(got)) == len(got)
    assert not any(re.search(r"\bGB\b|DE-LU|NO2|P10|P50|P90", x) for x in got)


def test_unknown_zone_or_target_still_gets_a_label():
    assert labels([("PL", "price_da"), ("FR", "load")]) == ["PL", "France load"]
