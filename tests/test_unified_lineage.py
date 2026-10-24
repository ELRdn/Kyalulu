"""Revision proofs preserve two continuations without merging their memories."""
from copy import deepcopy
from types import SimpleNamespace
import json

import pytest

from test_unified_app import service, owner
from test_unified_runtime_bridge import change
from python.cloud.store import CloudError, fingerprint


def test_stale_continuations_prove_only_the_shared_committed_prefix(service):
    user = owner(service)
    original = change()
    service.push(user, 'first', [original])
    service.push(user, 'head', [change('head continuation', base=1)])
    offline = change('offline continuation', base=1)
    offline['payload']['memories'][0]['content'] = 'offline memory'
    offline['payload']['lineage'] = {'status': 'verified', 'common_messages': 999}
    receipt = service.push(user, 'offline', [offline])['changes'][0]
    proof = receipt['lineage']
    assert proof['status'] == 'verified' and proof['parent_revision'] == 1
    assert proof['common_messages'] == 1 and proof['common_message_uuid'] == 'user-uuid'
    assert proof['ancestor_sha256'] == fingerprint(original['payload'])
    head = service.read_entity(user, original['id'])['payload']
    branch = service.read_entity(user, receipt['id'])['payload']
    assert head['messages'][1]['content'] == 'head continuation' and head['memories'][0]['content'] == 'tea'
    assert branch['messages'][1]['content'] == 'offline continuation' and branch['memories'][0]['content'] == 'offline memory'
    assert branch['lineage'] == proof and branch['settings']['session_id'] == receipt['id']
    assert service.push(user, 'offline', [offline])['changes'][0] == receipt
    next_branch = deepcopy(offline)
    next_branch.update(id=receipt['id'], base_revision=1)
    next_branch['payload'].update(branch_of='forged', fork_revision=900)
    next_branch['payload']['messages'][0]['content'] = 'edited after branching'
    service.push(user, 'branch-again', [next_branch])
    assert service.read_entity(user, receipt['id'])['payload']['lineage'] == proof
    assert proof['branch_revision'] == 1
    with service.store.transaction() as db:
        encoded = db.execute('SELECT record FROM app_entity_history WHERE owner=? AND id=? AND revision=1', (user, original['id'])).fetchone()[0]
        assert 'user-uuid' not in encoded and 'device reply' not in encoded
        record = json.loads(service.store.decrypt(encoded))
        assert record['payload_sha256'] == proof['ancestor_sha256'] and 'device reply' not in json.dumps(record)


def test_explicit_branch_uses_recorded_revision_and_ids_survive_numeric_remapping(service):
    user = owner(service)
    original = change()
    service.push(user, 'first', [original])
    service.push(user, 'head', [change('head', base=1)])
    branch = change()
    branch['id'] = 'explicit-branch'
    branch['payload'].update(branch_of=original['id'], fork_revision=1)
    branch['payload']['messages'] = branch['payload']['messages'][:1]
    branch['payload']['messages'][0]['id'] = 999
    proof = service.push(user, 'explicit', [branch])['changes'][0]['lineage']
    assert proof['status'] == 'verified' and proof['common_messages'] == 1
    assert proof['common_message_uuid'] == 'user-uuid'


def test_missing_legacy_or_other_account_ancestry_is_never_marked_verified(service):
    user, other = owner(service), owner(service)
    service.push(user, 'initial', [change()])
    for index, account, revision in [(0, user, 50), (1, other, 1)]:
        branch = change()
        branch['id'] = 'branch-' + str(index)
        branch['payload'].update(branch_of='device-conversation', fork_revision=revision)
        proof = service.push(account, 'branch', [branch])['changes'][0]['lineage']
        assert proof['status'] == 'unverified' and proof['reason'] == 'ancestor_unavailable'
        assert 'ancestor_sha256' not in proof
    legacy = change()
    legacy['id'] = 'legacy'
    for message in legacy['payload']['messages']: message.pop('uuid')
    service.push(user, 'legacy', [legacy])
    legacy['base_revision'] = 0
    proof = service.push(user, 'legacy-offline', [legacy])['changes'][0]['lineage']
    assert proof['status'] == 'unverified'


def test_history_is_quota_counted_and_erasure_removes_its_records(service, monkeypatch):
    user = owner(service)
    first = change()
    service.push(user, 'first', [first])
    with service.store.transaction() as db:
        size = db.execute('SELECT LENGTH(payload) FROM app_entities WHERE owner=?', (user,)).fetchone()[0]
        assert db.execute('SELECT COUNT(*) FROM app_entity_history WHERE owner=?', (user,)).fetchone()[0] == 1
    monkeypatch.setattr(service.store, 'entitlements', lambda _: SimpleNamespace(storage_bytes=size + 1))
    with pytest.raises(CloudError, match='cloud_storage_full'):
        service.push(user, 'full', [change(base=1)])
    with service.store.transaction() as db:
        assert db.execute('SELECT COUNT(*) FROM app_entity_history WHERE owner=?', (user,)).fetchone()[0] == 1
        assert not db.execute("SELECT 1 FROM app_sync_requests WHERE owner=? AND id='full'", (user,)).fetchone()
    service.push(user, 'delete', [{**change(base=1), 'payload': {}, 'deleted': True, 'delete_confirmed': True}])
    with service.store.transaction() as db:
        assert not db.execute('SELECT 1 FROM app_entity_history WHERE owner=?', (user,)).fetchone()
