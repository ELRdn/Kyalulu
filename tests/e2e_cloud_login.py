"""Actual login UI with isolated eligibility/auth and a mocked email provider."""
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

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'runtime'))
from python.cloud.app import create_app
from python.cloud.config import CloudConfig
from python.cloud.auth import provider_consent_version

OUTPUT=ROOT/'.artifacts/cloud-login-browser'


async def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    results,external,errors,emails=[],[],[],[]
    with TemporaryDirectory(prefix='cloud-',dir=OUTPUT) as directory,patch.dict(os.environ,{'VITE_UNIFIED_APP':'1'}):
        def provider(request):
            assert request.url.host=='supabase.test' and request.url.path=='/auth/v1/otp' and request.method=='POST'
            value=json.loads(request.content);assert value['email']=='fixture@example.test';emails.append(value)
            return httpx.Response(200,json={})
        config=CloudConfig(root=Path(directory),origin='https://app.test',secret='s'*32,supabase_url='https://supabase.test',
            supabase_key='fixture-only',private_test=True,allowed_emails=('fixture@example.test',),signup_limit=1,trial_credits=0,monthly_subsidy_jpy=0,
            unified_enabled=True,region_policies=(('JP',{'accepted':True,'minimum_age':13,'guardian_below':18,'version':'FIXTURE-NOT-REGIONAL-APPROVAL'}),))
        app=create_app(config,transport=httpx.MockTransport(provider))
        ticket=app.state.store.unified_service.eligibility_ticket('JP',20)['ticket']
        async with local_vite(OUTPUT) as origin,async_playwright() as playwright,httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url=config.origin) as api:
            browser=await playwright.chromium.launch(headless=True)
            try:
                for language,width,theme in (('ja',393,'light'),('en',1280,'dark')):
                    context=await browser.new_context(locale='ja-JP' if language=='ja' else 'en-US',viewport={'width':width,'height':852},color_scheme=theme)
                    held,release=asyncio.Event(),asyncio.Event()
                    state={'status':'normal','fail':False,'hold':True}
                    status_reads,posts=[],[]
                    try:
                        async def broker(route):
                            request,url=route.request,urlsplit(route.request.url)
                            if url.hostname!='127.0.0.1' or url.port!=urlsplit(origin).port:
                                external.append(url.hostname);await route.abort();return
                            if not url.path.startswith('/api/'):
                                await route.continue_();return
                            headers={'Origin':config.origin}
                            if 'content-type' in request.headers:headers['Content-Type']=request.headers['content-type']
                            if request.method!='GET':
                                assert url.path=='/api/cloud/auth/login' and request.method=='POST'
                                body=json.loads(request.post_data);posts.append(body)
                                assert body=={'email':'fixture@example.test','consent':True,'country':'JP','eligibility_ticket':ticket,
                                    'operator_backend':'openrouter','provider_consent_version':provider_consent_version(config),'provider_disclosure_version':provider_consent_version(config)}
                                if state['fail']:
                                    await route.fulfill(status=503,json={'error':'authentication_unavailable'});return
                            response=await api.request(request.method,url.path+('?' + url.query if url.query else ''),headers=headers,content=request.post_data_buffer)
                            if url.path=='/api/cloud/status':
                                status_reads.append(state['status']);value=response.json()
                                if state['status']=='unknown':value['provider_consent_version']+='-future-fixture'
                                elif state['status']=='closed':value['login_available']=False
                                await route.fulfill(status=response.status_code,json=value);return
                            if url.path=='/api/cloud/auth/login' and state['hold']:
                                held.set();await release.wait()
                            await route.fulfill(status=response.status_code,body=response.content,headers={'Content-Type':response.headers.get('content-type','application/json')})
                        await context.route('**/*',broker)
                        prefs={'version':1,'language':language,'country':'JP','age':20,'accepted':True,'genres':[],'moods':[],'activities':[],'favorites':[],'dismissed':[]}
                        await context.add_init_script("localStorage.setItem('kyalulu-app-preferences-v1',"+json.dumps(json.dumps(prefs))+ ");localStorage.setItem('kyalulu-eligibility-ticket',"+json.dumps(ticket)+");localStorage.setItem('kyalulu-execution-target','cloud')")
                        page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                        await page.goto(origin+'/#/login?returnTo=%2Fchats%2Fselected')
                        login=page.locator('.k-cloud-login')
                        en=language=='en'
                        await login.get_by_role('heading',name='Sign in / Create an account' if en else 'ログイン / 新規登録',exact=True).wait_for()
                        consent=login.locator('form input[type=checkbox]').nth(0)
                        analytics=login.locator('form input[type=checkbox]').nth(1)
                        await expect(consent).to_be_enabled()
                        google=login.get_by_role('button',name='Continue with Google' if en else 'Googleで始める',exact=True)
                        await expect(google).to_be_disabled();await consent.check();await expect(google).to_be_disabled()
                        country=login.locator('form select')
                        await country.select_option('JP');await expect(consent).not_to_be_checked()
                        email=login.locator('input[type=email]');await email.fill('fixture@example.test');await consent.check()
                        await expect(google).to_be_enabled();before=len(status_reads)
                        alternate='ja' if en else 'en'
                        await login.get_by_role('combobox',name='Language' if en else '表示言語',exact=True).select_option(alternate)
                        await expect(email).to_have_value('fixture@example.test');await expect(country).to_have_value('JP');await expect(consent).to_be_checked()
                        assert len(status_reads)==before and not posts
                        await login.get_by_role('button',name='メールリンクを送る' if en else 'Send sign-in link',exact=True).click()
                        await asyncio.wait_for(held.wait(),10)
                        await expect(email).to_be_disabled();await expect(country).to_be_disabled();await expect(consent).to_be_disabled()
                        await analytics.uncheck();await expect(analytics).not_to_be_checked()
                        state['hold']=False;release.set()
                        await login.get_by_role('status').filter(has_text='確認メールを送りました' if en else 'A sign-in email was sent').wait_for()
                        assert len(posts)==1
                        before=len(status_reads)
                        await login.get_by_role('combobox',name='表示言語' if en else 'Language',exact=True).select_option(language)
                        await login.get_by_role('status').filter(has_text='A sign-in email was sent' if en else '確認メールを送りました').wait_for()
                        assert len(status_reads)==before
                        await expect(analytics).not_to_be_checked();await expect(email).to_have_value('fixture@example.test')
                        assert await page.evaluate("sessionStorage.getItem('kyalulu-cloud-login-return')")=='/chats/selected'
                        state['status']='unknown';await page.evaluate("window.dispatchEvent(new Event('online'))")
                        await login.get_by_role('status').filter(has_text='provider disclosure has changed' if en else '接続先の説明が更新').wait_for()
                        await expect(consent).not_to_be_checked();await expect(consent).to_be_disabled();await expect(google).to_be_disabled()
                        await expect(login.locator('.k-cloud-login__destination')).not_to_contain_text('DeepSeek')
                        state['status']='normal'
                        await login.get_by_role('button',name='Check sign-in status again' if en else 'ログイン状態を再確認',exact=True).click()
                        await expect(consent).to_be_enabled();await expect(consent).not_to_be_checked();await consent.check()
                        state['fail']=True
                        await login.get_by_role('button',name='Send sign-in link' if en else 'メールリンクを送る',exact=True).click()
                        await login.get_by_role('status').filter(has_text='Login could not be verified' if en else 'ログインを確認できません').wait_for()
                        before=len(status_reads)
                        await login.get_by_role('combobox',name='Language' if en else '表示言語',exact=True).select_option(alternate)
                        await login.get_by_role('status').filter(has_text='ログインを確認できません' if en else 'Login could not be verified').wait_for()
                        assert len(status_reads)==before and len(posts)==2
                        await expect(email).to_have_value('fixture@example.test');await expect(country).to_have_value('JP')
                        await login.get_by_role('combobox',name='表示言語' if en else 'Language',exact=True).select_option(language)
                        await login.get_by_role('status').filter(has_text='Login could not be verified' if en else 'ログインを確認できません').wait_for()
                        assert len(status_reads)==before
                        state['status']='closed';await page.evaluate("window.dispatchEvent(new Event('online'))")
                        await login.get_by_role('status').filter(has_text='Sign-in is not available' if en else 'この環境のログインは準備中').wait_for()
                        await expect(google).to_be_disabled();await login.locator('form').dispatch_event('submit');assert len(posts)==2
                        await expect(login).to_have_attribute('lang',language)
                        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                        await login.evaluate('(node)=>{node.scrollTop=0;}')
                        bounds=await login.evaluate('node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom,brand:node.querySelector(".k-connect-screen__brand").getBoundingClientRect().top,height:innerHeight})')
                        assert bounds['top']<=bounds['brand']<bounds['bottom']<=bounds['height']+1, bounds
                        await page.screenshot(path=str(OUTPUT/f'login-{language}-{width}-{theme}.png'),full_page=True,animations='disabled')
                        footer=login.locator('.k-connect-screen__body > p').last
                        await footer.scroll_into_view_if_needed()
                        assert await footer.evaluate('(node)=>{const rect=node.getBoundingClientRect(),parent=node.closest("main").getBoundingClientRect();return rect.top>=parent.top&&rect.bottom<=Math.min(parent.bottom,innerHeight)+1;}')
                        await page.screenshot(path=str(OUTPUT/f'login-footer-{language}-{width}-{theme}.png'),full_page=True,animations='disabled')
                        assert not external and not errors
                        results.append({'language':language,'width':width,'theme':theme,'live_translation_keeps_email_country_consent':True,
                            'language_change_refetches_nothing':True,'unknown_disclosure_blocks_and_requires_fresh_consent':True,
                            'mock_email_success_and_http_error_translated':True,'busy_fields_locked_analytics_revocable':True,
                            'unavailable_login_stays_closed':True,
                            'long_form_header_and_footer_reachable':True,
                            'status_reads':len(status_reads),'explicit_login_attempts':len(posts)})
                    finally:
                        release.set();await context.close()
            finally:
                await browser.close()
                (OUTPUT/'results.json').write_text(json.dumps({'results':results,'external':external,'pageerrors':errors,'mock_emails':len(emails)},indent=2),encoding='utf-8')
        assert len(emails)==2
        with app.state.store.transaction() as db:
            assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]==0
            assert db.execute('SELECT COUNT(*) FROM credit_lots').fetchone()[0]==0
    print(json.dumps({'passed':len(results),'results':results,'mock_emails':len(emails)}))


if __name__=='__main__':asyncio.run(main())
