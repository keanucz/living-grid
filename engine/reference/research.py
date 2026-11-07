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
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
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


DECIMAL_COMMA = re.compile(r"(?<=\d),(?=\d{1,2}(?!\d))")


def normalise(text: str) -> str:
    """Drop thousands separators ('1,400' -> '1400') and read European decimal commas
    ('58,5' -> '58.5'); a comma followed by exactly three digits is a thousands separator."""
    return DECIMAL_COMMA.sub(".", THOUSANDS.sub("", text))


MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}
MONTH_RE = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
DATE_PATTERNS = [
    (re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"), lambda m: (int(m[3]), int(m[2]), int(m[1]))),
    (re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+{MONTH_RE}\.?(?:\s+(\d{{4}}))?\b", re.I), lambda m: (int(m[1]), month(m[2]), m[3] and int(m[3]))),
    (re.compile(rf"\b{MONTH_RE}\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(\d{{4}}))?\b", re.I), lambda m: (int(m[2]), month(m[1]), m[3] and int(m[3]))),
]


def month(name: str) -> int:
    return next(v for k, v in MONTHS.items() if k.startswith(name.lower()[:3]))


def dates(text: str) -> tuple[list[str], str]:
    """Dates in the text as tokens 'date:YYYY-MM-DD' (or 'date:--MM-DD' when no year), plus the
    text with those dates removed so their parts are not checked again as loose numbers."""
    tokens, rest = [], text
    for pattern, parse in DATE_PATTERNS:
        for m in list(pattern.finditer(rest)):
            day, mon, year = parse(m)
            if 1 <= day <= 31 and 1 <= mon <= 12:
                tokens.append(f"date:{year:04d}-{mon:02d}-{day:02d}" if year else f"date:--{mon:02d}-{day:02d}")
        rest = pattern.sub(" ", rest)
    return list(dict.fromkeys(tokens)), rest


def figures(text: str) -> list[str]:
    """What to re-find in the sources: whole dates first, then numbers ('1,400 MW' -> '1400').
    Loose years are dropped only when the answer has another value; single digits count only
    when there is nothing longer, so '2 requests per minute' is still checked."""
    date_tokens, rest = dates(text)
    found = list(dict.fromkeys(re.findall(r"\d+(?:\.\d+)?", normalise(rest))))
    years = {n for n in found if re.fullmatch(r"(19[5-9]\d|20[0-4]\d)", n)}
    values = [n for n in found if n not in years]
    if not values and not date_tokens:
        values = found
    significant = [n for n in values if len(n.replace(".", "")) >= 2 or "." in n]
    return (date_tokens + (significant or values))[:MAX_FIGURES_CHECKED]


def sig_digits(fig: str) -> int:
    return len(fig.replace(".", "").lstrip("0").rstrip("0")) or 1


def equivalents(fig: str) -> set[str]:
    """The figure as a source might write it: as given, scaled by 1000 (MW <-> GW, kg <-> t), or
    rounded. A rounded form keeps at least min(3, the figure's own significant digits) and at
    least two digits, so '10.241337' may match '10.2' but never a bare '10'."""
    out = {fig}
    try:
        x = float(fig)
    except ValueError:
        return out
    floor = min(3, sig_digits(fig))
    for scaled in (x, x * 1000, x / 1000):
        forms = {f"{round(scaled, nd):.{nd}f}" for nd in range(0, 4)}
        if float(scaled).is_integer():
            forms.add(str(int(scaled)))
        out |= {s for s in forms if len(s.replace(".", "")) >= 2 and sig_digits(s) >= floor}
    return out


def date_forms(token: str) -> list[str]:
    _, iso = token.split(":", 1)
    y, mon, d = (None if iso.startswith("--") else int(iso[:4])), int(iso[-5:-3]), int(iso[-2:])
    name = [k for k, v in MONTHS.items() if v == mon][0]
    short = name[:3]
    if y is None:
        return [rf"\b{d}(?:st|nd|rd|th)?\s+(?:{name}|{short})\b", rf"\b(?:{name}|{short})\.?\s+{d}\b"]
    return [rf"\b{y}-{mon:02d}-{d:02d}\b", rf"\b{d}(?:st|nd|rd|th)?\s+(?:{name}|{short})\.?,?\s+{y}\b",
            rf"\b(?:{name}|{short})\.?\s+{d}(?:st|nd|rd|th)?,?\s+{y}\b", rf"\b0?{d}/0?{mon}/{y}\b"]


def present(fig: str, text: str) -> bool:
    if fig.startswith("date:"):
        return any(re.search(p, text, re.I) for p in date_forms(fig))
    if any(re.search(rf"(?<![\d.]){re.escape(c)}(?![\d])", text) for c in equivalents(fig)):
        return True
    try:
        small = float(fig) / 1000
    except ValueError:
        return False
    if small.is_integer() and 0 < small < 10:
        unit = r"\s?(?:GW|GWh|TW|TWh|bn|billion|kt|Mt)\b"
        return re.search(rf"(?<![\d.]){int(small)}{unit}", text) is not None
    return False


def fetch_direct(url: str) -> str | None:
    """Plain HTTP GET with no Parallel involvement; None for failures, PDFs and non-text pages."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (living-grid fact check)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            ctype = resp.headers.get("Content-Type", "")
            if not any(t in ctype for t in ("text/", "json", "xml")):
                return None
            raw = resp.read(3_000_000).decode(resp.headers.get_content_charset() or "utf-8", errors="replace")
    except Exception:
        return None
    raw = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", raw)
    return normalise(html.unescape(re.sub(r"<[^>]+>", " ", raw)))


def figure_check(question: str, figs: list[str], urls: list[str]) -> tuple[list[str], list[str], dict]:
    """Re-find every figure in the cited pages: direct HTTP first (independent of Parallel), then
    Parallel Extract only for figures still missing (JavaScript pages, PDFs). Returns found,
    missing, and which route proved each found figure."""
    route: dict[str, str] = {}
    if not figs or not urls:
        return [], figs, route
    urls = urls[:MAX_SOURCES_CHECKED]
    with ThreadPoolExecutor(max_workers=4) as pool:
        direct = normalise(" ".join(t for t in pool.map(fetch_direct, urls) if t))
    for f in figs:
        if direct and present(f, direct):
            route[f] = "direct"
    missing = [f for f in figs if f not in route]
    if missing:
        try:
            got = call("POST", "/v1/extract", {"urls": urls, "objective": question,
                                                "search_queries": [m for m in missing if not m.startswith("date:")][:3] or [question[:60]]})
            text = normalise(" ".join(" ".join(r.get("excerpts") or []) for r in got.get("results", [])))
            for f in missing:
                if present(f, text):
                    route[f] = "parallel_extract"
            still = [f for f in missing if f not in route]
            if still:
                full = call("POST", "/v1/extract", {"urls": urls, "objective": question, "advanced_settings": {"full_content": True}})
                text = normalise(" ".join(r.get("full_content") or "" for r in full.get("results", [])))
                for f in still:
                    if present(f, text):
                        route[f] = "parallel_extract_full"
        except RuntimeError:
            pass
    found = [f for f in figs if f in route]
    return found, [f for f in figs if f not in route], route


def domain(url: str) -> str:
    host = urllib.parse.urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def corroborated(fact: dict, cross: dict | None) -> bool:
    """True when the agreeing cross-check cites at least one website the research run did not."""
    if not cross or not cross.get("agrees"):
        return False
    research_domains = {domain(s["url"]) for s in fact.get("sources", [])}
    return any(domain(s["url"]) not in research_domains for s in cross.get("sources", []))


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
    found, missing, route = figure_check(fact["question"], figs, list(dict.fromkeys(urls))) if "value" in fact else ([], figs, {})
    ok, how = decide(fact, cross, found, missing, figs)
    return {**fact, "crosscheck": cross, "figures_found": found, "figures_missing": missing, "figures_route": route,
            "corroborated_by_other_domain": corroborated(fact, cross), "verified": ok, "verification": how}


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
