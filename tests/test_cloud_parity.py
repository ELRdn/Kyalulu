"""Hosted parity invariants through real storage, mocked fixed provider traffic only."""
import asyncio
import json
import sqlite3
import time
from contextlib import closing
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest

from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE
from python.cloud.backups import Backups
from python.cloud.generation import CloudChat
from python.cloud.store import CloudError
from python.cloud.sync import export_snapshot, apply_snapshot
from python.cloud.transfers import snapshot_pages, Transfers
from python.storage import db as storage, conversation, memories
from python.storage.context import CloudStorageContext, storage_context
from test_cloud_cost_accounting import config, enroll, generation_response, screened_response, VALID_OUTPUT


@pytest.mark.asyncio
async def test_opening_commit_replay_rollback_and_legacy_interop(tmp_path):
    cfg = config(tmp_path)
    app = create_app(cfg)
    owner = enroll(app)
    sid = f"chat_{uuid4()}"
    body = {"session_id": sid, "character_id": "mocha_sfw", "intro": "Fixture introduction"}
    opening = "/api/chat/settings/opening"
    history = f"/api/chat/history?session_id={sid}"
    path = CloudStorageContext.for_owner(cfg.root / "tenants", owner).directory / "data.db"
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url=cfg.origin, cookies={SESSION_COOKIE: "browser"},
                                 headers={"Origin": cfg.origin, "X-Kyalulu-Owner": owner}) as client:
        status = await client.get("/api/mobile/status")
        assert status.json()["atomic_chat_opening"] is True
        assert (await client.put(opening, json=body, headers={"X-Kyalulu-Owner": str(uuid4())})).status_code == 403
        assert (await client.put(opening, json=body, headers={"Origin": "https://different.test"})).status_code == 403
        assert (await client.get(history)).json() == {"history": []}
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("""CREATE TRIGGER fail_opening BEFORE INSERT ON chat_history
                          BEGIN SELECT RAISE(ABORT, 'fixture failed intro'); END""")
        assert (await client.put(opening, json=body)).status_code == 503
        with closing(sqlite3.connect(path)) as db, db:
            for table in ("session_settings", "session_scopes", "chat_history"):
                assert db.execute(f"SELECT count(*) FROM {table} WHERE session_id=?", (sid,)).fetchone() == (0,)
            db.execute("DROP TRIGGER fail_opening")

        before = app.state.sync.revision(owner)
        replies = await asyncio.gather(client.put(opening, json=body), client.put(opening, json=body))
        assert sorted(response.status_code for response in replies) == [201, 204], [response.text for response in replies]
        assert replies[0].headers["cache-control"] == replies[1].headers["cache-control"] == "no-store"
        revision = replies[0].headers["x-kyalulu-history-revision"]
        assert replies[1].headers["x-kyalulu-history-revision"] == revision
        assert (await client.get(f"/api/chat/context/{sid}")).json()["history_revision"] == revision
        after = app.state.sync.revision(owner)
        assert after != before
        assert (await client.put(opening, json=body)).status_code == 204
        assert app.state.sync.revision(owner)["revision"] == after["revision"] + 1
        assert (await client.put(opening, json={**body, "intro": "Different greeting"})).status_code == 409
        old_client = await client.post(f"/api/chat/intro/inject?session_id={sid}")
        assert old_client.json()["injected"] is False
        messages = (await client.get(history)).json()["history"]
        assert [(row["role"], row["content"], row["model_id"]) for row in messages] == [
            ("assistant", body["intro"], "intro"),
        ]
        first_turn = {"model_id": "cloud-standard", "session_id": sid, "context_mode": "stored",
                      "history_revision": revision, "generation_id": "opening-revision",
                      "messages": [{"role": "user", "content": "hello"}]}
        quoted = await client.post("/api/cloud/quotes", json=first_turn)
        assert quoted.status_code == 200, quoted.text
        changed = await client.put("/api/chat/settings", json={**body, "temperature": 1.25})
        assert changed.status_code == 200, changed.text
        assert (await client.put(opening, json=body)).status_code == 409
        stale_quote = await client.post("/api/cloud/quotes", json=first_turn)
        assert stale_quote.status_code == 409 and stale_quote.json()["code"] == "history_revision_conflict"
        priced = {**first_turn, **{key: quoted.json()[key] for key in ("quote_id", "max_credits")}}
        stale_generation = await client.post("/api/chat/stream", json=priced)
        assert stale_generation.status_code == 409 and stale_generation.json()["code"] == "history_revision_conflict"
        with app.state.store.transaction() as ledger:
            assert ledger.execute("SELECT count(*) FROM operations WHERE owner=?", (owner,)).fetchone()[0] == 0
        settings = (await client.get(f"/api/chat/settings?session_id={sid}")).json()
        assert settings["temperature"] == 1.25
        assert (await client.get(history)).json()["history"] == messages


@pytest.mark.asyncio
async def test_quote_can_capture_stored_history_and_generation_still_requires_that_revision(tmp_path):
    provider_calls = []

    def respond(request):
        provider_calls.append(request)
        return generation_response(VALID_OUTPUT, {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.00001})

    cfg = config(tmp_path)
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = enroll(app)
    request = {"model_id": "cloud-standard", "session_id": "quoted-context", "context_mode": "stored",
               "generation_id": "context-first-turn", "messages": [{"role": "user", "content": "hello"}]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin,
                                 cookies={SESSION_COOKIE: "browser"}, headers={"Origin": cfg.origin}) as client:
        assert (await client.get("/api/capabilities")).json()["features"]["quote_resolves_history"] is True
        legacy_without_revision = await client.post("/api/cloud/quotes", json=request)
        assert legacy_without_revision.status_code == 409
        assert legacy_without_revision.json()["code"] == "history_revision_required"

        capture_url = "/api/cloud/quotes?resolve_history=true"
        captured = await client.post(capture_url, json=request)
        assert captured.status_code == 200, captured.text
        quote = captured.json()
        context_url = "/api/chat/context/quoted-context"
        revision = (await client.get(context_url)).json()["history_revision"]
        assert quote["history_revision"] == revision and quote["credit_reservation"] is False
        priced = {**request, "quote_id": quote["quote_id"], "max_credits": quote["max_credits"]}
        missing = await client.post("/api/chat", json=priced)
        assert missing.status_code == 409 and missing.json()["code"] == "history_revision_required"

        edited = await client.put("/api/chat/settings", json={"session_id": "quoted-context", "temperature": 1.1})
        assert edited.status_code == 200
        stale = await client.post("/api/chat", json={**priced, "history_revision": revision})
        assert stale.status_code == 409 and stale.json()["code"] == "history_revision_conflict"
        stale_quote = await client.post(capture_url, json={**request, "history_revision": revision})
        assert stale_quote.status_code == 409 and stale_quote.json()["code"] == "history_revision_conflict"
        assert not provider_calls
        with app.state.store.transaction() as ledger:
            assert ledger.execute("SELECT count(*) FROM operations WHERE owner=?", (owner,)).fetchone()[0] == 0

        latest = await client.post(capture_url, json=request)
        assert latest.status_code == 200, latest.text
        quote = latest.json()
        assert quote["history_revision"] != revision
        old_client = await client.post("/api/cloud/quotes", json={**request, "history_revision": quote["history_revision"]})
        assert old_client.status_code == 200 and "history_revision" not in old_client.json()
        sent = await client.post("/api/chat", json={**request, **{key: quote[key] for key in ("quote_id", "max_credits", "history_revision")}})
        assert sent.status_code == 200 and sent.json()["status"] == "completed", sent.text
        assert len(provider_calls) == 1
        with app.state.store.transaction() as ledger:
            assert [tuple(row) for row in ledger.execute("SELECT state, charged_credits FROM operations WHERE owner=?", (owner,))] == [("completed", 1)]
            assert ledger.execute("SELECT count(*) FROM credit_holds").fetchone()[0] == 0


@pytest.mark.asyncio
async def test_hosted_requests_reuse_schema_until_database_is_replaced(tmp_path, monkeypatch):
    cfg = config(tmp_path)
    app = create_app(cfg)
    owner = enroll(app)
    path = CloudStorageContext.for_owner(cfg.root / "tenants", owner).directory / "data.db"
    original_script = storage.aiosqlite.Connection.executescript
    schema_runs = 0

    async def count_initialization(connection, script):
        nonlocal schema_runs
        if script == storage.CLOUD_SCHEMA_DDL:
            schema_runs += 1
        return await original_script(connection, script)

    monkeypatch.setattr(storage.aiosqlite.Connection, "executescript", count_initialization)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin,
                                 cookies={SESSION_COOKIE: "browser"}) as client:
        history = "/api/chat/history?session_id=fixture"
        settings = "/api/chat/settings?session_id=fixture"
        assert (await client.get(history)).status_code == 200
        assert schema_runs > 0
        cold_runs = schema_runs
        assert (await client.get(settings)).status_code == 200
        assert (await client.get(history)).status_code == 200
        assert schema_runs == cold_runs

        replacement = tmp_path / "replacement.db"
        with closing(sqlite3.connect(replacement)) as db:
            db.execute("CREATE TABLE fixture (id INTEGER)")
        replacement.replace(path)
        assert (await client.get(settings)).status_code == 200
        assert schema_runs > cold_runs
        replaced_runs = schema_runs
        assert (await client.get(history)).status_code == 200
        assert schema_runs == replaced_runs


@pytest.mark.asyncio
async def test_hosted_schema_failure_rolls_back_and_retries(tmp_path, monkeypatch):
    from uuid import uuid4

    ctx = CloudStorageContext.for_owner(tmp_path, str(uuid4()))
    path = ctx.directory / 'data.db'
    migrations = storage.MIGRATIONS
    with storage_context(ctx):
        monkeypatch.setattr(storage, 'MIGRATIONS', [migrations[0], 'ALTER TABLE missing ADD COLUMN test TEXT'])
        with pytest.raises(sqlite3.OperationalError, match='no such table'):
            await storage.init_db()
        with closing(sqlite3.connect(path)) as db:
            assert not db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()

        monkeypatch.setattr(storage, 'MIGRATIONS', migrations)
        await storage.init_db()
        with closing(sqlite3.connect(path)) as db:
            columns = {row[1] for row in db.execute('PRAGMA table_info(session_settings)')}
            assert {'character_id', 'persona_id', 'world_id', 'intro', 'library_binding'} <= columns


@pytest.mark.asyncio
@pytest.mark.parametrize('migration_fails', [False, True])
async def test_restore_legacy_backup_migrates_before_immediate_sync_export(tmp_path, monkeypatch, migration_fails):
    cfg = config(tmp_path)
    app = create_app(cfg)
    owner = enroll(app)
    with app.state.store.transaction() as db:
        db.execute("UPDATE accounts SET plan='pro',plan_until=? WHERE id=?", (time.time() + 86400, owner))
    ctx = CloudStorageContext.for_owner(cfg.root / 'tenants', owner)
    with storage_context(ctx):
        await storage.init_db()
        path = ctx.directory / 'data.db'
        with sqlite3.connect(path) as db:
            db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('legacy','user','keep me')")
            db.execute('DROP TABLE session_scopes')
            db.execute('DROP TABLE conversation_summaries')
        backup_id = Backups(app.state.store).create(owner, path, force=True)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url=cfg.origin,
                                headers={'Origin': cfg.origin}, cookies={SESSION_COOKIE: 'browser'}) as client:
        # Initialize this owner before restoring, so lazy initialization cannot hide the defect.
        assert (await client.get('/api/chat/history?session_id=legacy')).status_code == 200
        original_init = storage.init_db
        attempts = 0
        async def migrate():
            nonlocal attempts
            attempts += 1
            if migration_fails and attempts == 1:
                raise RuntimeError('temporary migration failure')
            await original_init()
        monkeypatch.setattr(storage, 'init_db', migrate)
        response = await client.post(f'/api/cloud/backups/{backup_id}/restore')
        assert response.status_code == (503 if migration_fails else 200), response.text
        assert (await client.get('/api/chat/history?session_id=legacy')).status_code == 200
        assert attempts == (2 if migration_fails else 1)
        with storage_context(ctx):
            snapshot = export_snapshot(path)
            assert snapshot['tables']['session_scopes'] == []
            assert snapshot['tables']['conversation_summaries'] == []
            assert any(row['content'] == 'keep me' for row in snapshot['tables']['chat_history'])


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", [False, True])
async def test_cloud_memory_quote_ignores_only_retrieval_duration(tmp_path, monkeypatch, changed):
    calls = []
    def respond(request):
        calls.append(request)
        if json.loads(request.content)["stream"]:
            return generation_response(VALID_OUTPUT, {"prompt_tokens": 40, "completion_tokens": 40, "cost": 0.000001})
        return screened_response(0.000001, case="valid")

    cfg = config(tmp_path)
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = enroll(app)
    ctx = CloudStorageContext.for_owner(cfg.root / "tenants", owner)
    with storage_context(ctx):
        await storage.init_db()
        scope = await memories.session_scope({"session_id": "quoted-memory"})
        await memories.set_session_enabled("quoted-memory", True)
        item = await memories.create(scope, "semantic", "favorite flower")
        original = memories.prepare
        durations = iter([1.0, 999.123])
        async def timed(*args, **kwargs):
            value = await original(*args, **kwargs)
            value["trace"]["retrieval_ms"] = next(durations)
            return value
        monkeypatch.setattr(memories, "prepare", timed)
        req = CloudChat(model_id="cloud-standard", session_id="quoted-memory",
                        messages=[{"role": "user", "content": "favorite flower"}])
        quote = await app.state.jobs.quote(owner, req)
        req = req.model_copy(update={"quote_id": quote["quote_id"], "max_credits": quote["max_credits"]})
        if changed:
            with sqlite3.connect(ctx.directory / "data.db") as db:
                db.execute("UPDATE memories SET content='changed flower' WHERE id=?", (item["id"],))
            with pytest.raises(CloudError, match="quote_expired"):
                await app.state.jobs.start(owner, req)
            assert not calls
        else:
            result = await (await app.state.jobs.start(owner, req))
            assert result["status"] == "completed", result
            assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["prepare", "reserve"])
async def test_cloud_erasure_fences_prepared_memory_before_reservation(tmp_path, monkeypatch, phase):
    from python.storage import generations

    calls = []
    def respond(request):
        calls.append(request)
        return screened_response(0.000001, case="valid")

    cfg = config(tmp_path)
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = enroll(app)
    ctx = CloudStorageContext.for_owner(cfg.root / "tenants", owner)
    with storage_context(ctx):
        await storage.init_db()
        scope = await memories.session_scope({"session_id": "target"})
        await memories.set_session_enabled("target", True)
        await memories.create(scope, "semantic", "private cached secret", source_session_id="source")
        req = CloudChat(model_id="cloud-standard", session_id="target",
                        messages=[{"role": "user", "content": "private cached secret"}])
        quote = await app.state.jobs.quote(owner, req)
        req = req.model_copy(update={"quote_id": quote["quote_id"], "max_credits": quote["max_credits"]})
        balance = app.state.store.balance(owner)
        original_prepare = app.state.jobs.prepare
        original_reserve = generations.reserve

        async def prepare(*args, **kwargs):
            value = await original_prepare(*args, **kwargs)
            assert value["memory"]["trace"]["injected"]
            if phase == "prepare":
                await conversation.purge("source", cloud_revision=(app.state.store.path, owner))
            return value

        async def reserve(*args, **kwargs):
            if phase == "reserve":
                await conversation.purge("source", cloud_revision=(app.state.store.path, owner))
            return await original_reserve(*args, **kwargs)

        monkeypatch.setattr(app.state.jobs, "prepare", prepare)
        monkeypatch.setattr(generations, "reserve", reserve)
        with pytest.raises(CloudError, match="generation_context_changed") as error:
            await app.state.jobs.start(owner, req)
        assert error.value.status == 409
        assert not calls and not app.state.jobs.tasks
        assert (await generations.status(req.generation_id, "target"))["status"] == "not_found"
        assert app.state.store.balance(owner) == balance
        with app.state.store.transaction() as control:
            row = control.execute("SELECT state,actual_cost,charged_credits FROM operations WHERE id=?",
                                  (req.generation_id,)).fetchone()
            assert tuple(row) == ("failed", 0, 0)


@pytest.mark.asyncio
async def test_legacy_memory_paged_sync_preserves_wire_and_replay(tmp_path):
    cfg = config(tmp_path)
    app = create_app(cfg)
    owner = enroll(app)
    transfers = Transfers(app.state.store, app.state.sync)
    app.state.sync.settings(owner, "selected")
    ctx = CloudStorageContext.for_owner(cfg.root / "tenants", owner)
    with storage_context(ctx):
        await storage.init_db()
        path = ctx.directory / "data.db"
        scope = await memories.session_scope({"session_id": "legacy"})
        memory = await memories.create(scope, "semantic", "legacy memory")
        snapshot = export_snapshot(path, ["legacy"])
        for row in snapshot["tables"]["memories"]:
            for field in ("source_kind", "source_quote", "source_revision", "source_message_ids", "confirmation"):
                row.pop(field)
        wire = json.loads(json.dumps(snapshot))
        # Validation and insertion must not mutate caller rows or their wire hash.
        apply_snapshot(path, snapshot)
        assert snapshot == wire
        for _ in range(2):
            assert app.state.sync.push(owner, path, request_id="legacy-inline", base_revision=0, snapshot=snapshot) == {"revision": 1}
            assert snapshot == wire
        transfer = transfers.create(owner, direction="upload", selected=["legacy"], revision=1, request_id="legacy-pages")
        for index, page in enumerate({"table": table, "rows": rows} for table, rows in wire["tables"].items() if rows):
            original = json.loads(json.dumps(page))
            transfers.validate_page(owner, transfer, page, path)
            assert page == original
            transfers.append(owner, transfer, index, page)
            assert transfers.has_page(owner, transfer, index, original)
        meta = transfers.inspect(owner, transfer)
        # PageRows decodes fresh dictionaries on every pass; defaults must apply each time.
        assert list(transfers.snapshot(owner, transfer)["tables"]["memories"]) == wire["tables"]["memories"]
        transfers.check_capacity(owner, transfer, path)
        result = transfers.commit(owner, transfer, path, pages=meta["next"], chain=meta["chain"])
        assert result == {"revision": 2}
        assert transfers.commit(owner, transfer, path, pages=meta["next"], chain=meta["chain"]) == result
        with sqlite3.connect(path) as db:
            row = db.execute("SELECT source_kind,source_quote,source_revision,source_message_ids,confirmation FROM memories WHERE id=?",
                             (memory["id"],)).fetchone()
            assert row == ("user_statement", "", None, "[]", "unverified")


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", [{"unknown_provenance": "value"}, {"source_message_ids": "[true]"}])
async def test_legacy_memory_invalid_fields_rejected_without_mutation(isolated, invalid):
    scope = await memories.session_scope({"session_id": "legacy"})
    await memories.create(scope, "semantic", "original")
    before = export_snapshot(storage.DB_PATH)
    snapshot = json.loads(json.dumps(before))
    row = snapshot["tables"]["memories"][0]
    for field in ("source_kind", "source_quote", "source_revision", "source_message_ids", "confirmation"):
        row.pop(field)
    row.update(invalid)
    wire = json.loads(json.dumps(snapshot))
    with pytest.raises(CloudError, match="sync_schema_mismatch|invalid_sync_message_sources"):
        apply_snapshot(storage.DB_PATH, snapshot)
    assert snapshot == wire
    assert export_snapshot(storage.DB_PATH) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("table,field,value", [
    ("conversation_summaries", "source_message_ids", "not-json"),
    ("conversation_summaries", "source_message_ids", '[true]'),
    ("conversation_summaries", "source_message_ids", '[1,1]'),
    ("conversation_summaries", "kind", "unknown"),
    ("conversation_summaries", "method", "unknown"),
    ("conversation_summaries", "revision", 0),
    ("session_scopes", "identity_json", '[]'),
    ("session_scopes", "identity_json", '{"versions":[]}'),
    ("memories", "source_message_ids", '{}'),
])
async def test_sync_rejects_invalid_context_without_changing_database(isolated, table, field, value):
    scope = await memories.session_scope({"session_id":"sources"})
    await memories.create(scope, "semantic", "original memory")
    with sqlite3.connect(storage.DB_PATH) as db:
        for index in range(20):
            db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('sources',?,?)",
                       ("user" if index%2==0 else "assistant", f"message-{index}"))
    from python.storage import generations
    async with generations.transaction() as db:
        await conversation.refresh(db, "sources")
    before = export_snapshot(storage.DB_PATH)
    invalid = json.loads(json.dumps(before))
    invalid["tables"][table][0][field] = value
    with pytest.raises(CloudError, match="invalid_sync"):
        apply_snapshot(storage.DB_PATH, invalid)
    assert export_snapshot(storage.DB_PATH) == before
    assert (await conversation.context("sources"))["summaries"]


@pytest.mark.asyncio
@pytest.mark.parametrize("deny_output", [False, True])
async def test_cloud_regenerate_preserves_original_until_screened_and_replays(tmp_path, deny_output):
    calls=[]
    safety_count=0
    def respond(request):
        nonlocal safety_count
        body=json.loads(request.content)
        calls.append(body)
        if body["stream"]:
            if deny_output and len(calls)==2:
                return httpx.Response(429,json={"usage":{"prompt_tokens":1,"completion_tokens":0,"cost":0},"error":{"code":429}})
            output=json.loads(VALID_OUTPUT)
            output["reply"]="original" if len(calls)<2 else "replacement"
            return generation_response(json.dumps(output), {"prompt_tokens":40,"completion_tokens":40,"cost":0.000001})
        safety_count+=1
        if deny_output and safety_count==4:
            value=screened_response(0.000001,case="valid").json()
            value["choices"][0]["message"]["content"]='{"sfw":false}'
            return httpx.Response(200,json=value)
        return screened_response(0.000001,case="valid")
    cfg=config(tmp_path)
    app=create_app(cfg,transport=httpx.MockTransport(respond))
    owner=enroll(app)
    context=CloudStorageContext.for_owner(cfg.root/"tenants",owner)
    with storage_context(context):
        await storage.init_db()
        req=CloudChat(model_id="cloud-standard",session_id="parity",messages=[{"role":"user","content":"hello"}])
        quote=await app.state.jobs.quote(owner,req)
        req=req.model_copy(update={"quote_id":quote["quote_id"],"max_credits":quote["max_credits"]})
        original=await (await app.state.jobs.start(owner,req))
        assert original["status"]=="completed", original
        before_balance=app.state.store.balance(owner)
        revision=await conversation.revision("parity")
        regen=CloudChat(model_id="cloud-standard",session_id="parity",context_mode="stored",history_revision=revision,
                        regenerate_message_id=original["assistant_id"],messages=[{"role":"user","content":"hello"}])
        quote=await app.state.jobs.quote(owner,regen)
        regen=regen.model_copy(update={"quote_id":quote["quote_id"],"max_credits":quote["max_credits"]})
        result=await (await app.state.jobs.start(owner,regen))
        assert result["status"] == ("failed" if deny_output else "completed"), result
        path=context.directory/"data.db"
        with sqlite3.connect(path) as db:
            history=db.execute("SELECT id,role,content FROM chat_history WHERE session_id='parity' ORDER BY id").fetchall()
            assert len(history)==2 and history[-1][0]==original["assistant_id"]
            assert history[-1][2]==("original" if deny_output else "replacement")
        count=len(calls)
        replay=await (await app.state.jobs.start(owner,regen))
        assert replay["reply"]==result["reply"] and len(calls)==count
        if deny_output:
            assert app.state.store.balance(owner)==before_balance and result["charged_credits"]==0
            assert result["error"]=="provider_rate_limited"
        else:
            assert result["state"]["turn"]==1
            assert set(result["telemetry"]["cloud_stages_ms"])=={"queue","generation","save"}
        progress=app.state.jobs.progress[(owner,regen.generation_id)]
        assert set(progress)=={"stage","elapsed_ms"}
        with app.state.store.transaction() as control:
            assert control.execute("SELECT actual_cost FROM operations WHERE id=?",(regen.generation_id,)).fetchone()[0] == (0 if deny_output else 1000)


@pytest.mark.asyncio
async def test_pinned_scope_summary_sync_legacy_and_erasure_restore(tmp_path):
    cfg=config(tmp_path)
    app=create_app(cfg)
    owner=enroll(app)
    with app.state.store.transaction() as control:
        control.execute("UPDATE accounts SET plan='pro',plan_until=? WHERE id=?",(time.time()+86400,owner))
    context=CloudStorageContext.for_owner(cfg.root/"tenants",owner)
    with storage_context(context):
        await storage.init_db()
        scope=await memories.session_scope({"session_id":"erase-me","character_id":"mocha_sfw","world_id":"beast_world"})
        await memories.create(scope,"semantic","manual world memory")
        await memories.create("session:erase-me","semantic","manual session memory")
        path=context.directory/"data.db"
        with sqlite3.connect(path) as db:
            for index in range(20):
                db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('erase-me',?,?)",
                           ("user" if index%2==0 else "assistant",f"text-{index}"))
        from python.storage import generations
        async with generations.transaction() as db:
            await conversation.refresh(db,"erase-me")
        snapshot=export_snapshot(path,["erase-me"])
        assert snapshot["tables"]["session_scopes"][0]["scope"]==scope
        assert any(m["scope"]==scope for m in snapshot["tables"]["memories"])
        assert snapshot["tables"]["conversation_summaries"]
        assert any(p["table"]=="session_scopes" for p in snapshot_pages(path,["erase-me"]))
        apply_snapshot(path,snapshot)
        backup=Backups(app.state.store)
        bid=backup.create(owner,path,force=True)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=cfg.origin,
                                    headers={"Origin":cfg.origin},cookies={SESSION_COOKIE:"browser"}) as client:
            result=await client.delete("/api/chat/sessions/erase-me/data")
            assert result.status_code==200,result.text
        backup.restore(owner,bid,path)
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT COUNT(*) FROM chat_history").fetchone()[0]==0
            assert db.execute("SELECT COUNT(*) FROM memories WHERE scope='session:erase-me'").fetchone()[0]==0
            assert db.execute("SELECT COUNT(*) FROM conversation_summaries").fetchone()[0]==0
            assert db.execute("SELECT COUNT(*) FROM session_deletions WHERE session_id='erase-me'").fetchone()[0]==1
        with pytest.raises(CloudError,match="erased_conversation"):
            apply_snapshot(path,snapshot)
        # Additive fields/tables from old snapshots still read with compatibility defaults.
        legacy=export_snapshot(path)
        for table in ("session_scopes","conversation_summaries","session_deletions"):
            legacy["tables"].pop(table)
        apply_snapshot(path,legacy)
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT COUNT(*) FROM session_deletions").fetchone()[0]==1


@pytest.mark.asyncio
async def test_publication_and_comment_replay_skip_paid_screening(tmp_path):
    calls=[]
    def respond(request):
        calls.append(request.url)
        return screened_response(0.000001,case="valid")
    cfg=replace(config(tmp_path),private_test=False,legal_approved=True,community_enabled=True,monthly_subsidy_jpy=3000)
    app=create_app(cfg,transport=httpx.MockTransport(respond))
    owner=enroll(app)
    from python.core.portable_schema import PortableDocument
    from python.storage.library import save_item
    context=CloudStorageContext.for_owner(cfg.root/"tenants",owner)
    with storage_context(context):
        await storage.init_db()
        item=save_item(PortableDocument(name="Original",data={"description":"public","secret":"never publish"}))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=cfg.origin,
                                headers={"Origin":cfg.origin},cookies={SESSION_COOKIE:"browser"}) as client:
        assert (await client.get("/api/capabilities")).json()["features"]["community"]
        body={"item_id":item.id,"revision":item.revision}
        work=await client.post("/api/community/works",json=body)
        assert work.status_code==200,work.text
        assert "never publish" not in work.text
        assert (await client.post("/api/community/works",json=body)).json()["id"]==work.json()["id"]
        assert len(calls)==0
        from uuid import uuid4
        comment={"text":"original comment","request_id":str(uuid4())}
        url=f"/api/community/works/{work.json()['id']}/comments"
        first=await client.post(url,json=comment)
        second=await client.post(url,json=comment)
        assert first.status_code==second.status_code==200 and len(second.json()["comments"])==1
        assert len(calls)==0
        assert (await client.post(url,json={**comment,"text":"edited replay"})).status_code==409
        assert (await client.post(url,json=[])).status_code==400
        assert len(calls)==0
