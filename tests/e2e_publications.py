"""Actual JA/EN UI and database state; only loopback and an in-process ASGI broker."""
import asyncio
import json
from pathlib import Path
import sys
import time
from http.cookies import SimpleCookie
from tempfile import TemporaryDirectory
from urllib.parse import quote, urlsplit
from uuid import uuid4
import httpx
from playwright.async_api import async_playwright, expect
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE
from python.cloud.config import CloudConfig
from python.core.portable_schema import PortableDocument
from python.storage.context import CloudStorageContext, storage_context
from python.storage import db as storage, library

OUTPUT = ROOT / '.artifacts/publication-browser'


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    owner, moderator, reader = (str(uuid4()) for _ in range(3))
    blocked, writes, errors, results, catalog_reads = [], [], [], [], []
    with TemporaryDirectory(prefix='db-', dir=OUTPUT) as directory:
        cfg = CloudConfig(root=Path(directory), origin='https://app.test', secret='s' * 32, unified_enabled=True,
            legal_approved=True, community_enabled=True, moderator_owners=(moderator,),
            region_policies=(('JP', {'accepted': True, 'adult_accepted': True, 'version': 'fixture-1'}),))
        app = create_app(cfg, transport=httpx.MockTransport(lambda _: (_ for _ in ()).throw(AssertionError('External API forbidden'))))
        service = app.state.store.unified_service
        for user in (owner, moderator, reader):
            service.store.account(user, consent='fixture')
            service.store.secret(user, 'app-eligibility', json.dumps(service.general_eligibility('JP', 20)))
            app.state.auth.save(user, user, {'access_token': 'fixture', 'refresh_token': 'fixture', 'expires_in': 3600})
        ticket = service.eligibility_ticket('JP', 20)['ticket']
        with storage_context(CloudStorageContext.for_owner(cfg.root / 'tenants', owner)):
            await storage.init_db()
            item = library.save_item(PortableDocument(name='Fixture guide', data={'description': 'Public description', 'tags': ['fantasy'],
                'first_mes': '<img src="https://invalid.test/never-fetch.png"> Hello', 'memories': 'PRIVATE-MEMORY'},
                profile={'system_prompt': 'PRIVATE-PRESET'}, source={'original': 'PRIVATE-SOURCE'}))
        try:
            async with local_vite(OUTPUT) as origin, async_playwright() as runtime, httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=cfg.origin) as api:
                browser = await runtime.chromium.launch(headless=True)
                try:
                    context = await browser.new_context(viewport={'width': 393, 'height': 852})
                    async def broker(route):
                        request, parsed = route.request, urlsplit(route.request.url)
                        if parsed.hostname != '127.0.0.1' or parsed.port != urlsplit(origin).port:
                            blocked.append(parsed.path); await route.abort(); return
                        if not parsed.path.startswith('/api/'):
                            await route.continue_(); return
                        headers = {key: value for key, value in request.headers.items() if key.lower() in {'content-type', 'cookie', 'x-kyalulu-owner', 'x-kyalulu-country', 'x-kyalulu-eligibility'}}
                        headers['Origin'] = cfg.origin
                        if parsed.path == '/api/cloud/app/works' and request.method == 'GET':
                            catalog_reads.append(parsed.query)
                        cookies = SimpleCookie(request.headers.get('cookie', ''))
                        headers['cookie'] = SESSION_COOKIE + '=' + cookies['fixture_owner'].value if 'fixture_owner' in cookies else ''
                        if request.method not in ('GET', 'HEAD'):
                            value = request.post_data or ''
                            assert 'PRIVATE-' not in value, 'Private Library fields sent to publication API'
                            writes.append({'path': parsed.path, 'method': request.method})
                        response = await api.request(request.method, parsed.path + ('?' + parsed.query if parsed.query else ''), headers=headers, content=request.post_data_buffer)
                        await route.fulfill(status=response.status_code, headers={key: value for key, value in response.headers.items() if key.lower() in {'content-type', 'cache-control', 'x-content-type-options'}}, body=response.content)
                    await context.route('**/*', broker)
                    page = await context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/publications.html').as_posix(), safe='/:'))
                    await page.wait_for_function('window.__PUBLICATIONS_FIXTURE__ !== undefined')
                    async def identity(user, language='ja'):
                        await context.add_cookies([{'name': 'fixture_owner', 'value': user, 'url': origin}])
                        await page.evaluate('([owner,ticket,language])=>window.__PUBLICATIONS_FIXTURE__.identity(owner,ticket,language)', [user, ticket, language])
                    async def go(path):
                        await page.evaluate('(path)=>window.__go(path)', path)
                    await identity(owner)
                    await page.evaluate('()=>window.__PUBLICATIONS_FIXTURE__.mount(document.getElementById("root"),go=>window.__go=go)')
                    await page.get_by_role('combobox').select_option(item.id)
                    await page.get_by_role('button', name='この版を審査へ', exact=True).click()
                    dialog = page.get_by_role('dialog')
                    assert 'PRIVATE-' not in await dialog.inner_text()
                    await dialog.get_by_role('button', name='審査へ送る', exact=True).click()
                    await page.get_by_role('status').filter(has_text='審査を受け付けました').wait_for()
                    await page.get_by_role('button', name='再読込', exact=True).click()
                    await page.get_by_role('heading', name='Fixture guide', exact=True).wait_for()
                    post = service.publications.queue(owner)['publications'][0]
                    assert post['status'] == 'pending' and not service.publications.catalog(reader)['works']
                    await identity(moderator)
                    await page.get_by_role('heading', name='審査キュー', exact=True).wait_for()
                    await page.get_by_label('理由', exact=True).fill('Reviewed every public field')
                    approve = page.get_by_role('button', name='承認して公開', exact=True)
                    assert not await approve.is_enabled()
                    await page.get_by_role('checkbox').check()
                    await approve.click()
                    await page.get_by_role('dialog').get_by_role('button', name='判断を記録', exact=True).click()
                    await page.get_by_role('link', name='公開版を確認', exact=True).wait_for()
                    await identity(reader)
                    await go('/published')
                    await page.get_by_role('link', name='Fixture guide', exact=True).click()
                    await page.get_by_role('heading', name='Fixture guide', exact=True).wait_for()
                    assert not await page.locator('img').count() and not blocked
                    await page.get_by_label('理由', exact=True).fill('Please inspect this version')
                    await page.get_by_role('button', name='通報を送る', exact=True).click()
                    await page.get_by_role('status').filter(has_text='通報を受け付けました').wait_for()
                    await identity(moderator); await go('/publications')
                    await page.get_by_text('Please inspect this version', exact=True).wait_for()
                    await page.get_by_label('理由', exact=True).fill('Hidden for review')
                    await page.get_by_role('button', name='非表示にする', exact=True).click()
                    await page.get_by_role('dialog').get_by_role('button', name='判断を記録', exact=True).click()
                    await page.get_by_text('Hidden for review', exact=True).wait_for()
                    assert not service.publications.catalog(reader)['works']
                    await identity(owner)
                    await page.get_by_label('理由', exact=True).fill('Please reconsider the fixed version')
                    await page.get_by_role('button', name='異議申立てを送る', exact=True).click()
                    await page.get_by_text('Please reconsider the fixed version', exact=True).wait_for()
                    await identity(moderator)
                    await page.get_by_label('理由', exact=True).fill('Appeal reviewed')
                    await page.get_by_role('checkbox').check()
                    await page.get_by_role('button', name='承認して公開', exact=True).click()
                    await page.get_by_role('dialog').get_by_role('button', name='判断を記録', exact=True).click()
                    await page.get_by_role('link', name='公開版を確認', exact=True).wait_for()
                    await identity(reader); await go('/published/' + post['id'])
                    await page.get_by_role('button', name='作者をブロック', exact=True).click()
                    await page.get_by_role('dialog').get_by_role('button', name='ブロック', exact=True).click()
                    await page.get_by_text('この条件に一致する承認済み作品はありません。', exact=True).wait_for()
                    assert not service.publications.catalog(reader)['works']
                    await identity(owner, 'en'); await go('/publications')
                    await page.get_by_role('heading', name='Your submissions', exact=True).wait_for()
                    for width, theme in ((393, 'light'), (1280, 'dark')):
                        await page.set_viewport_size({'width': width, 'height': 852})
                        await page.evaluate('(theme)=>document.documentElement.dataset.theme=theme', theme)
                        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow'
                        await page.screenshot(path=str(OUTPUT / f'queue-{width}-{theme}.png'))
                    adult_author = str(uuid4())
                    service.store.account(adult_author, consent='fixture')
                    service.store.secret(adult_author, 'app-eligibility', json.dumps(service.general_eligibility('JP', 20)))
                    for user in (adult_author, moderator):
                        service.record_age_result(user, country='JP', adult=True, expires=time.time()+3600, receipt='fixture-verified-provider-result', policy='fixture-1')
                        service.publications.consent(user, True)
                    adult = service.submit(adult_author, {'name': 'Adult gate fixture', 'nsfw': True, 'data': {'description': 'AGE-GATED-MARKER'}}, 'adult')
                    service.review(moderator, adult['id'], 1, 'approved', 'Fixture review', {'content_reviewed': True, 'prohibited_content_absent': True, 'rating_correct': True})
                    await identity(reader, 'en'); await go('/published?rating=adult')
                    await page.get_by_role('alert').wait_for()
                    assert 'AGE-GATED-MARKER' not in await page.locator('body').inner_text()
                    await go('/published')
                    await page.get_by_text('No approved works match these filters.', exact=True).wait_for()
                    assert not await page.get_by_role('link', name='Adult gate fixture', exact=True).count()
                    service.record_age_result(reader, country='JP', adult=True, expires=time.time()+3600, receipt='fixture-verified-reader-result', policy='fixture-1')
                    await go('/publications')
                    await page.get_by_role('button', name='Enable verified adult publication access', exact=True).click()
                    await page.get_by_role('button', name='Disable adult publication access', exact=True).wait_for()
                    await go('/published?rating=adult')
                    await page.get_by_role('link', name='Adult gate fixture', exact=True).click()
                    await page.get_by_text('AGE-GATED-MARKER', exact=True).wait_for()
                    assert not await page.get_by_role('button', name='Save a Library copy', exact=True).is_enabled()
                    with service.store.transaction() as db:
                        db.execute('UPDATE app_age_receipts SET expires=0 WHERE owner=?', (reader,))
                    await go('/published'); await go('/published/' + adult['id'])
                    await page.get_by_role('alert').wait_for()
                    assert 'AGE-GATED-MARKER' not in await page.locator('body').inner_text()
                    suggestion_author = str(uuid4())
                    service.store.account(suggestion_author, consent='fixture')
                    service.store.secret(suggestion_author, 'app-eligibility', json.dumps(service.general_eligibility('JP', 20)))
                    suggestions = {}
                    for name, tags in (('Plain suggestion', []), ('Comfort suggestion', ['癒し']), ('School suggestion', ['academy'])):
                        suggestion = service.submit(suggestion_author, {'name': name, 'data': {'tags': tags}}, 'general')
                        service.review(moderator, suggestion['id'], 1, 'approved', 'Fixture review', {'content_reviewed': True, 'prohibited_content_absent': True, 'rating_correct': True})
                        suggestions[name] = suggestion['id']
                    settings = await context.new_page()
                    await settings.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/publications.html').as_posix(), safe='/:'))
                    await settings.wait_for_function('window.__PUBLICATIONS_FIXTURE__ !== undefined')
                    async def preference(**changes):
                        await settings.evaluate('(value)=>window.__PUBLICATIONS_FIXTURE__.preference(value)', changes)
                    for path in ('/published', '/recommendations'):
                        await preference(genres=[], moods=[], activities=[], favorites=[], dismissed=[])
                        await go(path)
                        await page.get_by_role('link', name='School suggestion', exact=True).wait_for()
                        first = page.locator('.k-card h3 a').first
                        reads = len(catalog_reads)
                        assert reads > 0, 'Catalog traffic must be observed before checking for extra requests'
                        await preference(moods=['healing'])
                        await expect(first).to_have_text('Comfort suggestion')
                        await preference(favorites=[suggestions['Plain suggestion']])
                        await expect(first).to_have_text('Plain suggestion')
                        await preference(dismissed=[suggestions['Plain suggestion']])
                        await expect(page.get_by_role('link', name='Plain suggestion', exact=True)).to_have_count(0)
                        await expect(first).to_have_text('Comfort suggestion')
                        await preference(dismissed=[])
                        await expect(first).to_have_text('Plain suggestion')
                        assert len(catalog_reads) == reads, 'Preference changes must not refetch public works'
                        assert not await page.get_by_role('link', name='Adult gate fixture', exact=True).count()
                    service.publications.block(reader, service.publications.detail(reader, suggestions['Plain suggestion'])['author_id'], True)
                    await go('/published'); await go('/recommendations')
                    await page.get_by_text('No public works match these filters.', exact=True).wait_for()
                    next_reader = str(uuid4())
                    service.store.account(next_reader, consent='fixture')
                    service.store.secret(next_reader, 'app-eligibility', json.dumps(service.general_eligibility('JP', 20)))
                    app.state.auth.save(next_reader, next_reader, {'access_token': 'fixture', 'refresh_token': 'fixture', 'expires_in': 3600})
                    await identity(next_reader, 'en')
                    await page.get_by_role('link', name='School suggestion', exact=True).wait_for()
                    baseline = service.publications.catalog(next_reader)['works'][0]['name']
                    await expect(page.locator('.k-card h3 a').first).to_have_text(baseline)
                    await settings.close()
                    assert not errors and not blocked, {'pageerrors': errors, 'blocked': blocked}
                    results.append({'pending_approval': True, 'human_checks': True, 'fixed_snapshot': True, 'report_hide_appeal': True,
                        'blocked_before_search': True, 'no_private_submission': True, 'no_external_image': True, 'ja_en': True,
                        'narrow_light_wide_dark': True, 'adult_separate_and_verified': True, 'expired_age_blocks_link': True,
                        'live_cross_tab_tag_favorite_dismissal': True, 'preference_changes_refetch_nothing': True,
                        'recommendation_block_and_owner_isolation': True, 'catalog_reads': len(catalog_reads), 'writes': len(writes)})
                    await context.close()
                finally:
                    await browser.close()
        finally:
            (OUTPUT / 'results.json').write_text(json.dumps({'results': results, 'pageerrors': errors, 'blocked': blocked}, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__': asyncio.run(main())
