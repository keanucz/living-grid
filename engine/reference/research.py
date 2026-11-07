"""Research desk: answer engine/reference/questions.json with the Parallel Task API, then
re-check every answer against its cited sources with the Parallel Extract API.

    PARALLEL_API_KEY=... python -m engine.reference.research [--only id1,id2] [--processor core]

Writes engine/reference/facts/<topic>.json. A fact is `verified` only when a number from its
answer appears in a source page fetched independently of the research run. Code must not use
unverified facts without a human checking them first.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.parallel.ai"
HERE = Path(__file__).resolve().parent
FACTS = HERE / "facts"
POLL_SECONDS = 15
GROUP_TIMEOUT_SECONDS = 45 * 60
MAX_SOURCES_CHECKED = 3

OUTPUT_SCHEMA = {
    "type": "json",
    "json_schema": {
        "type": "object",
        "properties": {
            "value": {"type": "string", "description": "The answer as stated in the best source, quoting the exact figure(s) as written there."},
            "unit": {"type": "string", "description": "Unit of the figure(s), e.g. MW, tCO2/MWh, %, GBP, or 'n/a'."},
            "as_of": {"type": "string", "description": "Date or period the figure applies to, as stated in the source."},
            "caveat": {"type": "string", "description": "Qualifications, conflicting figures from other sources, or 'none'."},
        },
        "required": ["value", "unit", "as_of", "caveat"],
        "additionalProperties": False,
    },
}


def api_key() -> str:
    key = os.environ.get("PARALLEL_API_KEY", "")
    if not key:
        sys.exit("PARALLEL_API_KEY is not set; run coord/setup.sh <name> first")
    return key


def call(method: str, path: str, body: dict | None = None, retries: int = 5) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(retries):
        req = urllib.request.Request(
            API + path, data=data, method=method,
            headers={"x-api-key": api_key(), "Content-Type": "application/json", "User-Agent": "living-grid-research/1"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")[:300]
            if err.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(int(err.headers.get("Retry-After") or 2 ** attempt * 3))
                continue
            raise RuntimeError(f"{method} {path} -> HTTP {err.code}: {detail}") from err
        except urllib.error.URLError as err:
            if attempt < retries - 1:
                time.sleep(2 ** attempt * 3)
                continue
            raise RuntimeError(f"{method} {path} -> {err}") from err
    raise RuntimeError(f"{method} {path} failed after {retries} attempts")


def numbers(text: str) -> list[str]:
    """Figures in a string, normalised: '1,400 MW' -> ['1400'], '0.37 t' -> ['0.37']."""
    cleaned = re.sub(r"(?<=\d)[,   ](?=\d{3}\b)", "", text)
    found = re.findall(r"\d+(?:\.\d+)?", cleaned)
    return [n for n in found if len(n.replace(".", "")) >= 2 or "." in n]


def normalise(text: str) -> str:
    return re.sub(r"(?<=\d)[,   ](?=\d{3}\b)", "", text)


def run_group(questions: list[dict]) -> dict[str, str]:
    group = call("POST", "/v1/tasks/groups", {})
    gid = group["taskgroup_id"]
    inputs = [{"input": q["question"], "processor": q["processor"], "metadata": {"fact_id": q["id"]}} for q in questions]
    added = call("POST", f"/v1/tasks/groups/{gid}/runs", {"default_task_spec": {"output_schema": OUTPUT_SCHEMA}, "inputs": inputs})
    run_ids = added["run_ids"]
    if len(run_ids) != len(questions):
        raise RuntimeError(f"asked for {len(questions)} runs, got {len(run_ids)}")
    print(f"task group {gid}: {len(run_ids)} runs submitted", flush=True)
    deadline = time.time() + GROUP_TIMEOUT_SECONDS
    while time.time() < deadline:
        status = call("GET", f"/v1/tasks/groups/{gid}")["status"]
        print(f"  {status.get('task_run_status_counts')}", flush=True)
        if not status.get("is_active"):
            break
        time.sleep(POLL_SECONDS)
    else:
        print("group still active at timeout; collecting what has finished", flush=True)
    return {q["id"]: rid for q, rid in zip(questions, run_ids)}


def result(run_id: str) -> dict | None:
    try:
        return call("GET", f"/v1/tasks/runs/{run_id}/result")
    except RuntimeError as err:
        print(f"  no result for {run_id}: {err}", flush=True)
        return None


def sources_from(res: dict) -> tuple[list[dict], str | None]:
    sources, confidence = [], None
    for basis in res.get("output", {}).get("basis", []) or []:
        if basis.get("field") == "value":
            confidence = basis.get("confidence")
        for cit in basis.get("citations", []) or []:
            url = cit.get("url")
            if url and all(s["url"] != url for s in sources):
                sources.append({"url": url, "quote": " … ".join(cit.get("excerpts") or [])[:600]})
    return sources, confidence


def recheck(question: str, figures: list[str], sources: list[dict]) -> tuple[bool, str]:
    if not figures:
        return False, "no numeric figure in the answer to check; needs a human"
    primary = figures[0]
    for src in sources[:MAX_SOURCES_CHECKED]:
        try:
            got = call("POST", "/v1/extract", {"urls": [src["url"]], "objective": question, "search_queries": figures[:3]})
        except RuntimeError as err:
            continue
        text = normalise(" ".join(" ".join(r.get("excerpts") or []) for r in got.get("results", [])))
        if primary in text:
            return True, f"'{primary}' found in an independent fetch of {src['url']}"
    return False, f"'{primary}' not found in independent fetches of the top {min(len(sources), MAX_SOURCES_CHECKED)} cited sources"


def build_fact(q: dict, run_id: str, res: dict | None) -> dict:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    base = {"id": q["id"], "question": q["question"], "used_by": q["used_by"], "processor": q["processor"], "run_id": run_id, "retrieved_at": now}
    if not res or res.get("run", {}).get("status") != "completed":
        return {**base, "verified": False, "verification": "research run did not complete"}
    content = res["output"].get("content") or {}
    if isinstance(content, str):
        content = {"value": content, "unit": "", "as_of": "", "caveat": ""}
    sources, confidence = sources_from(res)
    ok, how = recheck(q["question"], numbers(content.get("value", "")), sources)
    return {**base, **{k: content.get(k, "") for k in ("value", "unit", "as_of", "caveat")},
            "confidence": confidence, "sources": sources, "verified": ok, "verification": how}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated fact ids")
    ap.add_argument("--processor", help="override every question's processor")
    args = ap.parse_args()
    questions = json.loads((HERE / "questions.json").read_text())
    if args.only:
        wanted = set(args.only.split(","))
        questions = [q for q in questions if q["id"] in wanted]
    if args.processor:
        questions = [{**q, "processor": args.processor} for q in questions]
    if not questions:
        sys.exit("no questions selected")
    run_ids = run_group(questions)
    with ThreadPoolExecutor(max_workers=8) as pool:
        facts = list(pool.map(lambda q: build_fact(q, run_ids[q["id"]], result(run_ids[q["id"]])), questions))
    FACTS.mkdir(exist_ok=True)
    by_topic: dict[str, list[dict]] = {}
    for q, fact in zip(questions, facts):
        by_topic.setdefault(q["topic"], []).append(fact)
    for topic, items in by_topic.items():
        path = FACTS / f"{topic}.json"
        existing = {f["id"]: f for f in json.loads(path.read_text())} if path.exists() else {}
        existing.update({f["id"]: f for f in items})
        path.write_text(json.dumps(sorted(existing.values(), key=lambda f: f["id"]), indent=2, ensure_ascii=False) + "\n")
    good = sum(f["verified"] for f in facts)
    print(f"\n{good}/{len(facts)} facts verified")
    for f in facts:
        mark = "OK " if f["verified"] else "-- "
        print(f"{mark}{f['id']}: {str(f.get('value', ''))[:90]} [{f.get('confidence')}]")


if __name__ == "__main__":
    main()
