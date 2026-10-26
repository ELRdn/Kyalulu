"""Disposable tenant fixtures only; no provider calls and no user databases."""
import json
import sqlite3
from uuid import uuid4

import pytest

from python.cloud.config import CloudConfig
from python.cloud.store import CloudStore, CloudError
from python.cloud.unified import UnifiedService
from python.storage import db as storage


@pytest.fixture
def bridge(tmp_path):
    service = UnifiedService(CloudStore(CloudConfig(root=tmp_path, origin='https://app.test', secret='s' * 32, unified_enabled=True)))
    owner = str(uuid4()); service.store.account(owner, consent='fixture')
    path = tmp_path / 'tenants' / owner / 'data.db'; path.parent.mkdir(parents=True)
    with sqlite3.connect(path) as db:
        db.executescript(storage.DDL)
        for sql in storage.MIGRATIONS:
            db.execute(sql)
        db.execute("INSERT INTO session_settings(session_id) VALUES('private')")
        db.execute("INSERT INTO chat_history(id,session_id,role,content) VALUES(77,'private','user','PRIVATE-DO-NOT-SYNC')")
    return service, owner, path


def change(text='device reply', base=0):
    return {'id': 'device-conversation', 'kind': 'conversation', 'base_revision': base, 'payload': {
        'storage_policy': 'sync', 'rating': 'general', 'settings': {'session_id': 'device-conversation'},
        'messages': [{'id': 1, 'uuid': 'user-uuid', 'role': 'user', 'content': 'tea'},
                     {'id': 2, 'uuid': 'reply-uuid', 'role': 'assistant', 'content': text}],
        'state': {'session_id': 'device-conversation', 'turn': 1, 'location': 'library'},
        'memories': [{'id': 'tea-memory', 'type': 'semantic', 'content': 'tea', 'origin': 'manual', 'supported': True,
                      'source_session_id': 'device-conversation', 'source_turn': 1, 'source_message_ids': [1]}],
        'summaries': [{'id': 'chapter-0', 'kind': 'chapter', 'ordinal': 0, 'text': 'tea', 'source_message_ids': [1, 2]}],
        'memory_enabled': True}}


def accept(service, owner, selected=()):
    service.configure_runtime(owner, 0, list(selected), True)


def test_no_implicit_runtime_read_or_projection_without_consent(bridge):
    service, owner, path = bridge
    assert service.runtime_consent(owner)['accepted'] is False
    service.push(owner, 'no-consent', [change()], runtime_path=path)
    assert service.pull(owner, runtime_path=path)['changes'][0]['id'] == 'device-conversation'
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0] == 1
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='unified_runtime_links'").fetchone()


def test_projection_is_an_additive_copy_with_legacy_ids_untouched_and_replay_safe(bridge):
    service, owner, path = bridge; accept(service, owner)
    first = service.push(owner, 'first', [change()], runtime_path=path)
    assert first == service.push(owner, 'first', [change()], runtime_path=path)
    sid = first['changes'][0]['runtime_session_id']
    assert sid != 'private'
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT id,content FROM chat_history WHERE session_id='private'").fetchone() == (77, 'PRIVATE-DO-NOT-SYNC')
        rows = db.execute('SELECT id,content FROM chat_history WHERE session_id=? ORDER BY id', (sid,)).fetchall()
        assert [r[1] for r in rows] == ['tea', 'device reply'] and rows[0][0] > 77
        memory = db.execute('SELECT scope,source_message_ids,source_revision FROM memories WHERE scope=?', ('session:' + sid,)).fetchone()
        assert json.loads(memory[1]) == [rows[0][0]]
        assert json.loads(memory[2])['memory_id'] == 'tea-memory'
        assert db.execute('SELECT COUNT(*) FROM unified_runtime_links').fetchone()[0] == 1


def test_selected_export_excludes_other_sessions_and_shared_memories(bridge):
    service, owner, path = bridge
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO session_settings(session_id) VALUES('selected')")
        db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('selected','user','PUBLIC-FIXTURE')")
        db.execute("INSERT INTO memories(id,scope,type,content,source_session_id) VALUES('other','shared','semantic','PRIVATE-MEMORY','private')")
        db.execute("INSERT INTO memories(id,scope,type,content) VALUES('unknown','shared','semantic','UNATTRIBUTED-MEMORY')")
    accept(service, owner, ['selected'])
    first = service.pull(owner, runtime_path=path)
    assert len(first['changes']) == 1
    assert 'PUBLIC-FIXTURE' in json.dumps(first)
    assert 'PRIVATE' not in json.dumps(first) and 'UNATTRIBUTED' not in json.dumps(first)
    assert service.pull(owner, first['cursor'], runtime_path=path)['changes'] == []


def test_native_and_device_continuations_are_preserved_as_separate_copies(bridge):
    service, owner, path = bridge; accept(service, owner)
    sid = service.push(owner, 'initial', [change()], runtime_path=path)['changes'][0]['runtime_session_id']
    consent = service.runtime_consent(owner)
    service.configure_runtime(owner, consent['revision'], [sid], True)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE chat_history SET content='native continuation' WHERE session_id=? AND role='assistant'", (sid,))
    answer = service.push(owner, 'offline', [change('offline continuation', base=1)], runtime_path=path)['changes'][0]
    assert answer['branched'] and answer['id'] != 'device-conversation'
    assert answer['runtime_session_id'] != sid
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT content FROM chat_history WHERE session_id=? AND role='assistant'", (sid,)).fetchone()[0] == 'native continuation'
        assert db.execute("SELECT content FROM chat_history WHERE session_id=? AND role='assistant'", (answer['runtime_session_id'],)).fetchone()[0] == 'offline continuation'
    values = service.pull(owner, runtime_path=path)['changes']
    assert {c['payload']['messages'][-1]['content'] for c in values} == {'native continuation', 'offline continuation'}


def test_projection_and_receipt_rollback_together_on_invalid_dependency(bridge):
    service, owner, path = bridge; accept(service, owner)
    broken = change(); broken['payload']['settings']['library_binding'] = {'character': {'id': 'missing', 'revision': 1}}
    with pytest.raises(CloudError, match='sync_library_revision_missing'):
        service.push(owner, 'broken', [broken], runtime_path=path)
    assert service.pull(owner)['changes'] == []
    with service.store.transaction() as db:
        assert db.execute('SELECT COUNT(*) FROM app_sync_requests').fetchone()[0] == 0
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0] == 1


def test_round_trip_retains_message_memory_summary_ids_and_exact_library_revision(bridge):
    service, owner, path = bridge; accept(service, owner)
    incoming = change()
    incoming['payload']['memories'][0]['uuid'] = 'stable-memory'
    incoming['payload']['summaries'][0].update(text='[1:user] tea [2:assistant] reply', method='extractive')
    incoming['payload']['settings']['character_id'] = 'character'
    incoming['payload']['settings']['library_binding'] = {'character': {'id': 'character', 'revision': 3}}
    incoming['payload']['library_snapshots'] = {'character@3': {'name': 'Tea', 'data': {'personality': 'kind'}}}
    sid = service.push(owner, 'roundtrip', [incoming], runtime_path=path)['changes'][0]['runtime_session_id']
    service.configure_runtime(owner, 1, [sid], True)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE chat_history SET content='continued' WHERE session_id=? AND role='assistant'", (sid,))
    returned = service.pull(owner, runtime_path=path)['changes'][-1]['payload']
    assert [m['uuid'] for m in returned['messages']] == ['user-uuid', 'reply-uuid']
    assert returned['messages'][1]['revision'] == 2
    assert returned['memories'][0]['id'] == 'tea-memory' and returned['memories'][0]['uuid'] == 'stable-memory'
    assert returned['summaries'][0]['id'] == 'chapter-0'
    assert returned['summaries'][0]['text'] == '[1:user] tea [2:assistant] reply'
    assert returned['settings']['library_binding']['character'] == {'id': 'character', 'revision': 3}
    assert returned['library_snapshots']['character@3']['name'] == 'Tea'


def test_creator_snapshots_roundtrip_and_compile_with_their_pinned_revisions(bridge):
    from python.storage.context import CloudStorageContext, storage_context
    from python.core.prompt_compiler import compile_prompt
    from python.core import story
    service, owner, path = bridge; accept(service, owner)
    incoming = change()
    world, persona = 'created_' + 'a' * 32 + '@3', 'created_' + 'b' * 32 + '@1'
    incoming['payload']['settings'].update(world_id=world, persona_id=persona, character_id='character', library_binding={'character': {'id': 'character', 'revision': 1}})
    incoming['payload']['library_snapshots'] = {'character@1': {'name': 'Tea', 'data': {'personality': 'kind'}}}
    incoming['payload']['creator_snapshots'] = {
        world: {'kind': 'world', 'document': {'display_name': 'Harbor', 'rules': 'NO TELEPORT', 'cast': [{'id': 'captain', 'display_name': 'Captain', 'knowledge': 'Harbor only'}], 'rpg': {'initial_hp': 50}}},
        persona: {'kind': 'persona', 'document': {'display_name': 'Traveler', 'traits': 'knows maps'}},
    }
    sid = service.push(owner, 'creator-copy', [incoming], runtime_path=path)['changes'][0]['runtime_session_id']
    with sqlite3.connect(path) as db:
        db.row_factory = sqlite3.Row
        settings = dict(db.execute('SELECT * FROM session_settings WHERE session_id=?', (sid,)).fetchone())
        assert settings['world_id'] != world and settings['world_id'].endswith('@3')
        assert settings['persona_id'] != persona
        assert db.execute('SELECT COUNT(*) FROM creator_versions').fetchone()[0] == 2
    with storage_context(CloudStorageContext(owner, path.parent)):
        compiled = compile_prompt(character_id=settings['character_id'], world_id=settings['world_id'], persona_id=settings['persona_id'], library_binding=json.loads(settings['library_binding']))
        assert 'NO TELEPORT' in compiled.system_prompt and 'knows maps' in compiled.system_prompt
        cast, rpg = story.configuration(compiled)
        assert cast[0].knowledge == 'Harbor only' and rpg.initial_hp == 50
    service.configure_runtime(owner, 1, [sid], True)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE chat_history SET content='continued' WHERE session_id=? AND role='assistant'", (sid,))
    returned = service.pull(owner, runtime_path=path)['changes'][-1]['payload']
    assert returned['settings']['world_id'] == world and returned['settings']['persona_id'] == persona
    assert returned['creator_snapshots'][world]['document']['rules'] == 'NO TELEPORT'
    assert returned['creator_snapshots'][persona]['document']['traits'] == 'knows maps'
    assert returned['state']['world_id'] == world


@pytest.mark.parametrize('damage', ['missing', 'kind', 'script', 'duplicate_cast', 'wrong_reference'])
def test_invalid_creator_dependencies_roll_back_sync_receipt_and_native_copy(bridge, damage):
    service, owner, path = bridge; accept(service, owner)
    incoming = change(); reference = 'created_' + 'a' * 32 + '@1'
    incoming['payload']['settings']['world_id'] = reference
    document = {'display_name': 'World'}
    incoming['payload']['creator_snapshots'] = {reference: {'kind': 'world', 'document': document}}
    if damage == 'missing': incoming['payload']['creator_snapshots'] = {}
    elif damage == 'kind': incoming['payload']['creator_snapshots'][reference]['kind'] = 'persona'
    elif damage == 'script': document['script'] = 'never execute'
    elif damage == 'duplicate_cast': document['cast'] = [{'id': 'same', 'display_name': 'A'}] * 2
    else: incoming['payload']['settings']['world_id'] = 'created_broken@1'
    with pytest.raises(CloudError):
        service.push(owner, 'broken-creator', [incoming], runtime_path=path)
    assert service.pull(owner)['changes'] == []
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM creator_versions').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0] == 1


def test_deletion_and_pending_generation_fail_closed_without_touching_data(bridge):
    service, owner, path = bridge; accept(service, owner)
    service.push(owner, 'initial', [change()], runtime_path=path)
    deleted = {**change(base=1), 'deleted': True, 'payload': {}}
    with pytest.raises(CloudError, match='sync_delete_confirmation_required'):
        service.push(owner, 'delete', [deleted], runtime_path=path)
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0] == 3
        db.execute("INSERT INTO generations(generation_id,session_id,fingerprint,status) VALUES('pending','private','','pending')")
    with pytest.raises(CloudError, match='stop_generation_before_sync'):
        service.push(owner, 'pending', [change(base=1)], runtime_path=path)


def test_consent_is_account_scoped_versioned_and_revocable(bridge):
    service, owner, path = bridge; accept(service, owner, ['private'])
    with pytest.raises(CloudError, match='sync_consent_conflict'):
        service.configure_runtime(owner, 0, [], False)
    service.configure_runtime(owner, 1, [], False)
    assert service.pull(owner, runtime_path=path)['changes'] == []
    other = str(uuid4()); service.store.account(other, consent='fixture')
    assert not service.runtime_consent(other)['accepted']
    accept(service, other)
    with pytest.raises(CloudError, match='invalid_sync_runtime_scope'):
        service.pull(other, runtime_path=path)


def deletion(base=1):
    return {**change(base=base), 'payload': {}, 'deleted': True, 'delete_confirmed': True}


def test_confirmed_erasure_is_replay_safe_and_old_updates_acknowledge_the_tombstone(bridge):
    service, owner, path = bridge; accept(service, owner)
    sid = service.push(owner, 'initial', [change()], runtime_path=path)['changes'][0]['runtime_session_id']
    first = service.push(owner, 'erase', [deletion()], runtime_path=path)
    assert first == service.push(owner, 'erase', [deletion()], runtime_path=path)
    assert service.push(owner, 'old-offline-write', [change(base=1)], runtime_path=path)['changes'][0]['deleted']
    assert service.pull(owner, runtime_path=path)['changes'][-1]['payload'] == {}
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM chat_history WHERE session_id=?', (sid,)).fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM memories WHERE source_session_id=?', (sid,)).fetchone()[0] == 0
        assert db.execute('SELECT 1 FROM session_deletions WHERE session_id=?', (sid,)).fetchone()
        assert db.execute('SELECT content FROM chat_history WHERE id=77').fetchone()[0] == 'PRIVATE-DO-NOT-SYNC'


def test_confirmed_erasure_remains_possible_when_the_account_is_over_quota(bridge, monkeypatch):
    from types import SimpleNamespace
    service, owner, path = bridge; accept(service, owner)
    service.push(owner, 'initial', [change()], runtime_path=path)
    monkeypatch.setattr(service.store, 'entitlements', lambda _: SimpleNamespace(storage_bytes=1))
    assert service.push(owner, 'erase-over-quota', [deletion()], runtime_path=path)['changes'][0]['deleted']
    assert service.pull(owner, runtime_path=path)['changes'][-1]['deleted']


def test_over_quota_native_edits_are_deferred_without_blocking_erasure_or_downloads(bridge, monkeypatch):
    from types import SimpleNamespace
    service, owner, path = bridge; accept(service, owner)
    sid = service.push(owner, 'initial', [change()], runtime_path=path)['changes'][0]['runtime_session_id']
    service.configure_runtime(owner, 1, [sid], True)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE chat_history SET content='UNSENT-OVER-QUOTA' WHERE session_id=? AND role='assistant'", (sid,))
    monkeypatch.setattr(service.store, 'entitlements', lambda _: SimpleNamespace(storage_bytes=1))
    result = service.pull(owner, runtime_path=path)
    assert result['upload_blocked'] == 'cloud_storage_full' and result['changes'][-1]['revision'] == 1
    assert service.push(owner, 'erase-over-quota', [deletion()], runtime_path=path)['changes'][0]['deleted']
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT content FROM chat_history WHERE session_id=? AND role='assistant'", (sid,)).fetchone()[0] == 'UNSENT-OVER-QUOTA'


def test_erasure_preserves_unselected_native_edits_as_local_recovery_without_upload(bridge):
    service, owner, path = bridge; accept(service, owner)
    sid = service.push(owner, 'initial', [change()], runtime_path=path)['changes'][0]['runtime_session_id']
    with sqlite3.connect(path) as db:
        db.execute("UPDATE chat_history SET content='UNSENT-LOCAL-EDIT' WHERE session_id=? AND role='assistant'", (sid,))
    service.push(owner, 'erase', [deletion()], runtime_path=path)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT content FROM chat_history WHERE session_id=? AND role='assistant'", (sid,)).fetchone()[0] == 'UNSENT-LOCAL-EDIT'
        link = db.execute('SELECT entity_id,revision,mapping FROM unified_runtime_links WHERE session_id=?', (sid,)).fetchone()
        assert link[0] != 'device-conversation' and link[1] == 0
        assert json.loads(link[2])['recovery_from'] == 'device-conversation'
        assert not db.execute('SELECT 1 FROM session_deletions WHERE session_id=?', (sid,)).fetchone()
    assert 'UNSENT-LOCAL-EDIT' not in json.dumps(service.pull(owner, runtime_path=path))


def test_selected_native_update_requires_another_confirmation_before_erasure(bridge):
    service, owner, path = bridge; accept(service, owner)
    sid = service.push(owner, 'initial', [change()], runtime_path=path)['changes'][0]['runtime_session_id']
    service.configure_runtime(owner, 1, [sid], True)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE chat_history SET content='new Cloud turn' WHERE session_id=? AND role='assistant'", (sid,))
    with pytest.raises(CloudError, match='sync_revision_conflict'):
        service.push(owner, 'stale-erase', [deletion()], runtime_path=path)
    with service.store.transaction() as db:
        assert not db.execute('SELECT 1 FROM app_entity_deletions').fetchone()
    latest = service.pull(owner, runtime_path=path)['changes'][-1]
    assert latest['revision'] == 2
    service.push(owner, 'confirmed-latest', [deletion(2)], runtime_path=path)
    assert service.runtime_consent(owner)['selected'] == []


@pytest.mark.asyncio
async def test_native_purge_updates_entity_tombstone_in_the_same_transaction(bridge):
    from python.storage import conversation
    from python.storage.context import CloudStorageContext, storage_context
    service, owner, path = bridge; accept(service, owner)
    sid = service.push(owner, 'initial', [change()], runtime_path=path)['changes'][0]['runtime_session_id']
    with storage_context(CloudStorageContext(owner, path.parent)):
        await conversation.purge(sid, cloud_revision=(service.store.path, owner, service.store.encrypt('{}')))
    assert service.pull(owner)['changes'][-1]['deleted']
    with service.store.transaction() as db:
        assert not db.execute('SELECT 1 FROM app_entity_history WHERE owner=?', (owner,)).fetchone()
    assert service.push(owner, 'offline-after-purge', [change(base=1)], runtime_path=path)['changes'][0]['deleted']


def test_backup_and_legacy_snapshot_cannot_resurrect_confirmed_erasure(bridge, monkeypatch):
    from dataclasses import replace
    from python.cloud.backups import Backups
    from python.cloud.sync import export_snapshot, apply_snapshot
    from python.cloud.contracts import PLANS
    service, owner, path = bridge; accept(service, owner)
    service.store.config = replace(service.store.config, backup_root=path.parent.parent.parent / 'fixture-backups')
    monkeypatch.setattr(service.store, 'entitlements', lambda _: PLANS['plus'])
    sid = service.push(owner, 'initial', [change()], runtime_path=path)['changes'][0]['runtime_session_id']
    backup = Backups(service.store); bid = backup.create(owner, path)
    snapshot = export_snapshot(path)
    service.push(owner, 'erase', [deletion()], runtime_path=path)
    with pytest.raises(CloudError, match='erased_conversation_cannot_be_restored'):
        apply_snapshot(path, snapshot)
    backup.restore(owner, bid, path)
    with sqlite3.connect(path) as db:
        assert not db.execute('SELECT 1 FROM chat_history WHERE session_id=?', (sid,)).fetchone()
    assert service.push(owner, 'late', [change(base=1)], runtime_path=path)['changes'][0]['deleted']


def test_legacy_replacement_requires_fresh_consent_and_exports_an_independent_restored_copy(bridge):
    from python.cloud.sync import export_snapshot, apply_snapshot
    service, owner, path = bridge; accept(service, owner)
    sid = service.push(owner, 'initial', [change()], runtime_path=path)['changes'][0]['runtime_session_id']
    service.configure_runtime(owner, 1, [sid], True)
    snapshot = export_snapshot(path)
    for row in snapshot['tables']['chat_history']:
        if row['session_id'] == sid and row['role'] == 'assistant':
            row['content'] = 'RESTORED-FIXTURE'
    apply_snapshot(path, snapshot)
    with pytest.raises(CloudError, match='sync_restored_session_confirmation_required'):
        service.pull(owner, runtime_path=path)
    service.configure_runtime(owner, 2, [sid], True, runtime_path=path)
    values = {c['id']: c['payload'] for c in service.pull(owner, runtime_path=path)['changes']}
    assert values['device-conversation']['messages'][-1]['content'] == 'device reply'
    assert any(v['messages'][-1]['content'] == 'RESTORED-FIXTURE' for k, v in values.items() if k != 'device-conversation')


def test_on_demand_entity_lookup_is_owner_scoped_and_carries_durable_deletions(bridge):
    service, owner, path = bridge
    service.push(owner, 'initial', [change()])
    assert service.read_entity(owner, 'device-conversation')['payload']['messages'][-1]['content'] == 'device reply'
    other = str(uuid4());service.store.account(other, consent='fixture')
    with pytest.raises(CloudError, match='sync_entity_not_found'):
        service.read_entity(other, 'device-conversation')
    service.push(owner, 'erase', [deletion()])
    assert service.read_entity(owner, 'device-conversation')['deleted']
    assert service.read_entity(owner, 'device-conversation')['payload'] == {}


@pytest.mark.asyncio
async def test_imported_history_without_snapshots_cannot_branch_or_regenerate(bridge):
    from python.storage import conversation, generations
    from python.storage.context import CloudStorageContext, storage_context
    service, owner, path = bridge; accept(service, owner)
    sid = service.push(owner, 'initial', [change()], runtime_path=path)['changes'][0]['runtime_session_id']
    with sqlite3.connect(path) as db:
        before = db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0]
        message = db.execute('SELECT MAX(id) FROM chat_history WHERE session_id=?', (sid,)).fetchone()[0]
    with storage_context(CloudStorageContext(owner, path.parent)):
        with pytest.raises(generations.Conflict, match='Historical state is unavailable'):
            await conversation.branch(sid, message)
        with pytest.raises(generations.Conflict, match='Historical state is unavailable'):
            await generations.state_before(sid, message, {})
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0] == before
        assert not db.execute("SELECT 1 FROM session_settings WHERE session_id LIKE 'branch_%'").fetchone()


def test_native_quota_failure_rolls_back_projection_and_receipt(bridge, monkeypatch):
    from types import SimpleNamespace
    service, owner, path = bridge; accept(service, owner)
    monkeypatch.setattr(service.store, 'entitlements', lambda _: SimpleNamespace(storage_bytes=20_000))
    with pytest.raises(CloudError, match='cloud_storage_full'):
        service.push(owner, 'full', [change()], runtime_path=path)
    assert service.pull(owner)['changes'] == []
    with service.store.transaction() as db:
        assert db.execute('SELECT COUNT(*) FROM app_sync_requests').fetchone()[0] == 0
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0] == 1


@pytest.mark.parametrize('damage', ['duplicate', 'source', 'library'])
def test_malformed_projection_is_rejected_atomically(bridge, damage):
    service, owner, path = bridge; accept(service, owner)
    broken = change()
    if damage == 'duplicate':
        broken['payload']['messages'][1]['uuid'] = 'user-uuid'
    elif damage == 'source':
        broken['payload']['memories'][0]['source_message_ids'] = [999]
    else:
        broken['payload']['settings']['library_binding'] = {'character': {'id': 'character', 'revision': 1}}
        broken['payload']['library_snapshots'] = {'character@1': {'name': 'Adult', 'nsfw': True}}
    with pytest.raises(CloudError):
        service.push(owner, damage, [broken], runtime_path=path)
    assert service.pull(owner)['changes'] == []
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0] == 1


@pytest.mark.asyncio
async def test_authenticated_http_selection_copy_replay_revoke_and_account_header(bridge):
    import httpx
    from dataclasses import replace
    from python.cloud.app import create_app
    from python.cloud.auth import provider_consent_version, SESSION_COOKIE
    service, owner, path = bridge
    config = replace(service.store.config, backup_root=service.store.config.root / 'fixture-backups',
                     region_policies=(('JP', {'accepted': True, 'version': 'fixture'}),))
    app = create_app(config, transport=httpx.MockTransport(lambda _: pytest.fail('No external provider calls')))
    store, unified = app.state.store, app.state.unified
    store.account(owner, consent=provider_consent_version(config))
    store.secret(owner, 'app-eligibility', json.dumps({'country': 'JP', 'age_band': 'adult', 'policy': 'fixture'}))
    app.state.auth.save('fixture-session', owner, {'access_token': 'fixture', 'refresh_token': 'fixture', 'expires_in': 3600})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=config.origin,
                                headers={'Origin': config.origin, 'X-Kyalulu-Owner': owner},
                                cookies={SESSION_COOKIE: 'fixture-session'}) as client:
        assert (await client.get('/api/cloud/app/runtime-consent')).json()['accepted'] is False
        denied = await client.put('/api/cloud/app/runtime-consent', headers={'X-Kyalulu-Owner': str(uuid4())},
                                  json={'revision': 0, 'selected': ['private'], 'consent': True})
        assert denied.status_code == 403 and denied.json()['error'] == 'sync_account_changed'
        assert not unified.runtime_consent(owner)['accepted']
        accepted = await client.put('/api/cloud/app/runtime-consent', json={'revision': 0, 'selected': [], 'consent': True})
        assert accepted.status_code == 200
        body = {'request_id': 'http-copy', 'changes': [change()]}
        first = await client.post('/api/cloud/app/sync', json=body)
        assert first.status_code == 200, first.text
        fetched = await client.get('/api/cloud/app/entities/device-conversation')
        assert fetched.status_code == 200 and fetched.json()['revision'] == 1
        assert (await client.get('/api/cloud/app/entities/device-conversation', headers={'X-Kyalulu-Owner': str(uuid4())})).status_code == 403
        assert (await client.post('/api/cloud/app/sync', json=body)).json() == first.json()
        sid = first.json()['changes'][0]['runtime_session_id']
        sessions = (await client.get('/api/chat/sessions')).json()['sessions']
        assert next(s for s in sessions if s['session_id'] == sid)['sync_copy']['revision'] == 1
        history = (await client.get('/api/chat/history', params={'session_id': sid})).json()['history']
        assert [m['content'] for m in history] == ['tea', 'device reply']
        assert (await client.post(f'/api/chat/sessions/{sid}/branch', json={'message_id': history[-1]['id']})).status_code == 409
        conflict = await client.put('/api/cloud/app/runtime-consent', json={'revision': 0, 'selected': [], 'consent': True})
        assert conflict.status_code == 409
        assert (await client.post('/api/cloud/app/sync', json=[])).status_code == 400
        assert (await client.put('/api/cloud/app/runtime-consent', json={'revision': 1, 'selected': [], 'consent': False})).status_code == 200
        await client.post('/api/cloud/app/sync', json={'request_id': 'after-revoke', 'changes': [change('kept as entity', base=1)]})
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM unified_runtime_links').fetchone()[0] == 1
        assert db.execute("SELECT content FROM chat_history WHERE id=77").fetchone()[0] == 'PRIVATE-DO-NOT-SYNC'
