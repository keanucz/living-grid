"""Debug view of the whole build: every section, view, layer, panel, endpoint and module, matched to the merged hub task that added it.

GET /debug/features is read-only. It reads the merged tasks from the hub database (LG_HUB_DB, default /srv/hack/hub.db,
opened read-only) and the repository's own folders, so the list is generated, not written by hand. A feature is
credited to the earliest merged task whose claimed paths cover it. Orphans are features nothing links to; paused
ones are features the current direction has switched off. Not part of the OpenAPI contract.
"""

import json
import os
import re
import sqlite3
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter, Request

from engine.routes import discover

router = APIRouter(tags=["debug"], include_in_schema=False)

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web" / "src"
INFRA = ("/health", "/debug/features")  # called by operators, not by the web app
# A claim on a whole tree says nothing about which task added a feature inside it.
BROAD = {"", "web", "web/src", "web/src/views", "web/src/panels", "web/src/layers", "web/src/shell", "engine", "engine/routes", "engine/tests", "pipeline",
         "pipeline/ingest", "pipeline/tests", "spacetime", "spacetime/module", "spacetime/module/src", "spacetime/module/src/reducers", "data", "demo", "docs", "scripts"}

# Switched off by the Beat the model direction (decided 23:45 Saturday). A feature credited to one of these tasks, or
# living under one of these paths, is flagged paused. Tasks still open are listed under paused_tasks.
PAUSED_TASKS = {
    167: "clue shop: its hint is now part of Beat the model",
    197: "reactions and flash windows: paused with market trading",
    198: "flash timer and reactions UI: paused with market trading",
}
PAUSED_PATHS = {
    "web/src/views/market/": "LMSR market trading: #/market redirects to #/play",
    "web/src/views/game/": "standalone room game: #/game redirects to #/play",
    "engine/market/": "LMSR market and Kelly bots: kept, off the player path",
    "spacetime/module/src/reducers/market.ts": "LMSR market reducers: kept, off the player path",
}


def hub_db() -> Path:
    return Path(os.environ.get("LG_HUB_DB", "/srv/hack/hub.db"))


def read_tasks() -> tuple[list[dict], bool]:
    """(merged tasks with merge time, whether the hub database could be read) and the open paused ones via paused_tasks()."""
    try:
        con = sqlite3.connect(f"file:{hub_db()}?mode=ro", uri=True, timeout=2)
        con.row_factory = sqlite3.Row
        merged_at = {r["task"]: r["ts"] for r in con.execute("select task, max(ts) as ts from events where kind='merged' group by task")}
        rows = con.execute("select id, title, agent, paths, status, updated from tasks").fetchall()
        con.close()
    except (sqlite3.Error, OSError):
        return [], False
    tasks = [{"id": r["id"], "title": r["title"], "agent": r["agent"], "status": r["status"], "paths": r["paths"].split(),
              "merged_at": merged_at.get(r["id"]) or r["updated"]} for r in rows]
    return tasks, True


def _norm(p: str) -> str:
    return p.strip().lstrip("./")


def covers(task_path: str, feature_path: str) -> bool:
    t, f = _norm(task_path).rstrip("/"), _norm(feature_path).rstrip("/")
    if t in BROAD and t != f:
        return False
    return f == t or f.startswith(t + "/") or t.startswith(f + "/")


def added_by(feature_paths: list[str], merged: list[dict]) -> tuple[dict | None, list[int]]:
    hits = [t for t in merged if any(covers(tp, fp) for tp in t["paths"] for fp in feature_paths)]
    hits.sort(key=lambda t: (t["merged_at"] or 0, t["id"]))
    return (hits[0] if hits else None), [t["id"] for t in hits]


def _task_view(t: dict | None) -> dict | None:
    if not t:
        return None
    return {"id": t["id"], "title": t["title"], "agent": t["agent"], "merged_at": t["merged_at"], "paths": t["paths"]}


_text_cache: dict = {"at": 0.0, "files": {}}


def web_files() -> dict[str, str]:
    """Every source file under web/src (cached for a minute): what the web app actually refers to."""
    if time.time() - _text_cache["at"] < 60 and _text_cache["files"]:
        return _text_cache["files"]
    out = {}
    for p in WEB.rglob("*"):
        if p.suffix in (".js", ".jsx") and p.is_file() and "fixtures" not in p.parts:
            try:
                out[p.relative_to(ROOT).as_posix()] = p.read_text(errors="ignore")
            except OSError:
                pass
    _text_cache.update(at=time.time(), files=out)
    return out


def referenced(tokens: list[str], outside: str = "") -> int:
    """How many web files outside `outside` (a path prefix) mention any of the tokens."""
    return sum(1 for f, txt in web_files().items() if not (outside and f.startswith(outside)) and any(t in txt for t in tokens))


def sections() -> list[dict]:
    src = (WEB / "shell" / "sections.js").read_text()
    out = []
    for m in re.finditer(r"\{ id: '([a-z]+)', label: '([^']+)'(.*?)(?=\n  \{ id:|\n\])", src, re.S):
        body = m.group(3)
        lists = {k: re.findall(r"'([^']+)'", v) for k, v in re.findall(r"\b(panels|more): \[([^\]]*)\]", body)}
        out.append({"id": m.group(1), "label": m.group(2), "panels": lists.get("panels", []), "more": lists.get("more", []),
                    "href": (re.search(r"href: '([^']+)'", body) or [None, None])[1], "pages": re.findall(r"href: '(#[^']+)'", body)})
    return out


def _git_first(needle: str, path: str) -> int | None:
    """Task number in the subject of the first commit that added `needle` to `path` (squash subjects end in "(#N)")."""
    try:
        r = subprocess.run(["git", "log", "--reverse", "--format=%s", f"-S{needle}", "--", path], cwd=ROOT, capture_output=True, text=True, timeout=8)
        m = re.search(r"\(#(\d+)\)\s*$", (r.stdout.splitlines() or [""])[0])
        return int(m.group(1)) if m else None
    except (OSError, subprocess.SubprocessError):
        return None


def _registry_id(index: Path, key: str, default: str) -> str:
    m = re.search(rf"export default \{{[^}}]*?\b{key}:\s*'([^']+)'", index.read_text(errors="ignore"), re.S)
    return m.group(1) if m else default


def _paused(paths: list[str], by: dict | None, touched: list[int]) -> str | None:
    for pp, why in PAUSED_PATHS.items():
        if any(covers(pp, p) or p.startswith(pp) for p in paths):
            return why
    ids = ([by["id"]] if by else []) + touched
    for i in ids:
        if i in PAUSED_TASKS:
            return f"#{i} {PAUSED_TASKS[i]}"
    return None


def mounted_routes(app) -> list:
    """The app's own routes plus every discovered router's routes (newer FastAPI hides included routes behind a wrapper)."""
    out = [r for r in app.routes if getattr(r, "path", None)]
    for router in discover():
        out += [r for r in router.routes if getattr(r, "path", None)]
    seen, uniq = set(), []
    for r in out:
        key = (r.path, tuple(sorted(getattr(r, "methods", None) or [])))
        if key not in seen:
            seen.add(key)
            uniq.append(r)
    return uniq


def build(app_routes, merged: list[dict]) -> list[dict]:
    secs = sections()
    sec_text = (WEB / "shell" / "sections.js").read_text()
    feats: list[dict] = []

    def add(kind, fid, label, paths, extra=None, orphan_reason=None, task=None, touched=None):
        by, touch = added_by(paths, merged) if task is None else (task, touched or [])
        feats.append({"kind": kind, "id": fid, "label": label, "paths": paths, "added_by": _task_view(by), "touched_by": touch,
                      "orphan": bool(orphan_reason), "orphan_reason": orphan_reason, "paused": _paused(paths, by, touch), **(extra or {})})

    by_id = {t["id"]: t for t in merged}
    for s in secs:
        n = _git_first(f"id: '{s['id']}'", "web/src/shell/sections.js")
        add("section", s["id"], s["label"], ["web/src/shell/sections.js"], {"panels": s["panels"], "more": s["more"]},
            task=by_id.get(n), touched=[n] if n else [])
    for d in sorted((WEB / "panels").iterdir()):
        idx = d / "index.jsx"
        if idx.exists():
            pid = _registry_id(idx, "id", d.name)
            own = f"web/src/panels/{d.name}/"
            listed = f"'{pid}'" in sec_text or referenced([f"panels/{d.name}"], outside=own)
            add("panel", pid, d.name, [own], {"folder": d.name},
                None if listed else "no section lists this panel and no other file imports it")
    for d in sorted((WEB / "layers").iterdir()):
        idx = d / "index.js"
        if idx.exists() and not d.name.startswith("_"):
            add("layer", _registry_id(idx, "id", d.name), d.name, [f"web/src/layers/{d.name}/"], {"folder": d.name})
    for d in sorted((WEB / "views").iterdir()):
        idx = d / "index.jsx"
        if idx.exists():
            m = re.search(r"path:\s*'([^']+)'", idx.read_text(errors="ignore"))
            path = m.group(1) if m else f"/{d.name}"
            own = f"web/src/views/{d.name}/"
            linked = referenced([f"#{path}", f"'{path}'", f"\"{path}\""], outside=own)
            add("view", path, d.name, [own], {"folder": d.name, "links": linked},
                None if linked else "nothing outside the view itself links to this route")
    used = "\n".join(web_files().values())
    for r in app_routes:
        methods = sorted(m for m in (getattr(r, "methods", None) or []) if m not in ("HEAD", "OPTIONS"))
        path = getattr(r, "path", "")
        if not methods or path.startswith(("/docs", "/redoc", "/openapi")):
            continue
        mod = getattr(getattr(r, "endpoint", None), "__module__", "") or ""
        file = mod.replace(".", "/") + ".py" if mod.startswith("engine.") else "engine/app.py"
        root = "/" + path.strip("/").split("/")[0] if path != "/" else "/"
        in_web = f"'{root}" in used or f"`{root}" in used or f'"{root}' in used or f"/api{root}" in used
        add("endpoint", f"{methods[0]} {path}", path, [file], {"in_web": in_web}, None if in_web or path in INFRA else "no web file calls this endpoint")
    for kind, base, pattern in (("engine", ROOT / "engine", "*/__init__.py"), ("ingest", ROOT / "pipeline" / "ingest", "*.py"),
                                 ("module", ROOT / "spacetime" / "module" / "src" / "reducers", "*.ts")):
        if not base.exists():
            continue
        for p in sorted(base.glob(pattern)):
            if p.name == "__init__.py" and p.parent.name in ("routes", "tests", "contract", "__pycache__"):
                continue
            rel = p.parent if p.name == "__init__.py" else p
            if rel.name.startswith("_"):
                continue
            path = rel.relative_to(ROOT).as_posix() + ("/" if rel.is_dir() else "")
            add(kind, rel.name, rel.name, [path])
    return feats


@router.get("/debug/features")
def features(request: Request) -> dict:
    tasks, ok = read_tasks()
    merged = [t for t in tasks if t["status"] == "merged"]
    feats = build(mounted_routes(request.app), merged)
    unknown = [f["id"] for f in feats if f["added_by"] is None]
    return {
        "generated_at": time.time(),
        "hub_db": {"path": str(hub_db()), "readable": ok, "merged_tasks": len(merged)},
        "features": feats,
        "orphans": [f"{f['kind']}:{f['id']}" for f in feats if f["orphan"]],
        "paused": [f"{f['kind']}:{f['id']}" for f in feats if f["paused"]],
        "no_task": [f"{f['kind']}:{i}" for f, i in ((f, f["id"]) for f in feats if f["added_by"] is None)],
        "paused_tasks": [{"id": t["id"], "title": t["title"], "status": t["status"], "why": PAUSED_TASKS[t["id"]]} for t in tasks if t["id"] in PAUSED_TASKS],
        "unmatched": len(unknown),
    }
