"""web/src/ui/countUp.js: the shared count-up easing never leaves the range between where it starts and its target,
even when the first animation frame's timestamp is earlier than the start (the cause of negative figures, #268)."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
MOD = ROOT / "web" / "src" / "ui" / "countUp.js"


def run(js: str):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    src = f"import {{ countUpValue }} from {json.dumps(MOD.as_uri())};\n{js}"
    out = subprocess.run([node, "--input-type=module", "-e", src], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_early_first_frame_stays_at_the_start_not_below_it():
    got = run("console.log(JSON.stringify([countUpValue(0, 24.4, -16, 1400), countUpValue(0, 5964000, -16, 1800), countUpValue(10, 50, -40, 900)]))")
    assert got == [0, 5964000 * 0, 10]


def test_eases_monotonically_to_the_target_and_holds_it():
    got = run("console.log(JSON.stringify([0, 100, 350, 700, 1400, 5000].map((e) => countUpValue(0, 143e6, e, 1400))))")
    assert got[0] == 0 and got[-2] == got[-1] == 143e6
    assert all(a <= b for a, b in zip(got, got[1:]))
    assert all(0 <= v <= 143e6 for v in got)


def test_counting_down_from_a_previous_value_never_overshoots():
    got = run("console.log(JSON.stringify([-30, 0, 450, 900, 2000].map((e) => countUpValue(120, 80, e, 900))))")
    assert got[0] == got[1] == 120 and got[-1] == 80
    assert all(80 <= v <= 120 for v in got)
