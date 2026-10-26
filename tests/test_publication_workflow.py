"""Public snapshots, human review and appeals never expose private Runtime data."""
import json
import time
from uuid import uuid4
import httpx
import pytest
from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE
from python.cloud.config import CloudConfig
from python.cloud.store import CloudError

CHECKS = {'content_reviewed': True, 'prohibited_content_absent': True, 'rating_correct': True}


@pytest.fixture
def hosted(tmp_path):
    moderator = str(uuid4())
    cfg = CloudConfig(root=tmp_path / 'cloud', origin='https://app.test', secret='s' * 32,
        unified_enabled=True, legal_approved=True, community_enabled=True, moderator_owners=(moderator,),
        region_policies=(('JP', {'accepted': True, 'minimum_age': 13, 'guardian_below': 13, 'adult_accepted': True, 'version': 'fixture-1'}),))
    app = create_app(cfg, transport=httpx.MockTransport(lambda _: pytest.fail('No provider network calls')))
    service = app.state.store.unified_service
    def enroll(owner=None, *, age=20):
        owner = owner or str(uuid4())
        service.store.account(owner, consent='fixture')
        service.store.secret(owner, 'app-eligibility', json.dumps(service.general_eligibility('JP', age)))
        app.state.auth.save(owner, owner, {'access_token': 'fixture', 'refresh_token': 'fixture', 'expires_in': 3600})
        return owner
    enroll(moderator)
    return app, service, enroll, moderator


def original(name='Public', **changes):
    return {'name': name, 'kind': 'character', 'data': {'description': 'Visible text', 'tags': ['fantasy'], 'memories': 'PRIVATE'},
            'profile': {'api_key': 'PRIVATE'}, 'histories': [{'content': 'PRIVATE'}], 'source': {'original': 'PRIVATE'}, 'assets': [{'uri': 'PRIVATE'}], **changes}


def approved(service, owner, moderator, name='Public'):
    post = service.submit(owner, original(name), 'general', request_id=str(uuid4()), source={'item_id': 'private-library', 'revision': 7}, author_name='Snapshot author')
    return service.review(moderator, post['id'], 1, 'approved', 'Human-reviewed fixture', CHECKS)


def test_fixed_snapshot_scrubbing_pending_review_and_request_replay(hosted):
    _, service, enroll, moderator = hosted
    owner, reader, request = enroll(), enroll(), str(uuid4())
    payload = original()
    first = service.submit(owner, payload, 'general', request_id=request)
    assert service.submit(owner, payload, 'general', request_id=request) == first
    payload['name'] = 'CHANGED'
    with pytest.raises(CloudError, match='request_conflict'):
        service.submit(owner, payload, 'general', request_id=request)
    assert service.publications.catalog(reader)['works'] == []
    with pytest.raises(CloudError, match='not_found'):
        service.publications.detail(reader, first['id'])
    queued = service.publications.queue(owner)['publications'][0]
    assert queued['classification'] == 'unknown' and 'PRIVATE' not in str(queued)
    with pytest.raises(CloudError, match='moderator_required'):
        service.review(owner, first['id'], 1, 'approved', 'Forged client', CHECKS)
    with pytest.raises(CloudError, match='explicit_content_review'):
        service.review(moderator, first['id'], 1, 'approved', 'Missing checks')
    service.review(moderator, first['id'], 1, 'approved', 'Reviewed', CHECKS)
    work = service.publications.detail(reader, first['id'])
    assert work['name'] == 'Public' and work['snapshot_hash'] == queued['snapshot_hash']
    assert 'PRIVATE' not in str(work) and service.publications.queue(reader)['publications'] == []


def test_same_fixed_source_is_not_resubmitted_after_reload_or_concurrent_retry(hosted):
    from concurrent.futures import ThreadPoolExecutor
    _, service, enroll, moderator = hosted
    owner = enroll()
    def send(_):
        return service.submit(owner, original(), 'general', request_id=str(uuid4()), source={'item_id': 'fixed', 'revision': 1})
    with ThreadPoolExecutor(max_workers=2) as workers:
        first, second = list(workers.map(send, (1, 2)))
    assert first['id'] == second['id']
    service.review(moderator, first['id'], 1, 'rejected', 'Needs changes')
    assert send(3)['status'] == 'rejected'
    service.publications.withdraw(owner, first['id'], 2)
    assert send(4)['id'] != first['id']


def test_reports_hide_appeal_review_conflicts_and_withdrawal(hosted):
    _, service, enroll, moderator = hosted
    owner, reader = enroll(), enroll()
    post = approved(service, owner, moderator)
    report = service.publications.report(reader, post['id'], 2, 'Needs review')
    assert service.publications.report(reader, post['id'], 2, 'Needs review') == report
    with pytest.raises(CloudError, match='report_request_conflict'):
        service.publications.report(reader, post['id'], 2, 'Different request')
    with pytest.raises(CloudError, match='revision_conflict'):
        service.review(moderator, post['id'], 1, 'hidden', 'Stale revision')
    service.review(moderator, post['id'], 2, 'hidden', 'Reported concern')
    assert service.publications.catalog(reader, q='Public')['works'] == []
    with pytest.raises(CloudError, match='not_found'):
        service.publications.appeal(reader, post['id'], 3, 'Not the author')
    appeal = service.publications.appeal(owner, post['id'], 3, 'Please reconsider')
    assert service.publications.appeal(owner, post['id'], 3, 'Please reconsider') == appeal
    queue = service.publications.queue(moderator)['publications'][0]
    assert len(queue['reports']) == len(queue['appeals']) == 1
    assert service.publications.queue(owner)['publications'][0]['reports'] == []
    assert service.publications.catalog(reader)['works'] == []
    service.review(moderator, post['id'], 3, 'approved', 'Appeal reviewed', CHECKS)
    work = service.publications.detail(reader, post['id'])
    assert work['revision'] == 7 and work['moderation_revision'] == 4
    with pytest.raises(CloudError, match='not_found'):
        service.publications.withdraw(reader, post['id'], 4)
    service.publications.withdraw(owner, post['id'], 4)
    with pytest.raises(CloudError, match='withdrawn'):
        service.review(moderator, post['id'], 5, 'approved', 'Must not resurrect', CHECKS)
    assert service.publications.queue(owner)['publications'][0]['status'] == 'withdrawn'


def test_adult_requires_verified_region_and_separate_enablement_everywhere(hosted):
    _, service, enroll, moderator = hosted
    owner, teen, adult = enroll(), enroll(age=15), enroll()
    for user in (owner, moderator, adult):
        service.record_age_result(user, country='JP', adult=True, expires=time.time() + 3600, receipt='fixture-provider-receipt', policy='fixture-1')
    with pytest.raises(CloudError, match='enablement_required'):
        service.submit(owner, original(nsfw=True), 'adult')
    service.publications.consent(owner, True)
    pending = service.submit(owner, original(nsfw=True), 'adult')
    assert service.publications.queue(moderator)['publications'] == []
    with pytest.raises(CloudError, match='not_found'):
        service.review(moderator, pending['id'], 1, 'approved', 'No enablement', CHECKS)
    service.publications.consent(moderator, True)
    service.review(moderator, pending['id'], 1, 'approved', 'Reviewed', CHECKS)
    for viewer in ('', teen, adult):
        assert service.publications.catalog(viewer, q='Public', tag='fantasy')['works'] == []
        with pytest.raises(CloudError, match='not_found'):
            service.publications.detail(viewer, pending['id'])
    with pytest.raises(CloudError, match='adult_verification'):
        service.publications.consent(teen, True)
    service.record_age_result(teen, country='JP', adult=True, expires=time.time()+3600, receipt='conflicting-fixture-result', policy='fixture-1')
    with pytest.raises(CloudError, match='adult_verification'):
        service.publications.consent(teen, True)
    service.publications.consent(adult, True)
    assert service.publications.detail(adult, pending['id'])['rating'] == 'adult'
    assert service.publications.catalog(adult)['works'] == []
    assert len(service.publications.catalog(adult, rating='adult')['works']) == 1
    with service.store.transaction() as db:
        db.execute('UPDATE app_age_receipts SET expires=0 WHERE owner=?', (adult,))
    assert service.publications.catalog(adult)['works'] == []
    assert service.publications.consent(adult)['enabled'] is False


def test_block_filters_before_search_and_approval_without_evidence_stays_private(hosted):
    _, service, enroll, moderator = hosted
    owner, reader = enroll(), enroll()
    post = approved(service, owner, moderator)
    work = service.publications.detail(reader, post['id'])
    service.publications.block(reader, work['author_id'], True)
    assert service.publications.catalog(reader, q='Public', tag='fantasy')['works'] == []
    with pytest.raises(CloudError, match='not_found'):
        service.publications.detail(reader, post['id'])
    service.publications.block(reader, work['author_id'], False)
    assert service.publications.catalog(reader)['works']
    with service.store.transaction() as db:
        db.execute('DELETE FROM app_publication_events WHERE publication=?', (post['id'],))
    assert service.publications.catalog(reader)['works'] == []


def test_withdrawal_and_disabling_stay_available_after_region_policy_expires(hosted):
    _, service, enroll, moderator = hosted
    owner = enroll()
    post = approved(service, owner, moderator)
    service.store.secret(owner, 'app-eligibility', json.dumps({'country': 'JP', 'policy': 'expired', 'age_band': 'adult'}))
    assert service.publications.consent(owner, False) == {'enabled': False}
    service.publications.withdraw(owner, post['id'], 2)
    assert service.publications.catalog(enroll())['works'] == []


def test_legacy_queue_and_balance_are_preserved_without_implicit_publication(hosted):
    from python.cloud.publications import Publications
    _, service, enroll, moderator = hosted
    owner, legacy = enroll(), str(uuid4())
    payload = json.dumps({'schema_version': 1, 'kind': 'character', 'name': 'Legacy', 'nsfw': False, 'data': {'description': 'Existing'}})
    with service.store.transaction() as db:
        db.execute('INSERT INTO app_publications VALUES(?,?,?,?,?,?,?,?)', (legacy, owner, 1, 'general', 'approved', payload, 'old decision', time.time()))
    service.store.admin_grant(owner, 321, 'publication-preservation-fixture')
    before = service.store.balance(owner)
    assert before >= 321
    restored = Publications(service)
    assert restored.catalog(owner)['works'] == []
    assert restored.queue(owner)['publications'][0]['document']['name'] == 'Legacy'
    with pytest.raises(CloudError, match='requires_resubmission'):
        restored.review(moderator, legacy, 1, 'approved', 'Must not silently normalize', CHECKS)
    assert service.store.balance(owner) == before
    with service.store.transaction() as db:
        assert db.execute('SELECT payload FROM app_publications WHERE id=?', (legacy,)).fetchone()[0] == payload


@pytest.mark.asyncio
async def test_http_public_proof_private_owner_and_snapshot_boundaries(hosted):
    app, service, enroll, moderator = hosted
    owner, reader = enroll(), enroll()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='https://app.test', headers={'Origin': 'https://app.test'}) as client:
        client.cookies.set(SESSION_COOKIE, owner)
        body = {'document': original(), 'rating': 'general', 'request_id': str(uuid4()), 'source': {'item_id': 'private', 'revision': 3}}
        result = await client.post('/api/cloud/app/publications', json=body)
        assert result.status_code == 200, result.text
        id = result.json()['id']
        client.cookies.set(SESSION_COOKIE, reader)
        refused = await client.post('/api/cloud/app/publications', headers={'X-Kyalulu-Owner': owner}, json={**body, 'request_id': str(uuid4())})
        assert refused.status_code == 403 and refused.json()['error'] == 'sync_account_changed'
        assert service.publications.queue(reader)['publications'] == []
        client.cookies.set(SESSION_COOKIE, reader)
        assert (await client.get('/api/cloud/app/publications')).json()['publications'] == []
        review = {'revision': 1, 'decision': 'approved', 'reason': 'Reviewed', 'checks': CHECKS}
        assert (await client.put('/api/cloud/app/publications/' + id, json=review)).status_code == 403
        client.cookies.set(SESSION_COOKIE, moderator)
        assert (await client.put('/api/cloud/app/publications/' + id, json=review)).status_code == 200
        client.cookies.clear()
        assert (await client.get('/api/cloud/app/works')).status_code == 403
        client.headers.update({'X-Kyalulu-Eligibility': service.eligibility_ticket('JP', 20)['ticket'], 'X-Kyalulu-Country': 'JP'})
        response = await client.get('/api/cloud/app/works')
        assert response.status_code == 200 and len(response.json()['works']) == 1, response.text
        assert response.headers['cache-control'] == 'no-store' and 'private' not in response.text and 'PRIVATE' not in response.text
        assert (await client.get('/api/cloud/app/works/' + id)).status_code == 200
        assert (await client.get('/api/cloud/app/works/' + id + '/assets/private')).status_code == 401
        assert (await client.post('/api/cloud/app/works/' + id + '/reports', json={'revision': 2, 'reason': 'Test'})).status_code == 401
        client.headers['X-Kyalulu-Country'] = 'XX'
        assert (await client.get('/api/cloud/app/works/' + id)).status_code == 403
        client.cookies.set(SESSION_COOKIE, owner)
        service.store.secret(owner, 'app-eligibility', json.dumps({'country': 'JP', 'policy': 'expired', 'age_band': 'adult'}))
        assert (await client.request('DELETE', '/api/cloud/app/publications/' + id, json={'revision': 2})).status_code == 200


@pytest.mark.parametrize('data', [{'description': {'private': 'nested'}}, {'tags': [{'private': 'nested'}]}, {'alternate_greetings': 'not a list'}])
def test_typed_public_fields_reject_nested_private_objects(hosted, data):
    _, service, enroll, _ = hosted
    with pytest.raises(CloudError, match='invalid_publication'):
        service.submit(enroll(), original(data=data), 'general')
