import json

import pandas as pd
import pytest

from pipeline import cache, commit_chain as cc

SEED = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")


def _rows(order=(0, 1, 2)):
    base = pd.DataFrame(
        {
            "made_at": pd.to_datetime(["2026-11-07T20:00Z"] * 3),
            "zone": ["GB", "FR", "NL"],
            "target": ["price_da"] * 3,
            "ts": pd.to_datetime(["2026-11-09T10:00Z"] * 3),
            "horizon_h": [38, 38, 38],
            "p10": [10.0, 20.5, 30.25],
            "p50": [15.0, 25.0, 35.0],
            "p90": [20.0, 30.0, 40.0],
            "model_version": ["lgbm-x"] * 3,
        }
    )
    return base.iloc[list(order)].reset_index(drop=True)


def test_hash_is_deterministic_and_order_independent():
    a = cc.canonical_bytes(_rows((0, 1, 2)))
    assert a == cc.canonical_bytes(_rows((2, 0, 1)))
    assert cc.sha256_hex(a) == cc.sha256_hex(cc.canonical_bytes(_rows()))
    assert a.splitlines()[0] == b"made_at,zone,target,ts,horizon_h,p10,p50,p90,model_version"
    assert b"2026-11-09T10:00:00Z" in a and b"20.5" in a


def test_hash_changes_when_a_forecast_changes():
    other = _rows()
    other.loc[0, "p50"] = 15.01
    assert cc.sha256_hex(cc.canonical_bytes(other)) != cc.sha256_hex(cc.canonical_bytes(_rows()))


def test_ed25519_rfc8032_vector():
    pub = cc.public_key(SEED)
    assert pub.hex() == "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
    sig = cc.sign(SEED, b"")
    assert sig.hex().startswith("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155")
    assert cc.verify_signature(pub, b"", sig)
    assert not cc.verify_signature(pub, b"x", sig)


def test_base58_roundtrip():
    assert cc.b58encode(b"\0\0abc") == "11" + cc.b58encode(b"abc")
    assert cc.b58decode(cc.b58encode(b"\0\0abc\xff")) == b"\0\0abc\xff"
    assert cc.b58decode(cc.MEMO_PROGRAM).__len__() == 32


def test_memo_transaction_layout():
    blockhash = cc.b58encode(bytes(range(32)))
    tx = cc.memo_transaction(SEED, "lg1|run|x|abc", blockhash)
    assert tx[0] == 1 and len(tx[1:65]) == 64
    message = tx[65:]
    assert message[:3] == bytes([1, 0, 1])
    assert message[4:36] == cc.public_key(SEED)
    assert message[36:68] == cc.b58decode(cc.MEMO_PROGRAM)
    assert message.endswith(b"lg1|run|x|abc")
    assert cc.verify_signature(cc.public_key(SEED), message, tx[1:65])


def test_keygen_never_overwrites(tmp_path):
    path = tmp_path / "k.json"
    address = cc.keygen(path)
    raw = json.loads(path.read_text())
    assert len(raw) == 64 and cc.load_wallet(path)[1] == address
    assert oct(path.stat().st_mode)[-3:] == "600"
    with pytest.raises(FileExistsError):
        cc.keygen(path)


def test_offline_commit_keeps_hash_and_file(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")
    monkeypatch.setattr(cc, "rpc", lambda *a, **k: pytest.fail("offline must not call the network"))
    rec = cc.commit_run(_rows(), pd.Timestamp("2026-11-07T20:00Z"))
    assert rec["status"] == "offline" and rec["signature"] is None and rec["rows"] == 3
    assert rec["memo"] == f"lg1|run|20261107T200000Z|{rec['sha256']}"
    assert cc.sha256_hex((tmp_path / rec["file"]).read_bytes()) == rec["sha256"]
    assert cc.read_records()[0]["id"] == rec["id"]
    assert cc.verify()[0]["file_matches"] is True


def test_post_failure_is_pending_then_retry_posts(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setenv("LG_SOLANA_KEYPAIR", str(tmp_path / "w.json"))
    cc.keygen()
    monkeypatch.setattr(cc, "post_memo", lambda memo: (_ for _ in ()).throw(RuntimeError("rpc down")))
    rec = cc.commit_run(_rows(), pd.Timestamp("2026-11-07T21:00Z"))
    assert rec["status"] == "pending" and "rpc down" in rec["error"]
    monkeypatch.setattr(cc, "post_memo", lambda memo: "SIG123")
    assert cc.retry() == 1
    (final,) = cc.read_records()
    assert final["status"] == "posted" and final["signature"] == "SIG123" and "explorer" in final


def test_safely_swallows_errors():
    def boom():
        raise RuntimeError("x")

    assert cc.safely(boom) is None


def test_no_default_wallet(monkeypatch):
    monkeypatch.delenv("LG_SOLANA_KEYPAIR", raising=False)
    with pytest.raises(cc.PostingRefused):
        cc.keypair_path()
    with pytest.raises(cc.PostingRefused):
        cc.load_wallet()
    monkeypatch.setenv("LG_SOLANA_KEYPAIR", "   ")
    with pytest.raises(cc.PostingRefused):
        cc.keypair_path()


def test_writes_are_refused_under_pytest_even_with_a_working_network(monkeypatch):
    monkeypatch.setattr(cc.httpx, "post", lambda *a, **k: pytest.fail("a write reached the network"))
    for method in cc.WRITE_METHODS:
        with pytest.raises(cc.PostingRefused):
            cc.rpc(method, [])


def test_reads_still_work_under_pytest(monkeypatch):
    class R:
        def raise_for_status(self): pass
        def json(self): return {"result": 7}

    monkeypatch.setattr(cc.httpx, "post", lambda *a, **k: R())
    assert cc.rpc("getLatestBlockhash", []) == 7


def test_post_memo_cannot_sign_and_send_in_a_test(tmp_path, monkeypatch):
    monkeypatch.setenv("LG_SOLANA_KEYPAIR", str(tmp_path / "w.json"))
    cc.keygen()
    calls = []

    def fake_post(url, json, timeout):
        calls.append(json["method"])
        if json["method"] == "getLatestBlockhash":
            return type("R", (), {"raise_for_status": lambda s: None, "json": lambda s: {"result": {"value": {"blockhash": cc.b58encode(bytes(32))}}}})()
        pytest.fail("write reached the network")

    monkeypatch.setattr(cc.httpx, "post", fake_post)
    with pytest.raises(cc.PostingRefused):
        cc.post_memo("lg1|run|x|abc")
    assert calls == ["getLatestBlockhash"]
