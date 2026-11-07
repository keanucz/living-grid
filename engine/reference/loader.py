"""Read verified reference facts from engine/reference/facts/*.json.

Fact values are sourced prose, so code picks one figure out of a fact explicitly:

    figure("gas_ttf_2022_peak")                    # first number in the value
    figure("wind_power_curve", after="cut-out")    # first number after a label (case-insensitive)
    figure("gas_gb_marginal_share", index=1)       # second number

Only facts with "verified": true are served; anything else raises UnverifiedFact so an unchecked
figure can never reach the screen silently.
"""

import json
import re
from functools import cache
from pathlib import Path

FACTS_DIR = Path(__file__).resolve().parent / "facts"
_NUMBER = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?")


class UnverifiedFact(LookupError):
    pass


@cache
def _all() -> dict[str, dict]:
    out = {}
    for p in sorted(FACTS_DIR.glob("*.json")):
        for f in json.loads(p.read_text()):
            out[f["id"]] = {**f, "topic": p.stem}
    return out


def fact(fact_id: str) -> dict:
    """The full verified fact (value, unit, as_of, caveat, sources, verification)."""
    try:
        f = _all()[fact_id]
    except KeyError:
        raise KeyError(f"no reference fact {fact_id!r} in {FACTS_DIR}") from None
    if f.get("verified") is not True:
        raise UnverifiedFact(f"{fact_id} is not verified: {f.get('verification', 'no verification recorded')}")
    return f


def numbers(text: str) -> list[float]:
    return [float(m.replace(",", "")) for m in _NUMBER.findall(text)]


def figure(fact_id: str, after: str | None = None, index: int = 0) -> float:
    """One number from a verified fact's value, optionally the index-th after a label."""
    text = fact(fact_id)["value"]
    if after is not None:
        pos = text.lower().find(after.lower())
        if pos < 0:
            raise ValueError(f"{fact_id}: label {after!r} not in value {text!r}")
        text = text[pos + len(after):]
    found = numbers(text)
    if index >= len(found):
        raise ValueError(f"{fact_id}: no figure #{index} after {after!r} in {fact(fact_id)['value']!r}")
    return found[index]


def source_note(*fact_ids: str) -> str:
    """Short provenance for on-screen notes, e.g. 'IEA; EU 2021/2326'."""
    seen = []
    for i in fact_ids:
        for s in fact(i).get("sources", [])[:1]:
            host = re.sub(r"^https?://(www\.)?", "", s["url"]).split("/")[0]
            if host not in seen:
                seen.append(host)
    return "; ".join(seen)
