"""Commit a SHA-256 of each frozen forecast (and each hourly run) to Solana, so "logged before the outcome" is checkable.

    uv run python -m pipeline.commit_chain keygen      # one-off: create the wallet, print its public address
    uv run python -m pipeline.commit_chain airdrop     # devnet only: request test SOL
    uv run python -m pipeline.commit_chain retry       # post any commitment still pending
    uv run python -m pipeline.commit_chain verify      # recompute hashes from the files and fetch the memos

What is hashed: the canonical CSV of the rows (data/commitments/<id>.csv, header + one line per row, rows sorted
by every column, timestamps as UTC ISO-8601 with a Z, floats as Python repr). Anyone can hash that file with
SHA-256 and compare it with the memo `lg1|<kind>|<label>|<sha256>` on the published wallet's transactions. The
transaction is a Solana Memo-program instruction signed by the wallet, so the chain timestamps it.
A hash proves a forecast existed unchanged, not that no others were made: the wallet address is published and
every transaction from it is listed.

Records go to data/commitments.jsonl (append-only; a pending record is superseded by a later line with the
same id). LG_OFFLINE=1 posts nothing and records status "offline" (hash and file are still kept).

Configuration (environment):
  LG_SOLANA_KEYPAIR   path to the wallet file (Solana CLI format, JSON array of 64 bytes)
                      default ~/.config/living-grid/solana-keypair.json, never inside the repo
  LG_SOLANA_RPC       default https://api.devnet.solana.com
  LG_SOLANA_CLUSTER   explorer cluster label, default devnet
"""

import argparse
import base64
import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path

import httpx
import pandas as pd

from pipeline import cache

log = logging.getLogger("pipeline.commit_chain")

MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
DEFAULT_RPC = "https://api.devnet.solana.com"
DEFAULT_KEYPAIR = "~/.config/living-grid/solana-keypair.json"
LOG_COLUMNS = ["made_at", "zone", "target", "ts", "horizon_h", "p10", "p50", "p90", "model_version"]
_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


# --- canonical bytes and hash --------------------------------------------------------------------------------


def _fmt(v) -> str:
    if isinstance(v, pd.Timestamp):
        v = v.tz_localize("UTC") if v.tzinfo is None else v.tz_convert("UTC")
        return v.strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(v, float):
        return repr(v)
    if hasattr(v, "item"):
        return _fmt(v.item())
    return str(v)


def canonical_bytes(df: pd.DataFrame, columns: list[str] | None = None) -> bytes:
    cols = list(columns or df.columns)
    ordered = df[cols].sort_values(cols, kind="mergesort")
    lines = [",".join(cols)]
    lines += [",".join(_fmt(v) for v in row) for row in ordered.itertuples(index=False, name=None)]
    return ("\n".join(lines) + "\n").encode()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def memo_text(kind: str, label: str, digest: str) -> str:
    return f"lg1|{kind}|{label}|{digest}"


# --- base58 and ed25519 (RFC 8032 reference, pure Python: one signature per post, no extra dependency) ------


def b58encode(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = _B58[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        n = n * 58 + _B58.index(ch)
    body = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + body


_P = 2**255 - 19
_D = -121665 * pow(121666, -1, _P) % _P
_Q = 2**252 + 27742317777372353535851937790883648493
_I = pow(2, (_P - 1) // 4, _P)


def _xrecover(y: int) -> int:
    xx = (y * y - 1) * pow(_D * y * y + 1, -1, _P)
    x = pow(xx, (_P + 3) // 8, _P)
    if (x * x - xx) % _P:
        x = x * _I % _P
    return _P - x if x % 2 else x


_BY = 4 * pow(5, -1, _P) % _P
_B = (_xrecover(_BY), _BY)


def _add(p, q):
    (x1, y1), (x2, y2) = p, q
    t = _D * x1 * x2 * y1 * y2
    return ((x1 * y2 + x2 * y1) * pow(1 + t, -1, _P) % _P, (y1 * y2 + x1 * x2) * pow(1 - t, -1, _P) % _P)


def _mul(p, e: int):
    r = (0, 1)
    while e:
        if e & 1:
            r = _add(r, p)
        p = _add(p, p)
        e >>= 1
    return r


def _enc(p) -> bytes:
    x, y = p
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def _expand(seed: bytes) -> tuple[int, bytes]:
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little")
    return (a & ((1 << 254) - 8)) | (1 << 254), h[32:]


def public_key(seed: bytes) -> bytes:
    return _enc(_mul(_B, _expand(seed)[0]))


def sign(seed: bytes, msg: bytes) -> bytes:
    a, prefix = _expand(seed)
    pub = _enc(_mul(_B, a))
    r = int.from_bytes(hashlib.sha512(prefix + msg).digest(), "little") % _Q
    big_r = _enc(_mul(_B, r))
    k = int.from_bytes(hashlib.sha512(big_r + pub + msg).digest(), "little") % _Q
    return big_r + ((r + k * a) % _Q).to_bytes(32, "little")


def verify_signature(pub: bytes, msg: bytes, sig: bytes) -> bool:
    def dec(b: bytes):
        y = int.from_bytes(b, "little") & ((1 << 255) - 1)
        x = _xrecover(y)
        return (_P - x if (x & 1) != (b[31] >> 7) else x, y)

    big_r, s = dec(sig[:32]), int.from_bytes(sig[32:], "little")
    k = int.from_bytes(hashlib.sha512(sig[:32] + pub + msg).digest(), "little") % _Q
    return _mul(_B, s) == _add(big_r, _mul(dec(pub), k))


# --- wallet --------------------------------------------------------------------------------------------------


def keypair_path() -> Path:
    return Path(os.environ.get("LG_SOLANA_KEYPAIR", DEFAULT_KEYPAIR)).expanduser()


def keygen(path: Path | None = None) -> str:
    path = path or keypair_path()
    if path.exists():
        raise FileExistsError(f"{path} already exists; refusing to overwrite a wallet")
    seed = os.urandom(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(list(seed + public_key(seed)), f)
    return b58encode(public_key(seed))


def load_wallet(path: Path | None = None) -> tuple[bytes, str]:
    raw = bytes(json.loads((path or keypair_path()).read_text()))
    seed, pub = raw[:32], raw[32:]
    if public_key(seed) != pub:
        raise ValueError("wallet file is corrupt: public key does not match the seed")
    return seed, b58encode(pub)


# --- transaction and RPC -------------------------------------------------------------------------------------


def _shortvec(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def memo_transaction(seed: bytes, memo: str, blockhash: str) -> bytes:
    pub = public_key(seed)
    data = memo.encode()
    message = (
        bytes([1, 0, 1])
        + _shortvec(2)
        + pub
        + b58decode(MEMO_PROGRAM)
        + b58decode(blockhash)
        + _shortvec(1)
        + bytes([1])
        + _shortvec(1)
        + bytes([0])
        + _shortvec(len(data))
        + data
    )
    return _shortvec(1) + sign(seed, message) + message


def rpc_url() -> str:
    return os.environ.get("LG_SOLANA_RPC", DEFAULT_RPC)


def cluster() -> str:
    return os.environ.get("LG_SOLANA_CLUSTER", "devnet")


def rpc(method: str, params: list, client: httpx.Client | None = None):
    c = client or httpx
    r = c.post(rpc_url(), json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=10)
    r.raise_for_status()
    body = r.json()
    if "error" in body:
        raise RuntimeError(f"{method}: {body['error']}")
    return body["result"]


def post_memo(memo: str, wallet: Path | None = None, wait_s: float = 25.0) -> str:
    seed, _ = load_wallet(wallet)
    blockhash = rpc("getLatestBlockhash", [{"commitment": "finalized"}])["value"]["blockhash"]
    tx = memo_transaction(seed, memo, blockhash)
    sig = rpc("sendTransaction", [base64.b64encode(tx).decode(), {"encoding": "base64", "preflightCommitment": "confirmed"}])
    deadline = time.time() + wait_s
    while time.time() < deadline:
        st = rpc("getSignatureStatuses", [[sig]])["value"][0]
        if st and st.get("err"):
            raise RuntimeError(f"transaction {sig} failed: {st['err']}")
        if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
            return sig
        time.sleep(1.5)
    raise TimeoutError(f"transaction {sig} not confirmed within {wait_s:.0f}s")


def airdrop(sol: float = 1.0) -> str:
    _, address = load_wallet()
    return rpc("requestAirdrop", [address, int(sol * 1e9)])


def explorer_url(signature: str) -> str:
    suffix = "" if cluster() == "mainnet-beta" else f"?cluster={cluster()}"
    return f"https://explorer.solana.com/tx/{signature}{suffix}"


# --- records -------------------------------------------------------------------------------------------------


def records_path() -> Path:
    return cache.DATA / "commitments.jsonl"


def files_dir() -> Path:
    return cache.DATA / "commitments"


def read_records() -> list[dict]:
    p = records_path()
    if not p.exists():
        return []
    latest: dict[str, dict] = {}
    for line in p.read_text().splitlines():
        if line.strip():
            rec = json.loads(line)
            latest[rec["id"]] = rec
    return list(latest.values())


def _append_record(rec: dict) -> None:
    p = records_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a") as f:
        f.write(json.dumps(rec, sort_keys=True) + "\n")


def commit(kind: str, label: str, df: pd.DataFrame, columns: list[str] | None = None, post: bool = True) -> dict:
    """Hash df, keep the canonical file, post the memo unless offline, and append the record. Never raises."""
    data = canonical_bytes(df, columns)
    digest = sha256_hex(data)
    rec_id = f"{kind}-{label}"
    files_dir().mkdir(parents=True, exist_ok=True)
    (files_dir() / f"{rec_id}.csv").write_bytes(data)
    rec = {
        "id": rec_id,
        "kind": kind,
        "label": label,
        "sha256": digest,
        "rows": len(df),
        "memo": memo_text(kind, label, digest),
        "file": f"commitments/{rec_id}.csv",
        "cluster": cluster(),
        "recorded_at": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signature": None,
        "wallet": None,
        "status": "offline",
    }
    if post and not cache.offline():
        retry(limit=3)
        _post_into(rec)
    _append_record(rec)
    return rec


def _post_into(rec: dict) -> None:
    try:
        _, rec["wallet"] = load_wallet()
        rec["signature"] = post_memo(rec["memo"])
        rec["status"] = "posted"
        rec["explorer"] = explorer_url(rec["signature"])
        rec["posted_at"] = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
        log.info("committed %s to %s: %s", rec["id"], rec["cluster"], rec["signature"])
    except Exception as e:
        rec["status"] = "pending"
        rec["error"] = f"{type(e).__name__}: {e}"[:300]
        log.warning("commitment %s not posted (%s); `retry` will post it", rec["id"], rec["error"])


def commit_frozen(frozen_at: pd.Timestamp) -> dict:
    frozen = cache.read("forecasts/frozen_monday")
    rows = frozen[frozen["frozen_at"] == frozen_at]
    return commit("freeze", frozen_at.strftime("%Y%m%dT%H%M%SZ"), rows, LOG_COLUMNS + ["frozen_at"])


def commit_run(rows: pd.DataFrame, made_at: pd.Timestamp) -> dict:
    return commit("run", made_at.strftime("%Y%m%dT%H%M%SZ"), rows, LOG_COLUMNS)


def safely(fn, *args) -> dict | None:
    try:
        return fn(*args)
    except Exception:
        log.exception("commit_chain failed; the forecast itself is unaffected")
        return None


def retry(limit: int | None = None) -> int:
    """Post commitments that failed earlier, oldest first; stop at the first failure so a dead RPC costs one timeout."""
    n = 0
    pending = [r for r in read_records() if r["status"] == "pending"]
    for rec in pending[:limit]:
        _post_into(rec)
        _append_record(rec)
        if rec["status"] != "posted":
            break
        n += 1
    return n


def verify() -> list[dict]:
    out = []
    for rec in read_records():
        f = cache.DATA / rec["file"]
        ok_file = f.exists() and sha256_hex(f.read_bytes()) == rec["sha256"]
        on_chain = None
        if rec.get("signature") and not cache.offline():
            tx = rpc("getTransaction", [rec["signature"], {"encoding": "json", "maxSupportedTransactionVersion": 0}])
            logs = " ".join((tx or {}).get("meta", {}).get("logMessages") or [])
            on_chain = rec["sha256"] in logs
        out.append({"id": rec["id"], "file_matches": ok_file, "on_chain_matches": on_chain})
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=["keygen", "airdrop", "retry", "verify", "address"])
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    if args.cmd == "keygen":
        print(keygen())
    elif args.cmd == "address":
        print(load_wallet()[1])
    elif args.cmd == "airdrop":
        print(airdrop())
    elif args.cmd == "retry":
        print(f"posted {retry()}")
    else:
        for r in verify():
            print(r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
