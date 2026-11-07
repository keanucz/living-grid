"""Room game loop: settle decisions and refresh the agent's plan in SpacetimeDB.

    uv run python -m engine.game [--once] [--every 120]

Needs LG_STDB_URL / LG_STDB_TOKEN(_FILE) (an admin identity); with LG_OFFLINE=1 or no token it only reports.
"""

import argparse
import logging
import time

import pandas as pd

from engine.game import agent, settle
from engine.publisher.client import Client, from_env

log = logging.getLogger("engine.game")
BATCH = 1000


def run_once(client: Client | None, now: pd.Timestamp | None = None) -> dict[str, int]:
    now = pd.Timestamp.now(tz="UTC") if now is None else now
    rows = client.sql("SELECT key, action, settled FROM player_decision") if client else []
    decisions = settle.decisions_frame(rows)
    final, provisional = settle.gb_prices()
    settled = settle.settle(decisions, final, provisional, now)
    payload = settle.settlement_rows(settled)
    forecast = agent.latest_forecast(now)
    soc0 = agent.current_soc(decisions, forecast["ts"].min() if len(forecast) else now)
    moves = agent.plan(forecast, soc0, now)
    if client:
        for i in range(0, len(payload), BATCH):
            client.call("settle_decisions", payload[i : i + BATCH])
        client.call("set_agent", agent.AGENT_NAME, "GB", moves)
    out = {"decisions": len(decisions), "settled": len(payload), "final": int(settled["final"].sum()) if len(settled) else 0,
           "agent_moves": len(moves)}
    log.info("game: %s", out)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--every", type=float, default=120.0, help="seconds between rounds")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    client = from_env()
    while True:
        try:
            run_once(client)
        except Exception:
            log.exception("game round failed")
        if args.once:
            return
        time.sleep(args.every)


if __name__ == "__main__":
    main()
