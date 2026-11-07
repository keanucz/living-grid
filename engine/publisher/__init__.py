"""Publish parquet contracts and engine results into SpacetimeDB.

Every publish_* function takes a Client (or None, which is a logged no-op) and a DataFrame in the
contract shape, maps it to the reducer rows in spacetime/README.md and sends it in batches.
A Publisher remembers what it has already sent, so the loop only resends changed rows.
"""

import json
import logging
from collections.abc import Callable

import pandas as pd

from engine.publisher import rows as R
from engine.publisher.client import Client, ReducerError, from_env

log = logging.getLogger("engine.publisher")

BATCH = 2000

__all__ = [
    "Client", "ReducerError", "from_env", "Publisher",
    "publish_zones", "publish_actuals", "publish_forecasts", "publish_scores", "publish_carbon",
    "publish_ghost_wind", "publish_batteries", "publish_battery_actions", "publish_intervention", "prune_before",
]


def _send(client: Client | None, reducer: str, rows: list[dict]) -> int:
    if client is None:
        log.info("offline: would send %d rows to %s", len(rows), reducer)
        return 0
    for i in range(0, len(rows), BATCH):
        client.call(reducer, rows[i : i + BATCH])
    return len(rows)


def _publisher(reducer: str, mapper: Callable[[pd.DataFrame], list[dict]]):
    def publish(client: Client | None, df: pd.DataFrame) -> int:
        return _send(client, reducer, mapper(df))

    publish.__name__ = f"publish_{reducer.removeprefix('upsert_')}"
    publish.__doc__ = f"Map df with rows.{mapper.__name__} and call {reducer}. Returns rows sent."
    return publish


publish_zones = _publisher("upsert_zones", R.zones)
publish_actuals = _publisher("upsert_actuals", R.actuals)
publish_forecasts = _publisher("upsert_forecasts", R.forecasts)
publish_scores = _publisher("upsert_scores", R.scores)
publish_carbon = _publisher("upsert_carbon", R.carbon)
publish_ghost_wind = _publisher("upsert_ghost_wind", R.ghost_wind)
publish_batteries = _publisher("upsert_batteries", R.batteries)
publish_battery_actions = _publisher("upsert_battery_actions", R.battery_actions)


def publish_intervention(client: Client | None, result: dict, slot: str = "main", triggered_by: str = "engine") -> None:
    """Make an InterventionResult (dict) the latest event on every screen."""
    args = R.intervention_args(result, slot, triggered_by)
    if client is None:
        log.info("offline: would set intervention %s on slot %s", args[1], slot)
        return
    client.call("set_intervention", *args)


def prune_before(client: Client | None, before: pd.Timestamp) -> None:
    if client is None:
        return
    client.call("prune_before", int(R.micros(pd.Series([before])).iloc[0]))


class Publisher:
    """Sends only rows it has not sent before (by exact row content)."""

    REDUCERS = {
        "zones": ("upsert_zones", R.zones),
        "actuals": ("upsert_actuals", R.actuals),
        "forecasts": ("upsert_forecasts", R.forecasts),
        "scores": ("upsert_scores", R.scores),
        "carbon": ("upsert_carbon", R.carbon),
        "ghost_wind": ("upsert_ghost_wind", R.ghost_wind),
        "batteries": ("upsert_batteries", R.batteries),
        "battery_actions": ("upsert_battery_actions", R.battery_actions),
    }

    def __init__(self, client: Client | None):
        self.client = client
        self.sent: dict[str, set[str]] = {k: set() for k in self.REDUCERS}

    def publish(self, kind: str, df: pd.DataFrame) -> int:
        reducer, mapper = self.REDUCERS[kind]
        fresh, keys = [], []
        for row in mapper(df):
            k = json.dumps(row, sort_keys=True)
            if k not in self.sent[kind]:
                fresh.append(row)
                keys.append(k)
        if not fresh:
            return 0
        n = _send(self.client, reducer, fresh)
        if self.client is not None:
            self.sent[kind].update(keys)
        return n
