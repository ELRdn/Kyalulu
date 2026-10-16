"""Local sync baseline belongs to its connection and selection; no external I/O."""

import json
import sqlite3

import pytest
from starlette.requests import Request

from python.api import cloud_sync
from python.cloud.store import CloudError
from python.cloud.sync import apply_snapshot, export_snapshot
from python.storage import conversation, memories
from python.storage import db as storage


def request(body):
    async def receive():
        return {"type": "http.request", "body": json.dumps(body).encode(), "more_body": False}
    return Request({"type": "http", "method": "PUT", "headers": []}, receive)


@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "data.db")
    monkeypatch.setenv("KYALULU_MANAGED_CLOUD_ORIGIN", "https://cloud.test")
    value = {"mode": "selected", "selected": ["chat-a"], "revision": 7,
             "token": "device-a", "origin": "https://cloud.test", "image_consent": False}
    cloud_sync.save_config(value)
    return value


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [
    {"token": "device-b"}, {"selected": ["chat-b"]}, {"mode": "all"},
])
async def test_changed_sync_binding_cannot_reuse_another_baseline(local, monkeypatch, change):
    calls = []

    async def remote(config, path, **kwargs):
        calls.append((path, kwargs))
        if path == "":
            return {"mode": config["mode"]}
        if path == "/transfers":
            # The new account/scope happens to have the same numeric head.
            assert kwargs["body"]["base_revision"] == 0
            return {"conflict": True, "error": "cloud was updated"}
        pytest.fail("conflicting baseline must not send data pages")

    monkeypatch.setattr(cloud_sync, "remote", remote)
    result = await cloud_sync.configure(request({
        "mode": local["mode"], "selected": local["selected"], "consent": True, **change,
    }))
    assert result["revision"] == 0
    assert (await cloud_sync.push()).status_code == 409
    assert [path for path, _ in calls] == ["", "/transfers"]


@pytest.mark.asyncio
async def test_unchanged_binding_preserves_baseline(local, monkeypatch):
    async def remote(config, path, **kwargs):
        assert path == ""
        return {"mode": config["mode"]}
    monkeypatch.setattr(cloud_sync, "remote", remote)
    result = await cloud_sync.configure(request({"mode": local["mode"],
        "selected": local["selected"], "token": local["token"], "consent": True}))
    assert result["revision"] == 7
    assert "token" not in result


@pytest.mark.asyncio
async def test_origin_change_disables_sync_without_sending_old_token(local, monkeypatch):
    monkeypatch.setenv("KYALULU_MANAGED_CLOUD_ORIGIN", "https://another-cloud.test")

    async def remote(*args, **kwargs):
        pytest.fail("old token or local data must never reach the changed origin")
    monkeypatch.setattr(cloud_sync, "remote", remote)
    settings = await cloud_sync.settings()
    assert settings["mode"] == "off" and not settings["connected"]
    assert settings["revision"] == 0
    with pytest.raises(ValueError, match="同期はオフ"):
        await cloud_sync.push()


def test_legacy_config_requires_fresh_baseline(local):
    local.pop("origin")
    cloud_sync.save_config(local)
    migrated = cloud_sync.read_config()
    assert migrated["revision"] == 0 and migrated["mode"] == "off" and not migrated["token"]


@pytest.mark.asyncio
async def test_failed_reconfiguration_preserves_existing_binding(local, monkeypatch):
    async def remote(*args, **kwargs):
        raise ValueError("unavailable")
    monkeypatch.setattr(cloud_sync, "remote", remote)
    with pytest.raises(ValueError, match="unavailable"):
        await cloud_sync.configure(request({"mode": "all", "token": "device-b", "consent": True}))
    assert cloud_sync.read_config() == local


@pytest.mark.asyncio
async def test_real_branch_scope_sync_and_unknown_mode_rejection(isolated):
    await storage.init_db()
    with sqlite3.connect(storage.DB_PATH) as db:
        message_id = db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('source','user','hello')").lastrowid
    branch_id = (await conversation.branch("source", message_id))["session_id"]
    snapshot = export_snapshot(storage.DB_PATH, [branch_id])
    assert snapshot["tables"]["session_scopes"][0]["mode"] == "branch"
    apply_snapshot(storage.DB_PATH, snapshot)
    assert export_snapshot(storage.DB_PATH, [branch_id]) == snapshot
    snapshot["tables"]["session_scopes"][0]["mode"] = "invented"
    before = export_snapshot(storage.DB_PATH)
    with pytest.raises(CloudError, match="invalid_sync_scope"):
        apply_snapshot(storage.DB_PATH, snapshot)
    assert export_snapshot(storage.DB_PATH) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("selected", [None, ["erased"]])
async def test_repeated_tombstones_are_monotonic_and_cannot_restore_data(isolated, selected):
    await storage.init_db()
    with sqlite3.connect(storage.DB_PATH) as db:
        db.execute("INSERT INTO session_deletions VALUES('erased','2026-10-10 00:00:00')")
    snapshot = export_snapshot(storage.DB_PATH, selected)
    snapshot["tables"]["session_deletions"].append({"session_id": "erased", "deleted_at": "2026-10-11 00:00:00"})
    for _ in range(2):
        apply_snapshot(storage.DB_PATH, snapshot)
    with sqlite3.connect(storage.DB_PATH) as db:
        assert db.execute("SELECT * FROM session_deletions").fetchall() == [("erased", "2026-10-10 00:00:00")]
    before = export_snapshot(storage.DB_PATH)
    invalid = json.loads(json.dumps(snapshot))
    invalid["tables"]["session_deletions"][-1]["deleted_at"] = None
    with pytest.raises(CloudError, match="sync_schema_mismatch"):
        apply_snapshot(storage.DB_PATH, invalid)
    assert export_snapshot(storage.DB_PATH) == before
    with sqlite3.connect(storage.DB_PATH) as db:
        db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('alive','user','preserve')")
    resurrect = export_snapshot(storage.DB_PATH)
    resurrect["tables"]["chat_history"][0]["session_id"] = "erased"
    before = export_snapshot(storage.DB_PATH)
    with pytest.raises(CloudError, match="erased_conversation_cannot_be_restored"):
        apply_snapshot(storage.DB_PATH, resurrect)
    assert export_snapshot(storage.DB_PATH) == before


@pytest.mark.asyncio
async def test_duplicate_non_tombstone_identity_still_rejected(isolated):
    await memories.session_scope({"session_id": "selected"})
    snapshot = export_snapshot(storage.DB_PATH, ["selected"])
    snapshot["tables"]["session_scopes"] *= 2
    before = export_snapshot(storage.DB_PATH)
    with pytest.raises(CloudError, match="duplicate_sync_identity"):
        apply_snapshot(storage.DB_PATH, snapshot)
    assert export_snapshot(storage.DB_PATH) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("replacement", [False, True])
async def test_selected_sync_scrubs_retained_shared_memory_traces(isolated, replacement):
    scope = await memories.session_scope({"session_id": "selected"})
    manual = await memories.create(scope, "semantic", "private manual quote")
    sourced = await memories.create(scope, "semantic", "private source quote", source_session_id="selected")
    keep = await memories.create("session:unselected", "semantic", "keep this memory")
    removed_ids = {manual["id"], sourced["id"]}
    candidates = [{"id": m["id"], "content": m["content"], "source_session_id": m["source_session_id"]}
                  for m in (manual, sourced, keep)]
    result = {"reply": "keep this reply", "state": {"scene": "keep"}, "memory": {
        "candidates": candidates, "decisions": [{"memory_id": m["id"]} for m in (manual, sourced, keep)],
        "injected": [m["id"] for m in (manual, sourced, keep)], "evidenced": [sourced["id"]]},
        "compiled": "private manual quote", "raw_prompt": "private source quote", "attempts": ["private source quote"]}
    unrelated = {"reply": "untouched", "memory": {"candidates": [candidates[-1]]}, "raw_prompt": "keep this memory"}
    with sqlite3.connect(storage.DB_PATH) as db:
        for generation_id, body in (("retained", result), ("unrelated", unrelated)):
            db.execute("INSERT INTO generations(generation_id,session_id,fingerprint,status,result_json) VALUES(?,'unselected','','completed',?)",
                       (generation_id, json.dumps(body)))
        db.execute("INSERT INTO generations(generation_id,session_id,fingerprint,status,result_json) VALUES('selected-gen','selected','','completed','{}')")
    snapshot = export_snapshot(storage.DB_PATH, ["selected"])
    if replacement:
        # Same ID with corrected content must not retain the old source snapshot.
        for row in snapshot["tables"]["memories"]:
            row["content"] = row["source_quote"] = "corrected quote"
    else:
        snapshot["tables"]["memories"] = []
        snapshot["tables"]["memory_events"] = []
    invalid = json.loads(json.dumps(snapshot))
    invalid["tables"]["session_scopes"][0]["mode"] = "invalid"
    with pytest.raises(CloudError):
        apply_snapshot(storage.DB_PATH, invalid)
    with sqlite3.connect(storage.DB_PATH) as db:
        assert json.loads(db.execute("SELECT result_json FROM generations WHERE generation_id='retained'").fetchone()[0]) == result
    if replacement:
        # An insertion failure after cleanup must roll back both deleted rows
        # and scrubbed cross-session traces, not leave a half-applied sync.
        before = export_snapshot(storage.DB_PATH)
        with sqlite3.connect(storage.DB_PATH) as db:
            db.execute("CREATE TRIGGER fail_sync_insert BEFORE INSERT ON memories BEGIN SELECT RAISE(ABORT,'simulated sync failure'); END")
        with pytest.raises(sqlite3.IntegrityError, match="simulated sync failure"):
            apply_snapshot(storage.DB_PATH, snapshot)
        assert export_snapshot(storage.DB_PATH) == before
        with sqlite3.connect(storage.DB_PATH) as db:
            assert json.loads(db.execute("SELECT result_json FROM generations WHERE generation_id='retained'").fetchone()[0]) == result
            assert db.execute("SELECT COUNT(*) FROM generations WHERE generation_id='selected-gen'").fetchone()[0] == 1
            db.execute("DROP TRIGGER fail_sync_insert")
    apply_snapshot(storage.DB_PATH, snapshot)
    with sqlite3.connect(storage.DB_PATH) as db:
        redacted = json.loads(db.execute("SELECT result_json FROM generations WHERE generation_id='retained'").fetchone()[0])
        assert redacted["reply"] == result["reply"] and redacted["state"] == result["state"]
        assert redacted["memory"]["candidates"] == [candidates[-1]]
        assert redacted["memory"]["decisions"] == [{"memory_id": keep["id"]}]
        assert redacted["memory"]["injected"] == [keep["id"]] and redacted["memory"]["evidenced"] == []
        assert not {"compiled", "raw_prompt", "attempts"} & redacted.keys()
        assert not any(memory_id in json.dumps(redacted) for memory_id in removed_ids)
        assert json.loads(db.execute("SELECT result_json FROM generations WHERE generation_id='unrelated'").fetchone()[0]) == unrelated
        assert db.execute("SELECT COUNT(*) FROM generations WHERE generation_id='selected-gen'").fetchone()[0] == 0


@pytest.mark.asyncio
async def test_selected_sync_scrubs_trace_after_source_memory_already_removed(isolated):
    await memories.session_scope({"session_id": "selected"})
    result = {"reply": "preserve", "memory": {
        "candidates": [{"id": "gone", "source_session_id": "selected", "content": "removed quote"}],
        "decisions": [{"memory_id": "gone"}], "injected": ["gone"], "evidenced": ["gone"]},
        "raw_prompt": "removed quote"}
    with sqlite3.connect(storage.DB_PATH) as db:
        db.execute("INSERT INTO generations(generation_id,session_id,fingerprint,status,result_json) VALUES('retained','other','','completed',?)",
                   (json.dumps(result),))
    apply_snapshot(storage.DB_PATH, export_snapshot(storage.DB_PATH, ["selected"]))
    with sqlite3.connect(storage.DB_PATH) as db:
        redacted = json.loads(db.execute("SELECT result_json FROM generations").fetchone()[0])
    assert redacted == {"reply": "preserve", "memory": {"candidates": [], "decisions": [], "injected": [], "evidenced": []}}
