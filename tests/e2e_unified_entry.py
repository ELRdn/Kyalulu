"""Actual unified entry/settings against fictional server eligibility; no providers."""
from browser_storage import READ_ENTITIES_JS
import asyncio
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import urlsplit

import httpx
from playwright.async_api import async_playwright, expect
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from python.cloud.app import create_app
from python.cloud.config import CloudConfig

OUTPUT = ROOT / '.artifacts/unified-entry-browser'


async def prefs(page):
    return await page.evaluate('''()=>{
      const general=JSON.parse(localStorage.getItem('kyalulu-app-preferences-v1')||'{}');
      const owner=localStorage.getItem('kyalulu-app-owner')||'guest';
      return {...general,...JSON.parse(localStorage.getItem('kyalulu-app-preferences-v1:'+owner)||'{}')};
    }''')


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    results, external, errors, calls = [], [], [], []
    with TemporaryDirectory(prefix='cloud-', dir=OUTPUT) as directory, patch.dict(os.environ, {'VITE_UNIFIED_APP': '1'}):
        config = CloudConfig(root=Path(directory), origin='https://app.test', secret='s'*32,
            unified_enabled=True, legal_approved=True,
            region_policies=(('JP', {'accepted': True, 'minimum_age': 13, 'guardian_below': 18, 'version': 'FIXTURE-NOT-REGIONAL-APPROVAL'}),))
        app = create_app(config, transport=httpx.MockTransport(lambda _: (_ for _ in ()).throw(AssertionError('No external provider'))))
        async with local_vite(OUTPUT) as origin, async_playwright() as playwright, httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=config.origin) as api:
            browser = await playwright.chromium.launch(headless=True)
            try:
                for language, width, theme in (('ja', 393, 'light'), ('en', 1280, 'dark')):
                    en=language=='en'
                    context = await browser.new_context(locale='en-US' if en else 'ja-JP', viewport={'width':width,'height':852}, color_scheme=theme)
                    held,release=asyncio.Event(),asyncio.Event()
                    try:
                        async def broker(route):
                            request, url = route.request, urlsplit(route.request.url)
                            if url.hostname != '127.0.0.1' or url.port != urlsplit(origin).port:
                                external.append(url.hostname); await route.abort(); return
                            if not url.path.startswith('/api/'):
                                await route.continue_(); return
                            calls.append({'method':request.method,'path':url.path})
                            assert request.method=='GET' or url.path=='/api/cloud/app/eligibility', 'Unexpected write'
                            headers={'Origin':config.origin}
                            if request.method!='GET':
                                assert set(json.loads(request.post_data))=={'country','age'}
                            for name in ('content-type','x-kyalulu-owner','x-kyalulu-country','x-kyalulu-eligibility'):
                                if name in request.headers: headers[name]=request.headers[name]
                            response=await api.request(request.method,url.path+('?' + url.query if url.query else ''),headers=headers,content=request.post_data_buffer)
                            if url.path=='/api/cloud/app/eligibility':
                                body=json.loads(request.post_data)
                                if body['age']==21:
                                    held.set();await release.wait()
                                elif body['age']==22:
                                    await route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'});return
                            await route.fulfill(status=response.status_code,body=response.content,headers={'Content-Type':response.headers.get('content-type','application/json')})
                        await context.route('**/*',broker)
                        page=await context.new_page()
                        page.on('pageerror',lambda error:errors.append(str(error)))
                        await page.goto(origin)
                        entry=page.locator('.k-unified-entry')
                        await entry.get_by_role('heading',name='Before you begin' if en else 'はじめに',exact=True).wait_for()
                        country=entry.get_by_role('textbox')
                        age=entry.get_by_role('spinbutton')
                        next_button=entry.get_by_role('button',name='Next' if en else '次へ',exact=True)
                        await country.fill('XX'); await age.fill('25')
                        before=len(calls); await next_button.click(); assert len(calls)==before
                        await entry.get_by_role('checkbox').check(); await next_button.click()
                        await entry.get_by_role('alert').wait_for(); assert not (await prefs(page)).get('accepted')
                        await country.fill('JP'); await age.fill('15'); await next_button.click()
                        await expect(next_button).to_be_enabled(); await entry.get_by_role('alert').wait_for()
                        await expect(entry.get_by_role('alert')).to_contain_text('guardian' if en else '保護者')
                        assert not (await prefs(page)).get('accepted')
                        await age.fill('22'); await next_button.click()
                        await expect(next_button).to_be_enabled(); await entry.get_by_role('alert').wait_for()
                        assert not (await prefs(page)).get('accepted') and not await page.evaluate("localStorage.getItem('kyalulu-eligibility-ticket')")
                        await age.fill('21'); await next_button.click()
                        await asyncio.wait_for(held.wait(),10)
                        await expect(age).to_be_disabled();await expect(country).to_be_disabled()
                        await expect(entry.get_by_role('checkbox')).to_be_disabled()
                        await page.evaluate("localStorage.setItem('kyalulu-app-owner','changed-during-eligibility');window.dispatchEvent(new Event('kyalulu-app-context'))")
                        release.set();await expect(next_button).to_be_enabled()
                        await expect(entry.get_by_role('alert')).to_contain_text('account' if en else 'アカウント')
                        assert not (await prefs(page)).get('accepted') and not await page.evaluate("localStorage.getItem('kyalulu-eligibility-ticket')")
                        await page.evaluate("localStorage.removeItem('kyalulu-app-owner');window.dispatchEvent(new Event('kyalulu-app-context'))")
                        await age.fill('20'); await next_button.click()
                        interests=page.locator('.k-interests')
                        await interests.get_by_role('heading',name='Your genres' if en else '好きなジャンル',exact=True).wait_for()
                        await expect(interests).to_have_attribute('lang',language)
                        await page.screenshot(path=str(OUTPUT/f'entry-genres-{language}-{width}-{theme}.png'),full_page=True,animations='disabled')
                        ticket=await page.evaluate("localStorage.getItem('kyalulu-eligibility-ticket')")
                        assert app.state.store.unified_service.verify_eligibility_ticket(ticket,'JP')['age_band']=='adult'
                        await interests.get_by_role('checkbox',name='School' if en else '学園',exact=True).check()
                        await interests.get_by_role('button',name='Next' if en else '次へ',exact=True).click()
                        await interests.get_by_role('checkbox',name='Cool' if en else 'クール',exact=True).check()
                        await interests.get_by_role('button',name='Back' if en else '戻る',exact=True).click()
                        await expect(interests.get_by_role('checkbox',name='School' if en else '学園',exact=True)).to_be_checked()
                        await interests.get_by_role('button',name='Next' if en else '次へ',exact=True).click()
                        await expect(interests.get_by_role('checkbox',name='Cool' if en else 'クール',exact=True)).to_be_checked()
                        await interests.get_by_role('button',name='Skip' if en else 'スキップ',exact=True).click()
                        await interests.get_by_role('checkbox',name='Comfort' if en else '癒し',exact=True).check()
                        await interests.get_by_role('button',name='Start' if en else 'はじめる',exact=True).click()
                        current=await prefs(page)
                        assert current['genres']==['school'] and current['moods']==['cool'] and current['activities']==['healing']
                        await page.get_by_role('heading',name='Recommended for you' if en else 'あなたへのおすすめ',exact=True).wait_for()
                        target=page.get_by_role('combobox',name='Run on' if en else '実行先',exact=True)
                        await expect(target).to_have_value('cloud')
                        await page.locator('.k-char-card').first.click()
                        await page.get_by_role('button',name='Sign in to start a conversation' if en else 'ログインして会話をはじめる',exact=False).click()
                        await page.locator('.k-cloud-login').wait_for()
                        async with page.expect_navigation(wait_until='domcontentloaded'):
                            await target.select_option('device')
                            await page.locator('dialog[open]').get_by_role('button',name='Next' if en else '次へ',exact=True).click()
                        await page.locator('.k-char-card').first.wait_for()
                        assert '/device/' in page.url and not await page.locator('.k-cloud-login').count()
                        reads=len(calls)
                        await page.locator('.k-char-card').first.click()
                        await page.locator('.k-plot-cta__main').click()
                        await page.locator('.k-composer textarea').wait_for()
                        assert '/device/#/chats/' in page.url and not await page.locator('.k-cloud-login').count()
                        chats=await page.evaluate(READ_ENTITIES_JS, ['conversation'])
                        assert len(chats)==1 and chats[0]['owner']=='guest' and chats[0]['payload']['storage_policy']=='local'
                        assert len(calls)==reads
                        await page.goto(origin+'/device/#/profile')
                        settings=page.locator('.k-page > .k-section').first
                        await settings.get_by_role('button',name='Your interests' if en else '好みの設定',exact=True).click()
                        await expect(interests.get_by_role('checkbox',name='School' if en else '学園',exact=True)).to_be_checked()
                        await interests.get_by_role('checkbox',name='School' if en else '学園',exact=True).uncheck()
                        await interests.get_by_role('checkbox',name='Fantasy' if en else '異世界',exact=True).check()
                        alternate='ja' if en else 'en'
                        await settings.get_by_role('combobox',name='Language' if en else '表示言語',exact=True).select_option(alternate)
                        await interests.get_by_role('heading',name='好きなジャンル' if en else 'Your genres',exact=True).wait_for()
                        await expect(interests).to_have_attribute('lang',alternate)
                        await page.evaluate('''()=>{
                          const key='kyalulu-app-preferences-v1:guest',value=JSON.parse(localStorage.getItem(key));
                          localStorage.setItem(key,JSON.stringify({...value,favorites:['new-favorite'],dismissed:['new-dismissal']}));
                          window.dispatchEvent(new Event('kyalulu-app-context'));
                        }''')
                        for _ in range(3):
                            await interests.get_by_role('button',name='スキップ' if en else 'Skip',exact=True).click()
                        current=await prefs(page)
                        assert current['language']==alternate and current['favorites']==['new-favorite'] and current['dismissed']==['new-dismissal']
                        assert current['genres']==['fantasy'] and current['moods']==['cool'] and current['activities']==['healing']
                        assert len(calls)==reads, 'Device-only preferences must not call Cloud'
                        await settings.get_by_role('button',name='好みの設定' if en else 'Your interests',exact=True).click()
                        await interests.get_by_role('checkbox',name='学園' if en else 'School',exact=True).check()
                        for _ in range(2):
                            await interests.get_by_role('button',name='次へ' if en else 'Next',exact=True).click()
                        await page.evaluate("const oldFinish=document.querySelector('.k-interests .k-btn:last-child');localStorage.setItem('kyalulu-app-owner','fixture-next-owner');window.dispatchEvent(new Event('kyalulu-app-context'));oldFinish.click()")
                        assert (await prefs(page))['genres']==[]
                        await expect(interests.get_by_role('checkbox',name='学園' if en else 'School',exact=True)).not_to_be_checked()
                        await expect(interests.get_by_role('checkbox',name='異世界' if en else 'Fantasy',exact=True)).not_to_be_checked()
                        for _ in range(3):
                            await interests.get_by_role('button',name='スキップ' if en else 'Skip',exact=True).click()
                        current=await prefs(page)
                        assert current['genres']==[] and current['moods']==[] and current['activities']==[] and current['favorites']==[]
                        previous=await page.evaluate("JSON.parse(localStorage.getItem('kyalulu-app-preferences-v1:guest'))")
                        assert previous['genres']==['fantasy'] and previous['favorites']==['new-favorite']
                        assert len(calls)==reads
                        assert not errors and not external
                        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                        await page.screenshot(path=str(OUTPUT/f'entry-settings-{language}-{width}-{theme}.png'),full_page=True,animations='disabled')
                        results.append({'language':language,'width':width,'theme':theme,'server_region_age_guardian_and_terms':True,
                            'three_screens_back_skip_and_later_edit':True,'cloud_default_login_on_chat_device_without_login':True,
                            'invalid_success_response_and_late_owner_response_rejected':True,
                            'guest_creates_real_device_only_chat_without_cloud_requests':True,
                            'live_language_and_other_preferences_preserved':True,'owner_change_resets_draft':True,'device_preferences_send_nothing':True})
                    finally:
                        release.set()
                        await context.close()
            finally:
                await browser.close()
                (OUTPUT/'results.json').write_text(json.dumps({'results':results,'external':external,'pageerrors':errors,'calls':calls},indent=2),encoding='utf-8')
        with app.state.store.transaction() as db:
            assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]==0
            assert db.execute('SELECT COUNT(*) FROM credit_lots').fetchone()[0]==0
    print(json.dumps({'passed':len(results),'results':results}))


if __name__=='__main__': asyncio.run(main())
