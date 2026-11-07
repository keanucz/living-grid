"""Capture every GET the web uses, plus the four default /intervene results, into demo/snapshots/,
and serve them back as a stand-in API if the real one dies during the demo.

    python3 demo/capture_snapshots.py capture --base http://localhost:8000
    python3 demo/capture_snapshots.py capture --base https://htb.stefvuck.dev/api
    python3 demo/capture_snapshots.py serve --port 8000

Standard library only, so it runs on any laptop without uv.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "snapshots"
REGIONS_CSV = ROOT / "data" / "static" / "gb_region_keys.csv"
ZONES = ["GB", "FR", "DE-LU", "NL", "BE", "NO2"]
STORM = ("2026-10-26T00:00:00Z", "2026-10-27T00:00:00Z")
PAUSE_S = 0.3
TIME_PARAMS = {"/state": "at", "/unseen/carbon": "at", "/explain": "ts"}


def iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def hour_now() -> datetime:
    return datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)


def key(method: str, path: str, params: dict | None) -> str:
    qs = urllib.parse.urlencode(sorted((params or {}).items()))
    return f"{method} {path}{'?' + qs if qs else ''}"


def filename(k: str) -> str:
    slug = "".join(c if c.isalnum() else "_" for c in k.split("?")[0].lower()).strip("_")
    return f"{slug}_{hashlib.sha1(k.encode()).hexdigest()[:8]}.json"


def call(base: str, method: str, path: str, params: dict | None = None, body: dict | None = None, timeout: float = 60):
    # Gentle on a shared server: pause between calls and back off on gateway errors.
    for attempt in range(4):
        status, payload = call_once(base, method, path, params, body, timeout)
        if status not in (502, 503, 504):
            break
        time.sleep(5 * (attempt + 1))
    time.sleep(PAUSE_S)
    return status, payload


def call_once(base: str, method: str, path: str, params: dict | None, body: dict | None, timeout: float):
    url = base.rstrip("/") + path + ("?" + urllib.parse.urlencode(params) if params else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except ValueError:
            return e.code, {"detail": e.reason}
    except (urllib.error.URLError, TimeoutError) as e:
        return 504, {"detail": f"capture could not reach the API: {e}"}


def regions() -> list[str]:
    with REGIONS_CSV.open() as f:
        return [row["region"] for row in csv.DictReader(f)]


def requests_to_capture(anchor: datetime, state_hours: int, explain_hours: int):
    for path in ["/zones", "/scenarios", "/scores", "/reveal", "/unseen/ghost-wind"]:
        yield path, None
    yield "/unseen/ghost-wind", {"from": STORM[0], "to": STORM[1]}
    yield "/replay", {"event": "2026-10-26"}
    for r in regions():
        yield "/household", {"region": r}
    for h in range(-state_hours, state_hours + 1):
        at = iso(anchor + timedelta(hours=h))
        yield "/state", {"at": at}
        yield "/unseen/carbon", {"at": at}
    for z in ZONES:
        yield "/explain", {"zone": z}
    for h in range(-explain_hours, explain_hours + 1):
        for z in ZONES:
            yield "/explain", {"zone": z, "ts": iso(anchor + timedelta(hours=h))}


def capture(base: str, out: Path, state_hours: int, explain_hours: int) -> int:
    out.mkdir(parents=True, exist_ok=True)
    anchor = hour_now()
    manifest = {"captured_at": iso(datetime.now(timezone.utc)), "anchor": iso(anchor), "base": base, "entries": {}}
    failed = 0

    def save(k: str, status: int, payload) -> None:
        nonlocal failed
        print(f"{status} {k}", file=sys.stderr)
        if status >= 500:
            # Leave server errors out of the pack; serve then answers 404 and the web uses its fixtures.
            failed += 1
            return
        name = filename(k)
        (out / name).write_text(json.dumps(payload, separators=(",", ":")))
        manifest["entries"][k] = {"file": name, "status": status}

    scenarios = None
    for path, params in requests_to_capture(anchor, state_hours, explain_hours):
        status, payload = call(base, "GET", path, params)
        save(key("GET", path, params), status, payload)
        if path == "/scenarios" and status == 200:
            scenarios = payload

    for sc in (scenarios or {}).get("scenarios", []):
        body = (sc.get("result") or {}).get("request")
        if not body:
            continue
        status, payload = call(base, "POST", "/intervene", body=body)
        save(key("POST", "/intervene", {"type": body["type"]}), status, payload)

    used = {e["file"] for e in manifest["entries"].values()}
    for f in out.glob("*_????????.json"):
        if f.name not in used:
            f.unlink()
    (out / "index.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    print(f"{len(manifest['entries'])} snapshots in {out} ({failed} server errors)", file=sys.stderr)
    return 1 if failed or not scenarios else 0


class Pack:
    def __init__(self, out: Path):
        self.out = out
        self.manifest = json.loads((out / "index.json").read_text())
        self.anchor = parse_iso(self.manifest["anchor"])
        self.entries = self.manifest["entries"]

    def load(self, k: str):
        e = self.entries.get(k)
        if not e:
            return None
        return e["status"], json.loads((self.out / e["file"]).read_text())

    def rebase(self, path: str, params: dict) -> dict:
        # The web asks for the current hour; map "now + n hours" onto "capture anchor + n hours",
        # clamped to the captured range, so the scrubber still moves through the pack.
        p = TIME_PARAMS.get(path)
        if not p:
            return params
        captured = sorted(
            parse_iso(dict(urllib.parse.parse_qsl(k.split("?", 1)[1]))[p])
            for k in self.entries
            if k.startswith(f"GET {path}?") and (path != "/explain" or f"zone={params.get('zone')}" in k)
        )
        if not captured:
            return params
        want = parse_iso(params[p]) if params.get(p) else hour_now()
        target = self.anchor + (want.replace(minute=0, second=0, microsecond=0) - hour_now())
        target = min(max(target, captured[0]), captured[-1])
        return {**params, p: iso(target)}

    def answer(self, method: str, path: str, params: dict, body: dict | None):
        if method == "POST" and path == "/intervene":
            return self.load(key("POST", path, {"type": (body or {}).get("type", "")}))
        return self.load(key(method, path, params)) or self.load(key(method, path, self.rebase(path, params)))


def serve(out: Path, port: int) -> None:
    pack = Pack(out)

    class Handler(BaseHTTPRequestHandler):
        def respond(self, method: str):
            u = urllib.parse.urlsplit(self.path)
            path = u.path[4:] if u.path.startswith("/api/") else u.path
            params = dict(urllib.parse.parse_qsl(u.query))
            body = None
            if method == "POST":
                n = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
            if path == "/health":
                hit = (200, {"status": "ok", "source": "snapshot", "captured_at": pack.manifest["captured_at"]})
            else:
                hit = pack.answer(method, path, params, body)
            status, payload = hit or (404, {"detail": f"not in snapshot pack: {method} {path}"})
            raw = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("access-control-allow-origin", "*")
            self.send_header("x-lg-source", "snapshot")
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            self.respond("GET")

        def do_POST(self):
            self.respond("POST")

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("access-control-allow-origin", "*")
            self.send_header("access-control-allow-headers", "content-type")
            self.end_headers()

    print(f"Serving {len(pack.entries)} snapshots from {out} (captured {pack.manifest['captured_at']}) on :{port}", file=sys.stderr)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


def main() -> int:
    global PAUSE_S
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture", help="snapshot a running API")
    c.add_argument("--base", default="http://localhost:8000")
    c.add_argument("--out", type=Path, default=OUT)
    c.add_argument("--state-hours", type=int, default=24, help="capture /state and /unseen/carbon for now ± this many hours")
    c.add_argument("--pause", type=float, default=PAUSE_S, help="seconds between calls")
    c.add_argument("--explain-hours", type=int, default=6, help="capture /explain for every zone at now ± this many hours")
    s = sub.add_parser("serve", help="serve the pack as a stand-in API")
    s.add_argument("--out", type=Path, default=OUT)
    s.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    if a.cmd == "capture":
        PAUSE_S = a.pause
        return capture(a.base, a.out, a.state_hours, a.explain_hours)
    serve(a.out, a.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
