import json
from functools import cache
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent.parent / "contract" / "fixtures"


@cache
def _load(name: str) -> str:
    return (FIXTURES / f"{name}.json").read_text()


def fixture(name: str) -> dict:
    return json.loads(_load(name))
