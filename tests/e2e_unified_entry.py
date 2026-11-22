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
                                body=json.loads(request.post_data)
                                if body['age']==15:
                                    assert body=={'country':'JP','age':15,'guardian_consent':True}
                                else:
                                    assert set(body)=={'country','age'}
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
                        # Cloud skips the entry form: region, age and consent move to the login sheet (docs/MOBILE_UX_SPEC.md §2).
                        await page.get_by_role('heading',name='Recommended for you' if en else 'あなたへのおすすめ',exact=True).wait_for()
                        assert not await page.locator('.k-unified-entry').count()
                        await page.locator('.k-char-card').first.click()
                        await page.locator('.k-plot-cta__main').click()
                        sheet=page.locator('.k-cloud-login__sheet')
                        await sheet.wait_for()
                        await sheet.get_by_role('button',name='Not now' if en else 'あとで',exact=True).click()
                        await expect(sheet).to_have_count(0)
                        # A Cloud guest can switch to this device without signing in.
                        await page.goto(origin+'/profile')
                        await page.get_by_role('link',name='Execution target' if en else '実行先',exact=True).click()
                        target=page.get_by_role('radiogroup',name='Run on' if en else '実行先',exact=True)
                        await expect(target.get_by_role('radio',name='Cloud',exact=True)).to_be_checked()
                        async with page.expect_navigation(wait_until='domcontentloaded'):
                            await target.get_by_role('radio',name='This device' if en else 'この端末',exact=True).click()
                            await page.locator('dialog[open]').get_by_role('button',name='Next' if en else '次へ',exact=True).click()
                        assert '/device/' in page.url
                        entry=page.locator('.k-unified-entry')
                        await entry.get_by_role('heading',name='Before you begin' if en else 'はじめに',exact=True).wait_for()
                        country=entry.get_by_role('textbox')
                        age=entry.get_by_role('spinbutton')
                        terms=entry.get_by_role('checkbox',name='I agree to the terms and privacy policy.' if en else '利用規約・プライバシーポリシーに同意します。',exact=True)
                        guardian=entry.get_by_role('checkbox',name="I have a parent or guardian's consent." if en else '保護者の同意を得ています。',exact=True)
                        next_button=entry.get_by_role('button',name='Next' if en else '次へ',exact=True)
                        await country.fill('XX'); await age.fill('25')
                        before=len(calls); await next_button.click(); assert len(calls)==before
                        await terms.check(); await next_button.click()
                        await entry.get_by_role('alert').wait_for(); assert not (await prefs(page)).get('accepted')
                        await country.fill('JP'); await age.fill('15')
                        before=len(calls); await next_button.click(); assert len(calls)==before
                        await guardian.check(); await next_button.click()
                        await expect(next_button).to_be_enabled(); await entry.get_by_role('alert').wait_for()
                        await expect(entry.get_by_role('alert')).to_contain_text('guardian' if en else '保護者')
                        assert not (await prefs(page)).get('accepted')
                        await age.fill('22'); await next_button.click()
                        await expect(next_button).to_be_enabled(); await entry.get_by_role('alert').wait_for()
                        assert not (await prefs(page)).get('accepted') and not await page.evaluate("localStorage.getItem('kyalulu-eligibility-ticket')")
                        await age.fill('21'); await next_button.click()
                        await asyncio.wait_for(held.wait(),10)
                        await expect(age).to_be_disabled();await expect(country).to_be_disabled()
                        await expect(terms).to_be_disabled()
                        await page.evaluate("localStorage.setItem('kyalulu-app-owner','changed-during-eligibility');window.dispatchEvent(new Event('kyalulu-app-context'))")
                        release.set();await expect(next_button).to_be_enabled()
                        await expect(entry.get_by_role('alert')).to_contain_text('account' if en else 'アカウント')
                        assert not (await prefs(page)).get('accepted') and not await page.evaluate("localStorage.getItem('kyalulu-eligibility-ticket')")
                        await page.evaluate("localStorage.removeItem('kyalulu-app-owner');window.dispatchEvent(new Event('kyalulu-app-context'))")
                        await age.fill('20'); await next_button.click()
                        # No interest screens: the form leads straight to Home.
                        await page.get_by_role('heading',name='Recommended for you' if en else 'あなたへのおすすめ',exact=True).wait_for()
                        await page.screenshot(path=str(OUTPUT/f'entry-home-{language}-{width}-{theme}.png'),full_page=True,animations='disabled')
                        ticket=await page.evaluate("localStorage.getItem('kyalulu-eligibility-ticket')")
                        assert app.state.store.unified_service.verify_eligibility_ticket(ticket,'JP')['age_band']=='adult'
                        assert not await page.locator('.k-cloud-login').count()
                        reads=len(calls)
                        await page.locator('.k-char-card').first.click()
                        await page.locator('.k-plot-cta__main').click()
                        await page.locator('.k-composer textarea').wait_for()
                        assert '/device/#/chats/' in page.url and not await page.locator('.k-cloud-login').count()
                        chats=await page.evaluate(READ_ENTITIES_JS, ['conversation'])
                        assert len(chats)==1 and chats[0]['owner']=='guest' and chats[0]['payload']['storage_policy']=='local'
                        assert len(calls)==reads
                        interests=page.locator('.k-interests')
                        async def open_interests(current_language):
                            await page.goto(origin+'/device/#/profile/settings')
                            english=current_language=='en'
                            if width>=1200:
                                settings=page.get_by_role('navigation',name='Settings' if english else '設定',exact=True)
                                await settings.get_by_role('link',name='Interests' if english else '好み',exact=True).click()
                            else:
                                await page.get_by_role('link',name='Your interests' if english else '好みの設定',exact=True).click()
                            await expect(interests).to_have_attribute('lang',current_language)

                        await open_interests(language)
                        await interests.get_by_role('checkbox',name='School' if en else '学園',exact=True).check()
                        await interests.get_by_role('checkbox',name='Cool' if en else 'クール',exact=True).check()
                        await interests.get_by_role('checkbox',name='Comfort' if en else '癒し',exact=True).check()
                        assert (await prefs(page))['genres']==[]
                        await interests.get_by_role('button',name='Save' if en else '保存',exact=True).click()
                        current=await prefs(page)
                        assert current['genres']==['school'] and current['moods']==['cool','healing']
                        assert len(calls)==reads, 'Device-only preferences must not call Cloud'
                        await open_interests(language)
                        await expect(interests.get_by_role('checkbox',name='School' if en else '学園',exact=True)).to_be_checked()
                        await interests.get_by_role('checkbox',name='School' if en else '学園',exact=True).uncheck()
                        await interests.get_by_role('checkbox',name='Fantasy' if en else 'ファンタジー',exact=True).check()
                        alternate='ja' if en else 'en'
                        await page.evaluate('''async language=>{
                          const {preferences,savePreferences}=await import('/src/lib/appContext.ts');
                          savePreferences({...preferences(),language});
                        }''',alternate)
                        await expect(interests).to_have_attribute('lang',alternate)
                        await page.evaluate('''()=>{
                          const key='kyalulu-app-preferences-v1:guest',value=JSON.parse(localStorage.getItem(key));
                          localStorage.setItem(key,JSON.stringify({...value,favorites:['new-favorite'],dismissed:['new-dismissal']}));
                          window.dispatchEvent(new Event('kyalulu-app-context'));
                        }''')
                        await interests.get_by_role('button',name='保存' if en else 'Save',exact=True).click()
                        current=await prefs(page)
                        assert current['language']==alternate and current['favorites']==['new-favorite'] and current['dismissed']==['new-dismissal']
                        assert current['genres']==['fantasy'] and current['moods']==['cool','healing']
                        assert len(calls)==reads, 'Device-only preferences must not call Cloud'
                        await open_interests(alternate)
                        await interests.get_by_role('checkbox',name='学園' if en else 'School',exact=True).check()
                        await page.evaluate("const oldSave=document.querySelector('.k-interests button');localStorage.setItem('kyalulu-app-owner','fixture-next-owner');window.dispatchEvent(new Event('kyalulu-app-context'));oldSave.click()")
                        assert (await prefs(page))['genres']==[]
                        await expect(interests.get_by_role('checkbox',name='学園' if en else 'School',exact=True)).not_to_be_checked()
                        await expect(interests.get_by_role('checkbox',name='ファンタジー' if en else 'Fantasy',exact=True)).not_to_be_checked()
                        await interests.get_by_role('button',name='保存' if en else 'Save',exact=True).click()
                        current=await prefs(page)
                        assert current['genres']==[] and current['moods']==[] and current['activities']==[] and current['favorites']==[]
                        previous=await page.evaluate("JSON.parse(localStorage.getItem('kyalulu-app-preferences-v1:guest'))")
                        assert previous['genres']==['fantasy'] and previous['favorites']==['new-favorite']
                        assert len(calls)==reads
                        assert not errors and not external
                        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                        await page.screenshot(path=str(OUTPUT/f'entry-settings-{language}-{width}-{theme}.png'),full_page=True,animations='disabled')
                        results.append({'language':language,'width':width,'theme':theme,'server_region_age_guardian_and_terms':True,
                            'cloud_skips_form_and_opens_login_sheet':True,'picker_in_my_page_advanced':True,'interests_save_and_later_edit':True,'device_without_login':True,
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
