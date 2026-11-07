"""Research desk: answer engine/reference/questions.json with the Parallel Task API and verify
every answer before code may use it.

    python -m engine.reference.research [--only id1,id2] [--processor pro]   # research + verify
    python -m engine.reference.research --reverify [--only ...]              # verify existing facts

A fact is `verified` only when both hold:
  1. Cross-check: a second, independent Parallel Task run (told the claim but asked to find its
     own sources) agrees with the answer.
  2. Figures: every figure in the answer appears in an independent Extract fetch of the cited
     sources (answers with no figures rely on the cross-check alone and say so).
Human decisions in manual.json override both and survive re-runs. Needs PARALLEL_API_KEY.
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
MANUAL = HERE / "manual.json"
POLL_SECONDS = 15
GROUP_TIMEOUT_SECONDS = 45 * 60
MAX_SOURCES_CHECKED = 4
MAX_FIGURES_CHECKED = 6
CROSSCHECK_PROCESSOR = "pro"

ANSWER_SCHEMA = {
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

CROSSCHECK_SCHEMA = {
    "type": "json",
    "json_schema": {
        "type": "object",
        "properties": {
            "independent_value": {"type": "string", "description": "Your own answer from your own sources, quoting exact figures."},
            "agrees": {"type": "boolean", "description": "True only if your sources support the claimed answer (same figures, allowing rounding)."},
            "disagreement": {"type": "string", "description": "What differs and why, or 'none'."},
        },
        "required": ["independent_value", "agrees", "disagreement"],
        "additionalProperties": False,
    },
}

THOUSANDS = re.compile(r"(?<=\d)[,   ](?=\d{3}(?!\d))")


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
            headers={"x-api-key": api_key(), "Content-Type": "application/json", "User-Agent": "living-grid-research/2"},
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


def normalise(text: str) -> str:
    return THOUSANDS.sub("", text)


def figures(text: str) -> list[str]:
    """Figures worth checking, normalised ('1,400 MW' -> '1400'). Single digits count only when
    the answer has nothing longer, so '2 requests per minute' is still checked."""
    found = list(dict.fromkeys(re.findall(r"\d+(?:\.\d+)?", normalise(text))))
    years = {n for n in found if re.fullmatch(r"(19[5-9]\d|20[0-4]\d)", n)}
    values = [n for n in found if n not in years] or found
    significant = [n for n in values if len(n.replace(".", "")) >= 2 or "." in n]
    return (significant or values)[:MAX_FIGURES_CHECKED]


def equivalents(fig: str) -> set[str]:
    """The figure as a source might write it: as given, scaled by 1000 (MW <-> GW, kg <-> t), or
    rounded to fewer decimals. Never produces a figure with fewer than two significant digits."""
    out = {fig}
    try:
        x = float(fig)
    except ValueError:
        return out
    for scaled in (x, x * 1000, x / 1000):
        for nd in range(0, 4):
            s = f"{round(scaled, nd):.{nd}f}"
            if len(s.replace(".", "").lstrip("0")) >= 2:
                out.add(s)
        if float(scaled).is_integer() and abs(scaled) >= 10:
            out.add(str(int(scaled)))
    return out


def present(fig: str, text: str) -> bool:
    if any(re.search(rf"(?<![\d.]){re.escape(c)}(?![\d])", text) for c in equivalents(fig)):
        return True
    try:
        small = float(fig) / 1000
    except ValueError:
        return False
    if small.is_integer() and 0 < small < 10:
        unit = r"\s?(?:GW|GWh|TW|TWh|bn|billion|kt|Mt|t)\b"
        return re.search(rf"(?<![\d.]){int(small)}{unit}", text) is not None
    return False


def figure_check(question: str, figs: list[str], urls: list[str]) -> tuple[list[str], list[str]]:
    """Fetch the cited pages independently; return (found, missing) figures."""
    if not figs or not urls:
        return [], figs
    try:
        got = call("POST", "/v1/extract", {"urls": urls[:MAX_SOURCES_CHECKED], "objective": question, "search_queries": figs[:3]})
    except RuntimeError:
        return [], figs
    text = normalise(" ".join(" ".join(r.get("excerpts") or []) for r in got.get("results", [])))
    found = [f for f in figs if present(f, text)]
    return found, [f for f in figs if f not in found]


def run_group(inputs: list[dict], schema: dict, label: str) -> list[str]:
    gid = call("POST", "/v1/tasks/groups", {})["taskgroup_id"]
    run_ids = call("POST", f"/v1/tasks/groups/{gid}/runs", {"default_task_spec": {"output_schema": schema}, "inputs": inputs})["run_ids"]
    if len(run_ids) != len(inputs):
        raise RuntimeError(f"{label}: asked for {len(inputs)} runs, got {len(run_ids)}")
    print(f"{label}: task group {gid}, {len(run_ids)} runs", flush=True)
    deadline = time.time() + GROUP_TIMEOUT_SECONDS
    while time.time() < deadline:
        status = call("GET", f"/v1/tasks/groups/{gid}")["status"]
        print(f"  {label} {status.get('task_run_status_counts')}", flush=True)
        if not status.get("is_active"):
            break
        time.sleep(POLL_SECONDS)
    return run_ids


def result(run_id: str) -> dict | None:
    try:
        res = call("GET", f"/v1/tasks/runs/{run_id}/result")
    except RuntimeError as err:
        print(f"  no result for {run_id}: {err}", flush=True)
        return None
    return res if res.get("run", {}).get("status") == "completed" else None


def sources_from(res: dict, field: str) -> tuple[list[dict], str | None]:
    sources, confidence = [], None
    for basis in res.get("output", {}).get("basis", []) or []:
        if basis.get("field") == field:
            confidence = basis.get("confidence")
        for cit in basis.get("citations", []) or []:
            url = cit.get("url")
            if url and all(s["url"] != url for s in sources):
                sources.append({"url": url, "quote": " … ".join(cit.get("excerpts") or [])[:600]})
    return sources, confidence


def research(questions: list[dict]) -> dict[str, dict]:
    inputs = [{"input": q["question"], "processor": q["processor"]} for q in questions]
    run_ids = run_group(inputs, ANSWER_SCHEMA, "research")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(result, run_ids))
    facts = {}
    for q, rid, res in zip(questions, run_ids, results):
        base = {"id": q["id"], "question": q["question"], "used_by": q["used_by"], "processor": q["processor"], "run_id": rid, "retrieved_at": now}
        if not res:
            facts[q["id"]] = {**base, "verified": False, "verification": "research run did not complete"}
            continue
        content = res["output"].get("content") or {}
        if isinstance(content, str):
            content = {"value": content, "unit": "", "as_of": "", "caveat": ""}
        sources, confidence = sources_from(res, "value")
        facts[q["id"]] = {**base, **{k: content.get(k, "") for k in ("value", "unit", "as_of", "caveat")}, "confidence": confidence, "sources": sources}
    return facts


def crosscheck(facts: list[dict]) -> list[dict | None]:
    inputs = [{
        "input": (f"Independently research and answer this question from your own sources: {f['question']}\n"
                  f"Another researcher claimed: \"{f.get('value', '')}\" (unit: {f.get('unit', '')}; as of: {f.get('as_of', '')}). "
                  "Do not assume the claim is right. Say whether your sources support it."),
        "processor": CROSSCHECK_PROCESSOR,
    } for f in facts]
    run_ids = run_group(inputs, CROSSCHECK_SCHEMA, "crosscheck")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(result, run_ids))
    out = []
    for rid, res in zip(run_ids, results):
        if not res:
            out.append(None)
            continue
        c = res["output"].get("content") or {}
        srcs, conf = sources_from(res, "independent_value")
        out.append({"run_id": rid, "independent_value": c.get("independent_value", ""), "agrees": bool(c.get("agrees")),
                    "disagreement": c.get("disagreement", ""), "confidence": conf, "sources": srcs[:5]})
    return out


def decide(fact: dict, cross: dict | None, found: list[str], missing: list[str], figs: list[str]) -> tuple[bool, str]:
    if "value" not in fact:
        return False, fact.get("verification", "no answer")
    if cross is None:
        return False, "cross-check run did not complete"
    if not cross["agrees"]:
        return False, f"cross-check disagrees: {cross['disagreement'][:300]}"
    if not figs:
        return True, "no figures to re-find; verified by an agreeing independent cross-check only"
    if missing:
        return False, f"cross-check agrees, but figures {missing} were not found in an independent fetch of the cited sources"
    return True, f"independent cross-check agrees and all figures {found} were re-found in an independent fetch"


def verify(fact: dict, cross: dict | None) -> dict:
    figs = figures(fact.get("value", ""))
    urls = [s["url"] for s in fact.get("sources", [])] + [s["url"] for s in (cross or {}).get("sources", [])]
    found, missing = figure_check(fact["question"], figs, list(dict.fromkeys(urls))) if "value" in fact else ([], figs)
    ok, how = decide(fact, cross, found, missing, figs)
    return {**fact, "crosscheck": cross, "figures_found": found, "figures_missing": missing, "verified": ok, "verification": how}


def apply_manual(fact: dict, manual: dict) -> dict:
    override = manual.get(fact["id"])
    return {**fact, **override, "manual_override": True} if override else fact


def load_existing() -> dict[str, dict]:
    return {f["id"]: f for p in sorted(FACTS.glob("*.json")) for f in json.loads(p.read_text())}


def save(facts: list[dict], topics: dict[str, str]) -> None:
    FACTS.mkdir(exist_ok=True)
    by_topic: dict[str, dict[str, dict]] = {}
    for p in sorted(FACTS.glob("*.json")):
        by_topic[p.stem] = {f["id"]: f for f in json.loads(p.read_text())}
    for f in facts:
        by_topic.setdefault(topics[f["id"]], {})[f["id"]] = f
    for topic, items in by_topic.items():
        (FACTS / f"{topic}.json").write_text(json.dumps(sorted(items.values(), key=lambda f: f["id"]), indent=2, ensure_ascii=False) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated fact ids")
    ap.add_argument("--processor", help="override every question's research processor")
    ap.add_argument("--reverify", action="store_true", help="skip research; cross-check and re-verify existing facts")
    ap.add_argument("--refigure", action="store_true", help="keep stored cross-checks; redo only the figure check")
    args = ap.parse_args()
    questions = json.loads((HERE / "questions.json").read_text())
    if args.only:
        wanted = set(args.only.split(","))
        questions = [q for q in questions if q["id"] in wanted]
    if args.processor:
        questions = [{**q, "processor": args.processor} for q in questions]
    if not questions:
        sys.exit("no questions selected")
    if args.reverify or args.refigure:
        existing = load_existing()
        facts = [existing[q["id"]] for q in questions if q["id"] in existing]
    else:
        found = research(questions)
        facts = [found[q["id"]] for q in questions]
    crosses = [f.get("crosscheck") for f in facts] if args.refigure else crosscheck(facts)
    with ThreadPoolExecutor(max_workers=8) as pool:
        checked = list(pool.map(lambda pair: verify(*pair), zip(facts, crosses)))
    manual = json.loads(MANUAL.read_text()) if MANUAL.exists() else {}
    final = [apply_manual(f, manual) for f in checked]
    save(final, {q["id"]: q["topic"] for q in json.loads((HERE / "questions.json").read_text())})
    print(f"\n{sum(f['verified'] for f in final)}/{len(final)} verified")
    for f in final:
        print(f"{'OK ' if f['verified'] else '-- '}{f['id']}: {str(f.get('value', ''))[:80]} | {f['verification'][:110]}")


if __name__ == "__main__":
    main()
