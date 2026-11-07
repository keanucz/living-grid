"""Pre-computed demo scenarios: `uv run python -m engine.scenarios` runs each default event and caches it.

The route serves data/scenarios/<key>.json, falling back to the contract fixture for any scenario
not built yet (e.g. events whose module has not landed), so the demo always has an instant result.
"""

import json
import logging

from engine.interventions import registry
from engine.routes._fixtures import fixture
from engine.schemas import InterventionRequest, InterventionResult, Scenario
from pipeline import cache

log = logging.getLogger(__name__)

SCENARIOS = [
    {
        "key": "hormuz",
        "title": "Strait of Hormuz closes",
        "blurb": "LNG supply shock lifts gas prices; where gas sets the price, power follows.",
        "request": {"type": "hormuz", "magnitude": 40.0, "hours": 24 * 14},
    },
    {
        "key": "norway_link",
        "title": "Norway to GB link trips",
        "blurb": "North Sea Link goes offline; GB loses cheap Norwegian hydro.",
        "request": {"type": "interconnector_trip", "target": "nsl", "hours": 24},
    },
    {
        "key": "french_nuclear",
        "title": "French nuclear outage",
        "blurb": "Several reactors trip; France imports more and neighbours' prices rise.",
        "request": {"type": "nuclear_outage", "target": "FR", "magnitude": 6000.0, "hours": 72},
    },
    {
        "key": "scottish_storm",
        "title": "Storm over Scotland",
        "blurb": "Much more wind in Scotland; prices fall but more wind is paid to switch off.",
        "request": {"type": "scottish_storm", "target": "GB", "magnitude": 50.0, "hours": 24},
    },
]


def path(key: str):
    return cache.DATA / "scenarios" / f"{key}.json"


def build(keys: list[str] | None = None) -> list[str]:
    """Run every scenario whose event is implemented and cache it. Returns the keys written."""
    events = registry()
    written = []
    for s in SCENARIOS:
        if keys and s["key"] not in keys:
            continue
        req = InterventionRequest.model_validate(s["request"])
        run = events.get(req.type)
        if run is None:
            log.info("scenario %s: no %s event yet, fixture stays in use", s["key"], req.type)
            continue
        result = InterventionResult.model_validate(run(req))
        scenario = Scenario(key=s["key"], title=s["title"], blurb=s["blurb"], result=result)
        p = path(s["key"])
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(scenario.model_dump_json(indent=1) + "\n")
        tmp.replace(p)
        written.append(s["key"])
    return written


def load() -> list[dict]:
    fallback = {s["key"]: s for s in fixture("scenarios")["scenarios"]}
    out = []
    for s in SCENARIOS:
        p = path(s["key"])
        if p.exists():
            out.append(json.loads(p.read_text()))
        elif s["key"] in fallback:
            out.append(fallback[s["key"]])
    return out


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    for key in build():
        print(f"wrote {path(key)}")
