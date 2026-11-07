"""On-chain commitments of frozen forecasts and hourly runs, for the reveal view's Verify panel.

Not part of the OpenAPI contract: the panel only needs the record list and the exact bytes that were hashed.
"""

import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from pipeline import cache, commit_chain

router = APIRouter(tags=["proof"], include_in_schema=False)

ID = re.compile(r"^(freeze|run)-\d{8}T\d{6}Z$")


def _wallet() -> str | None:
    try:
        return commit_chain.load_wallet()[1]
    except Exception:
        return None


@router.get("/commitments")
def commitments() -> dict:
    records = sorted(commit_chain.read_records(), key=lambda r: r["recorded_at"], reverse=True)
    wallets = [r["wallet"] for r in records if r.get("wallet")]
    wallet = wallets[0] if wallets else _wallet()
    cl = commit_chain.cluster()
    return {
        "wallet": wallet,
        "cluster": cl,
        "rpc": commit_chain.rpc_url(),
        "explorer_address": None if not wallet else f"https://explorer.solana.com/address/{wallet}" + ("" if cl == "mainnet-beta" else f"?cluster={cl}"),
        "records": records,
        "note": "SHA-256 of the canonical CSV in /commitments/file/{id}; the memo on chain reads lg1|kind|label|sha256.",
    }


@router.get("/commitments/file/{rec_id}", response_class=PlainTextResponse)
def commitment_file(rec_id: str) -> PlainTextResponse:
    if not ID.match(rec_id):
        raise HTTPException(404, "unknown commitment")
    f = commit_chain.files_dir() / f"{rec_id}.csv"
    if not f.exists():
        raise HTTPException(404, "unknown commitment")
    return PlainTextResponse(f.read_bytes().decode(), media_type="text/csv")
