"""Android-size acceptance against an isolated, built HTTPS home server.

Never target a real user's data. See docs/ANDROID_PWA.md for commands.
TLS exceptions here are ONLY for the locally generated test certificate.
"""
import argparse
import json
import uuid
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright


def browser_get(page, path):
    return page.evaluate('''async path => {
      const response = await fetch(path, {cache:'no-store'});
      return {status:response.status, headers:Object.fromEntries(response.headers), body:await response.json()};
    }''', path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='https://mobile.kyalulu.test:8443')
    parser.add_argument('--admin', default='https://127.0.0.1:8443')
    args = parser.parse_args()
    if not args.base.startswith('https://mobile.kyalulu.test:') or not args.admin.startswith('https://127.0.0.1:'):
        parser.error('This acceptance script only targets the isolated loopback test host.')
    output = Path('.artifacts/mobile-v1')
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    with httpx.Client(base_url=args.admin, verify=False, trust_env=False) as admin, sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--host-resolver-rules=MAP mobile.kyalulu.test 127.0.0.1', '--no-proxy-server',
            '--ignore-certificate-errors',  # permit SW registration with the isolated test certificate
        ])
        for width, theme in [(393, 'light'), (360, 'dark'), (320, 'light'), (1280, 'light')]:
            device_name = f'Test Android {width} {uuid.uuid4().hex[:8]}'
            context = browser.new_context(viewport={'width': width, 'height': 851},
                is_mobile=width < 768, has_touch=width < 768, ignore_https_errors=True,
                color_scheme=theme, device_scale_factor=1)
            context.add_init_script(f"localStorage.setItem('my-zeta-theme','{theme}');")
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e, current_errors=errors: current_errors.append(str(e)))
            page.goto(args.base + '/#/chats')
            expect(page.get_by_label('登録コード', exact=True)).to_be_visible()
            if width == 393:
                page.screenshot(path=str(output / 'pairing.png'), full_page=True)
                unauth = browser_get(page, '/api/chat/sessions')
                assert unauth['status'] == 401
                assert 'no-store' in unauth['headers']['cache-control']
                checks.append('unregistered API blocked and not cached')
            issued = admin.post('/api/mobile/admin/code')
            issued.raise_for_status()
            page.get_by_label('端末の名前', exact=True).fill(device_name)
            page.get_by_label('登録コード', exact=True).fill(issued.json()['code'])
            page.get_by_role('button', name='この端末を登録', exact=True).click()
            expect(page.get_by_role('heading', name='チャット', exact=True)).to_be_visible()
            cookies = context.cookies()
            token = next(c for c in cookies if c['name'] == '__Host-kyalulu_device')
            assert token['secure'] and token['httpOnly'] and token['sameSite'] == 'Strict'
            assert browser_get(page, '/api/diagnostics')['status'] == 403
            checks.append(f'{width}/{theme}: paired with HttpOnly cookie, admin blocked')
            page.get_by_role('button', name='新しいチャット', exact=True).click()
            page.get_by_role('button', name='会話エンジンを選ぶ', exact=True).click()
            page.get_by_role('dialog').get_by_label('会話モデル', exact=True).select_option('mock-echo')
            page.get_by_role('button', name='閉じる', exact=True).click()
            composer = page.locator('.k-composer__input')
            expect(composer).to_be_enabled(timeout=20000)
            composer.fill(f'Android draft {width}')
            current_url = page.url
            page.reload()
            expect(page.locator('.k-composer__input')).to_have_value(f'Android draft {width}')
            expect(page.locator('.k-composer__input')).to_be_enabled()
            if width < 768:
                page.locator('.k-composer__input').evaluate('(e) => e.setSelectionRange(e.value.length, e.value.length)')
                page.locator('.k-composer__input').press('Enter')
                expect(page.locator('.k-composer__input')).to_have_value(f'Android draft {width}\n')
                assert not page.locator('.k-chat-bubble--user').count()
            page.locator('.k-composer__input').fill(f'Mobile acceptance {width}')
            with page.expect_response('**/api/chat/stream', timeout=20000) as response:
                page.get_by_role('button', name='送信', exact=True).click()
            assert response.value.status == 200
            sid = current_url.rsplit('/', 1)[1]
            page.wait_for_function("""(sid) => {
              const key = `kyalulu:chat-recovery:v1:${encodeURIComponent(location.origin)}:${encodeURIComponent(sid)}`;
              const record = JSON.parse(localStorage.getItem(key) || 'null');
              return record && record.pending === null;
            }""", arg=sid, timeout=45000)
            history = browser_get(page, '/api/chat/history?session_id=' + sid)['body']['history']
            assert len([m for m in history if m['role'] == 'user']) == 1
            assert len([m for m in history if m['role'] == 'assistant']) == 1
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            if width == 393:
                page.screenshot(path=str(output / 'conversation.png'), full_page=True)
            checks.append(f'{width}/{theme}: draft reload, touch Enter, single durable reply, no horizontal overflow')
            if width == 393:
                # Failure before the server receives the POST is ambiguous to the
                # client: it must preserve the ID and never automatically resend.
                page.route('**/api/chat/stream', lambda route: route.abort('connectionreset'))
                page.locator('.k-composer__input').fill('通信断で保留するメッセージ')
                page.get_by_role('button', name='送信', exact=True).click()
                expect(page.get_by_role('button', name='停止して確認', exact=True)).to_be_visible(timeout=20000)
                page.unroute('**/api/chat/stream')
                page.reload()
                expect(page.get_by_role('button', name='停止して確認', exact=True)).to_be_visible(timeout=20000)
                expect(page.get_by_role('button', name='送信', exact=True)).to_be_disabled()
                pending = page.evaluate('''sid => JSON.parse(localStorage.getItem(`kyalulu:chat-recovery:v1:${encodeURIComponent(location.origin)}:${encodeURIComponent(sid)}`)).pending''', sid)
                page.get_by_role('button', name='停止して確認', exact=True).click()
                expect(page.locator('.k-composer__input')).to_have_value('通信断で保留するメッセージ', timeout=15000)
                expect(page.get_by_role('button', name='送信', exact=True)).to_be_enabled()
                outcome = browser_get(page, '/api/chat/generations/' + pending['id'] + '?session_id=' + sid)['body']
                assert outcome['status'] == 'cancelled'
                unchanged = browser_get(page, '/api/chat/history?session_id=' + sid)['body']['history']
                assert unchanged == history
                checks.append('lost POST survives reload without resend; explicit stop fences request and restores draft')
                page.set_viewport_size({'width': 393, 'height': 480})
                send_box = page.get_by_role('button', name='送信', exact=True).bounding_box()
                assert send_box and send_box['y'] >= 0 and send_box['y'] + send_box['height'] <= 480
                page.set_viewport_size({'width': 393, 'height': 851})
                checks.append('composer remains inside reduced Android viewport')
            page.goto(args.base + '/#/create?edit=new')
            expect(page.get_by_label('名前', exact=True)).to_be_visible()
            page.get_by_label('名前', exact=True).fill(f'Android Test {width}')
            page.get_by_label('説明', exact=True).fill('モバイル操作の検証用キャラクターです。')
            page.get_by_role('button', name='設定を保存', exact=True).click()
            expect(page.get_by_text('保存しました。これまでの会話は', exact=False)).to_be_visible()
            checks.append(f'{width}/{theme}: character created and saved remotely')
            page.goto(args.base + '/#/profile')
            expect(page.get_by_role('heading', name='会話を持ち歩く', exact=True)).to_be_visible()
            page.get_by_label('サーバーのHTTPSアドレス').fill('http://192.168.1.2:8000')
            page.get_by_role('button', name='接続先を保存', exact=True).click()
            expect(page.get_by_text('スマホから接続するサーバーにはHTTPS', exact=False)).to_be_visible()
            assert not page.get_by_text('Researcherモード', exact=True).count()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            if width == 393:
                page.screenshot(path=str(output / 'settings.png'), full_page=True)
                page.wait_for_function('!!navigator.serviceWorker.controller', timeout=20000)
                cached = page.evaluate('''async () => {
                  const out=[];for(const name of await caches.keys()) for(const req of await (await caches.open(name)).keys())out.push(req.url);return out;
                }''')
                assert cached and not any('/api/' in url for url in cached)
                manifest = browser_get(page, '/manifest.webmanifest')['body']
                assert manifest['display'] == 'standalone'
                assert {192, 512} <= {int(i['sizes'].split('x')[0]) for i in manifest['icons']}
                context.set_offline(True)
                expect(page.get_by_text('オフライン · 会話には接続が必要です', exact=True)).to_be_visible()
                page.reload(wait_until='domcontentloaded')
                expect(page.get_by_role('heading', name='会話のサーバーに接続', exact=True)).to_be_visible()
                expect(page.get_by_role('button', name='もう一度接続する', exact=True)).to_be_enabled()
                context.set_offline(False)
                # Chromium emulation resets navigator.onLine on a SW navigation;
                # exercise the visible retry as well as the pre-reload offline event.
                page.get_by_role('button', name='もう一度接続する', exact=True).click()
                expect(page.get_by_role('heading', name='会話を持ち歩く', exact=True)).to_be_visible(timeout=20000)
                checks.append('real SW offline shell/reconnect, manifest/icons and cache privacy')
                devices = admin.get('/api/mobile/admin/devices').json()['devices']
                device = next(d for d in devices if d['name'] == device_name)
                assert admin.delete('/api/mobile/admin/devices/' + device['id']).status_code == 204
                page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                expect(page.get_by_label('登録コード', exact=True)).to_be_visible()
                assert browser_get(page, '/api/chat/history?session_id=' + sid)['status'] == 401
                checks.append('server revocation gates UI and rejects subsequent reads')
            else:
                page.get_by_role('button', name='この端末の登録を解除', exact=True).click()
                expect(page.get_by_label('登録コード', exact=True)).to_be_visible()
            assert not errors, errors
            context.close()
        browser.close()
    (output / 'acceptance.json').write_text(json.dumps({'checks': checks, 'count': len(checks)}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(checks), 'checks': checks}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
