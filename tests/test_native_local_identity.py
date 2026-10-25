"""Unenrolled branches keep local proofs; enrollment never guesses old ancestry."""
import json
import sqlite3
import pytest
from test_native_sync_client import pc, enrolled
from test_native_sync_scopes import accounts
from python.cloud.store import CloudError
from python.storage import conversation, generations, memories, entity_bridge


async def local_branch(pc):
    async with generations.transaction() as db:
        for index in range(19):
            await db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('selected',?,?)", ('assistant' if index % 2 == 0 else 'user', f'Local turn {index}'))
        ids = [row[0] for row in await (await db.execute("SELECT id FROM chat_history WHERE session_id='selected' ORDER BY id")).fetchall()]
        await db.execute("INSERT INTO session_scopes VALUES('selected','session:selected','legacy','{}')")
        await memories._create(db, 'session:selected', 'semantic', 'Original memory', 'user', True, 'selected', None, None, source_message_ids=[ids[0]])
        await db.execute("INSERT INTO conversation_summaries VALUES('local-summary','selected','chapter','Original summary',1,?,'user_edited',0)", (json.dumps(ids),))
    copied = (await conversation.branch('selected', ids[-1]))['session_id']
    return copied, ids


@pytest.mark.asyncio
async def test_pre_enrollment_branch_keeps_message_memory_summary_identity_without_implicit_upload(accounts, pc):
    copied, native_ids = await local_branch(pc)
    with sqlite3.connect(pc) as db:
        before = db.execute('SELECT id,session_id,content FROM chat_history ORDER BY id').fetchall()
        assert db.execute('SELECT COUNT(*) FROM unified_local_links').fetchone()[0] == 2
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='unified_native_owners'").fetchone()
    sync = await enrolled(accounts, pc)
    sync.configure(['selected'], True, consent=True)
    staged = sync.stage()
    assert len(staged['changes']) == 1 and staged['changes'][0]['payload']['messages'][0]['content'] == 'SELECTED'
    # Compare explicitly requested captures without uploading the branch.
    with sync.transaction() as db:
        captures = entity_bridge.capture(db, ['selected', copied], sync.namespace)
    original, branch = [change['payload'] for change in captures]
    assert [m['uuid'] for m in original['messages']] == [m['uuid'] for m in branch['messages']]
    assert original['memories'][0]['uuid'] == branch['memories'][0]['uuid']
    assert original['summaries'][0]['id'] == branch['summaries'][0]['id']
    assert branch['branch_of'] == original['settings']['session_id'] and branch['fork_revision'] == 0
    assert branch['fork_message_uuid'] == original['messages'][-1]['uuid']
    assert 'local_parent_session' not in branch and 'NEVER UPLOAD' not in json.dumps(captures)
    for payload in (original, branch): entity_bridge.validate(payload)
    with sqlite3.connect(pc) as db:
        assert db.execute('SELECT id,session_id,content FROM chat_history ORDER BY id').fetchall() == before
        assert db.execute("SELECT id FROM chat_history WHERE session_id='selected' ORDER BY id").fetchall() == [(i,) for i in native_ids]
    other = await enrolled(accounts, pc, 1)
    with pytest.raises(CloudError, match='sync_account_copy_required'):
        other.configure([copied], True, consent=True)


@pytest.mark.asyncio
async def test_late_branch_enrollment_uses_recorded_parent_and_never_merges_later_memory(accounts, pc):
    copied, _ = await local_branch(pc)
    sync = await enrolled(accounts, pc)
    sync.configure(['selected'], True, consent=True)
    await sync.run()
    app, owners = accounts
    original = app.state.unified.pull(owners[0])['changes'][0]
    with sqlite3.connect(pc) as db:
        db.execute("UPDATE memories SET content='Parent continuation',version=2 WHERE source_session_id='selected'")
    sync.configure(['selected', copied], True, consent=True)
    await sync.run()
    payloads = {change['id']: change['payload'] for change in app.state.unified.pull(owners[0])['changes']}
    branch = next(value for key, value in payloads.items() if key != original['id'])
    assert branch['branch_of'] == original['id'] and branch['fork_revision'] == 1
    assert branch['lineage']['status'] == 'verified' and branch['lineage']['common_messages'] == 20
    assert branch['memories'][0]['content'] == 'Original memory'
    assert payloads[original['id']]['memories'][0]['content'] == 'Parent continuation'
    assert sync.stage() is None


@pytest.mark.asyncio
async def test_legacy_rows_with_equal_text_are_independent_without_a_saved_fork(accounts, pc):
    with sqlite3.connect(pc) as db:
        db.execute("INSERT INTO session_settings(session_id) VALUES('legacy-copy')")
        db.execute("INSERT INTO chat_history(session_id,role,content) SELECT 'legacy-copy',role,content FROM chat_history WHERE session_id='selected'")
        db.execute('DROP TABLE IF EXISTS unified_local_links')
    sync = await enrolled(accounts, pc)
    sync.configure(['selected', 'legacy-copy'], True, consent=True)
    changes = sync.stage()['changes']
    left, right = [change['payload'] for change in changes]
    assert left['messages'][0]['uuid'] != right['messages'][0]['uuid']
    assert 'branch_of' not in right and 'branch_of' not in left


@pytest.mark.asyncio
async def test_corrupt_local_identity_rolls_back_the_complete_branch(pc):
    await local_branch(pc)
    with sqlite3.connect(pc) as db:
        db.execute("UPDATE unified_local_links SET mapping='broken-json' WHERE session_id='selected'")
        rows = db.execute('SELECT id,session_id,content FROM chat_history ORDER BY id').fetchall()
        links = db.execute('SELECT * FROM unified_local_links ORDER BY session_id').fetchall()
    point = next(row[0] for row in rows if row[1] == 'selected')
    with pytest.raises(json.JSONDecodeError):
        await conversation.branch('selected', point)
    with sqlite3.connect(pc) as db:
        assert db.execute('SELECT id,session_id,content FROM chat_history ORDER BY id').fetchall() == rows
        assert db.execute('SELECT * FROM unified_local_links ORDER BY session_id').fetchall() == links


@pytest.mark.asyncio
async def test_branch_after_enrollment_inherits_owner_even_before_the_first_receipt(accounts, pc):
    sync = await enrolled(accounts, pc)
    sync.configure(['selected'], True, consent=True)
    with sqlite3.connect(pc) as db:
        point = db.execute("SELECT id FROM chat_history WHERE session_id='selected'").fetchone()[0]
    copied = (await conversation.branch('selected', point))['session_id']
    assert sync.status()['selected'] == ['selected']
    other = await enrolled(accounts, pc, 1)
    with pytest.raises(CloudError, match='sync_account_copy_required'):
        other.configure([copied], True, consent=True)
    sync.configure(['selected', copied], True, consent=True)
    changes = sync.stage()['changes']
    assert changes[0]['payload']['messages'][0]['uuid'] == changes[1]['payload']['messages'][0]['uuid']


@pytest.mark.asyncio
@pytest.mark.parametrize('child_first', [False, True])
async def test_initial_batch_order_keeps_both_copies_without_fabricating_an_ancestor_revision(accounts, pc, child_first):
    copied, _ = await local_branch(pc)
    sync = await enrolled(accounts, pc)
    sync.configure([copied, 'selected'] if child_first else ['selected', copied], True, consent=True)
    await sync.run()
    app, owners = accounts
    changes = app.state.unified.pull(owners[0])['changes']
    assert len(changes) == 2 and len({change['id'] for change in changes}) == 2
    branch = next(change['payload'] for change in changes if 'branch_of' in change['payload'])
    assert branch['fork_revision'] == 0 and branch['lineage']['status'] == 'unverified'
    assert branch['memories'][0]['content'] == 'Original memory'
    assert sync.stage() is None
    await sync.run()
    assert len(app.state.unified.pull(owners[0])['changes']) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('erase_method', ['native', 'restored'])
async def test_erasure_removes_only_the_selected_local_proof_and_restore_drops_unproven_mappings(pc, erase_method):
    from python.cloud.sync import export_snapshot, apply_snapshot
    copied, _ = await local_branch(pc)
    snapshot = export_snapshot(pc, ['selected'])
    with sqlite3.connect(pc) as db:
        original = db.execute("SELECT mapping FROM unified_local_links WHERE session_id='selected'").fetchone()[0]
        sibling = db.execute('SELECT mapping FROM unified_local_links WHERE session_id=?', (copied,)).fetchone()[0]
    apply_snapshot(pc, snapshot)
    with sqlite3.connect(pc) as db:
        assert not db.execute("SELECT 1 FROM unified_local_links WHERE session_id='selected'").fetchone()
        assert db.execute('SELECT mapping FROM unified_local_links WHERE session_id=?', (copied,)).fetchone()[0] == sibling
        # A later local fork creates a fresh proof rather than trusting a logical restore.
        assert original not in [row[0] for row in db.execute('SELECT mapping FROM unified_local_links')]
    if erase_method == 'native':
        await conversation.purge(copied)
    else:
        from python.local_backup import erase_conversations
        with sqlite3.connect(pc) as db:
            erase_conversations(db, [copied])
    with sqlite3.connect(pc) as db:
        assert not db.execute('SELECT 1 FROM unified_local_links WHERE session_id=?', (copied,)).fetchone()
        assert db.execute("SELECT 1 FROM chat_history WHERE session_id='selected'").fetchone()
