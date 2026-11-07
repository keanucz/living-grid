"""Minimal SpacetimeDB HTTP client: one identity token, reducer calls with positional JSON args."""

import logging
import os

import httpx

log = logging.getLogger("engine.publisher")

DEFAULT_DB = "living-grid"


class ReducerError(RuntimeError):
    pass


class Client:
    def __init__(self, url: str, db: str = DEFAULT_DB, token: str | None = None,
                 transport: httpx.BaseTransport | None = None, timeout: float = 10.0):
        self.url = url.rstrip("/")
        self.db = db
        self.token = token
        self.http = httpx.Client(base_url=self.url, transport=transport, timeout=timeout)

    def _token(self) -> str:
        if not self.token:
            r = self.http.post("/v1/identity")
            r.raise_for_status()
            self.token = r.json()["token"]
        return self.token

    def call(self, reducer: str, *args) -> None:
        r = self.http.post(
            f"/v1/database/{self.db}/call/{reducer}",
            json=list(args),
            headers={"Authorization": f"Bearer {self._token()}"},
        )
        if r.status_code != 200:
            raise ReducerError(f"{reducer}: HTTP {r.status_code}: {r.text[:500]}")

    def close(self) -> None:
        self.http.close()


def from_env() -> Client | None:
    """A client configured from LG_STDB_URL / LG_STDB_DB / LG_STDB_TOKEN, or None when offline or unset."""
    from pipeline.cache import offline

    url = os.environ.get("LG_STDB_URL", "")
    if offline() or not url:
        log.info("publisher disabled (%s)", "LG_OFFLINE set" if offline() else "LG_STDB_URL not set")
        return None
    return Client(url, os.environ.get("LG_STDB_DB", DEFAULT_DB), os.environ.get("LG_STDB_TOKEN") or None)
