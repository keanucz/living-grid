"""Write engine/contract/openapi.json from the live app: `uv run python -m engine.contract.export`."""

import json
from pathlib import Path

from engine.app import app

PATH = Path(__file__).resolve().parent / "openapi.json"


def render() -> str:
    return json.dumps(app.openapi(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    PATH.write_text(render())
    print(f"wrote {PATH}")
