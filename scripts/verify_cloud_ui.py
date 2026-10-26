"""Real Chromium UI with all API calls mocked; zero paid/external inference."""

import functools
from contextlib import ExitStack
import argparse
import http.server
import json
import hashlib
import re
import sys
from pathlib import Path
import threading
from urllib.parse import urlsplit, parse_qs
import yaml
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
OUTPUT = ROOT / ".artifacts/cloud-onboarding-20261011/ui"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, default=ROOT / 'apps/web/dist')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--final-tutorial', action='store_true', help='Coordinator confirmed this build contains the final tutorial source.')
    args = parser.parse_args()
    index = args.dist / "index.html"
    if not index.is_file():
        parser.error('Build the candidate Web first; this script never builds it.')
    index_hash = hashlib.sha256(index.read_bytes()).hexdigest()
    entry_assets = {name: hashlib.sha256((args.dist / name.lstrip('/')).read_bytes()).hexdigest()
                    for name in re.findall(r'src="([^"]+\.js)"', index.read_text(encoding='utf-8')) if 'assets/' in name}
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    from python.cloud.config import CloudConfig
    from python.cloud.router import public_route, public_routes
    from python.cloud.model_choices import CHOICES
    mock_config = CloudConfig(root=output, origin='https://cloud.test', secret='fixture' * 6,
        inference_enabled=True, openrouter_approved=True, openrouter_key='fixture', allowed_model_routes=tuple(CHOICES))
    model_routes = public_routes(mock_config)
    stream_fixture = {'enabled': False, 'requests': [], 'completed': {}}
    quotes = {}
    release_stream = threading.Event()
    class CandidateHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_POST(self):
            if self.path != '/api/chat/stream' or not stream_fixture['enabled']:
                self.send_error(405)
                return
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            preview, request = quotes[body['quote_id']]
            assert body['generation_id'] == request['generation_id']
            assert all(body[key] == request[key] for key in ('model_id', 'session_id', 'messages', 'history_revision'))
            assert body['max_credits'] == preview['max_credits']
            assert body['provider_training_consent'] is (preview['route']['training_consent_required'] is True)
            stream_fixture['requests'].append(body)
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            if body['model_id'] != 'cloud-deepseek-baidu':
                stream_fixture['completed'][body['generation_id']] = {'generation_id': body['generation_id'],
                    'session_id': body['session_id'], 'status': 'completed', 'assistant_id': 4, 'user_id': None}
                self.wfile.write(b'event: done\ndata: {"full":"Ordinary one-click reply"}\n\n')
                self.wfile.flush()
                return
            # Hold the mock stream open while the browser checks the waiting UI.
            self.wfile.write(b'event: progress\ndata: {"stage":"generation","elapsed_ms":1200}\n\nevent: token\ndata: {"token":"UNSAVED FIXTURE TEXT"}\n\n')
            self.wfile.flush()
            assert release_stream.wait(60), 'Browser did not finish the waiting checks'
            stream_fixture['completed'][body['generation_id']] = {'generation_id': body['generation_id'],
                'session_id': body['session_id'], 'status': 'completed', 'assistant_id': 3, 'user_id': None}
            self.wfile.write(b'event: done\ndata: {"full":"Mock completed reply"}\n\n')
            self.wfile.flush()
    handler = functools.partial(CandidateHandler, directory=str(args.dist))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    errors = []
    result = {"status": "failed", "dist_index_sha256": index_hash, "dist_entry_assets_sha256": entry_assets,
              "dist": str(args.dist.resolve()), "physical_android": False,
              "live_google_login_verified": False, "real_inference_attempts": 0}
    calls, blocked, private_guest_requests, layouts = [], [], [], []
    browser = None
    try:
        with sync_playwright() as p, ExitStack() as cleanup:
            browser = p.chromium.launch()
            cleanup.callback(browser.close)
            context = browser.new_context(
                viewport={"width": 390, "height": 844}, service_workers="block"
            )
            page = context.new_page()
            page.set_default_timeout(10000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            authenticated = False
            login_available = False
            backend = "openrouter"
            owner = "ui-test"
            status_offline = False
            settings = {}
            histories = {}
            quote_number = 0
            quote_expires_in = 120
            character = yaml.safe_load((ROOT / 'characters/butler.yaml').read_text(encoding='utf-8'))
            capabilities = {"schema_version": 1, "mode": "cloud", "model_selection": "cloud-routes",
                "safety_screening": False, "credit_reservation": False,
                "features": {name: name not in {'suggestions', 'community', 'media_generation'} for name in (
                    'regenerate', 'suggestions', 'stored_context', 'progress', 'branch', 'permanent_delete',
                    'summaries', 'world_memory', 'story_rules', 'community', 'media_playback', 'media_generation')}}
            base = f"http://127.0.0.1:{server.server_port}"

            def mock(route):
                nonlocal quote_number
                path = urlsplit(route.request.url).path
                calls.append(path)
                if path == '/api/chat/stream' and stream_fixture['enabled']:
                    route.continue_()
                    return
                if path in {'/api/chat','/api/chat/stream','/api/chat/suggest'}:
                    blocked.append(path);route.abort('blockedbyclient');return
                if status_offline and path == '/api/cloud/status':
                    route.abort('internetdisconnected');return
                public = path in {'/api/mobile/status','/api/cloud/status','/api/cloud/auth/login'} or (
                    route.request.method == 'GET' and path in {'/api/characters','/api/worlds','/api/capabilities'})
                if not authenticated and not public:
                    private_guest_requests.append({'method': route.request.method, 'path': path})
                    route.fulfill(status=401,content_type='application/json',body='{"error":"authentication_required"}')
                    return
                data = {}
                if path == '/api/cloud/quotes':
                    body = json.loads(route.request.post_data)
                    assert body['model_id'] in {'cloud-deepseek-baidu', 'cloud-glm-inferencenet'}
                    assert not body.get('provider_training_consent')
                    quote_number += 1
                    data = {'quote_id': f'mock-quote-{quote_number}', 'max_credits': 5, 'expires_in': quote_expires_in,
                            'credit_reservation': False, 'safety_screening': False,
                            'route': public_route(mock_config, route_id=body['model_id'])}
                    quotes[data['quote_id']] = (data, body)
                elif path in {"/api/mobile/status", "/api/cloud/status"}:
                    data = {
                        "cloud_mode": True,
                        "remote_mode": False,
                        "authenticated": authenticated,
                        "login_available": login_available,
                        "login_countries": ["JP", "US"],
                        "private_test": True,
                        "administrative": False,
                        "owner_scope": owner if authenticated else None,
                        "operator_route": public_route(mock_config) if backend == 'openrouter' else
                            {"provider": backend, "contributor_available": backend == "opencode-go", "safety": {"enabled": False}},
                        "provider_consent_version": "2026-10-03-provider-routing-v2" + (
                            "-openrouter-model-choices-v6-region" if backend == "openrouter" else f"-{backend}-direct-generation"),
                    }
                elif path == "/api/cloud/profile":
                    data = {"revision": 0, "display_name": "Traveler", "saved_characters": [], "pinned_sessions": []}
                elif path == "/api/cloud/account":
                    data = {
                        "wallet": {"credits": 500, "plan": "free", "lots": [], "used_credits": 3,
                            "usage": [{"state": "pending", "created": 1700000000, "max_credits": 5, "charged_credits": 0},
                                      {"state": "completed", "created": 1700000001, "max_credits": 5, "charged_credits": 3}]},
                        "identity": {"id": "00000000-0000-0000-0000-000000000001", "email": "owner@example.test"},
                        "private_test": True,
                        "entitlements": {"id": "free", "storage_bytes": 25_000_000},
                        "plans": [{"id": "free", "storage_bytes": 25_000_000}],
                        "storage_bytes": 200000,
                        "sync": {"mode": "off"},
                        "byok_configured": False,
                        "billing_available": False,
                        "billing_portal_available": False,
                        "routes": [{"provider": "openrouter", "unavailable_reason": "openrouter_not_accepted"}],
                    }
                elif path == "/api/cloud/auth/login":
                    body=json.loads(route.request.post_data)
                    assert "adult" not in body and body["consent"] is True and body["country"] == "JP"
                    assert body["operator_backend"] == "openrouter"
                    assert body["provider_disclosure_version"].endswith("openrouter-model-choices-v6-region")
                    data={"url":"https://supabase.test/auth/v1/authorize"} if body.get("provider")=="google" else {"sent":True}
                elif path == "/api/cloud/backups":
                    data = {"backups": []}
                elif path == "/api/chat/sessions":
                    data = {"sessions": []}
                elif path == "/api/capabilities":
                    data = capabilities
                elif path == "/api/characters":
                    data = {"characters": [character]}
                elif path == "/api/worlds":
                    data = {"worlds": []}
                elif path == "/api/models":
                    data = {"models": [{**r, 'provider_type':r['provider'], 'provider_model':r['model']}
                                       for r in model_routes]}
                elif path == "/api/chat/history":
                    sid = parse_qs(urlsplit(route.request.url).query).get('session_id', ['ui-test'])[0]
                    data = {"history": histories.get(sid, [])}
                elif path.startswith('/api/chat/generations/') and route.request.method == 'GET':
                    completed = stream_fixture['completed'].get(path.rsplit('/', 1)[-1])
                    if completed:
                        route.fulfill(content_type='application/json', body=json.dumps(completed))
                        return
                    # A quote awaiting consent has not dispatched a generation.
                    route.fulfill(status=404, content_type='application/json', body='{"detail":"not_found"}')
                    return
                elif path.startswith('/api/chat/context/'):
                    data = {"history_revision": "mock-revision", "summaries": []}
                elif path == '/api/chat/intro/inject':
                    sid = parse_qs(urlsplit(route.request.url).query)['session_id'][0]
                    histories[sid] = [{'id': 1, 'role': 'assistant', 'content': settings[sid]['intro'], 'model_id': 'intro'}]
                    data = {"injected": True, "intro": settings[sid]['intro']}
                elif path.startswith("/api/memory/session/"):
                    data = {"enabled": False, "scope": "mock-scope"}
                elif path == "/api/memory":
                    data = {"memories": []}
                elif path == "/api/memory/conflicts":
                    data = {"conflicts": []}
                elif path == "/api/memory/events":
                    data = {"events": []}
                elif path == "/api/personas":
                    data = {"personas": []}
                elif path == "/api/library":
                    data = {"items": []}
                elif path == "/api/chat/settings":
                    if route.request.method == 'PUT':
                        body = json.loads(route.request.post_data)
                        settings[body['session_id']] = body
                        data = body
                    else:
                        sid = parse_qs(urlsplit(route.request.url).query).get('session_id', ['ui-test'])[0]
                        data = settings.get(sid, {"session_id": sid, "system_prompt": "", "temperature": 0.8})
                elif path == "/api/chat/debug":
                    data = {
                        "settings": {},
                        "state": {},
                        "compiled": {},
                        "memory_session": {"enabled": False},
                    }
                elif path == "/api/prompts/presets":
                    data = {"presets": []}
                elif path == "/api/prompt/compile":
                    data = {}
                else:
                    blocked.append('unmocked API: '+path);route.abort('blockedbyclient');return
                route.fulfill(
                    status=200, content_type="application/json", body=json.dumps(data)
                )

            def guard(route):
                url = urlsplit(route.request.url)
                if f'{url.scheme}://{url.netloc}' != base:
                    blocked.append('external: '+route.request.url);route.abort('blockedbyclient')
                elif url.path.startswith('/api/'):
                    mock(route)
                else:
                    route.continue_()
            context.route("**/*", guard)
            page.route("https://supabase.test/**",lambda route:route.fulfill(status=200,
                content_type="text/html",body="<h1>Simulated OAuth provider</h1>"))
            def capture(name):
                page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                page.screenshot(path=str(output / name), full_page=True, animations='disabled')

            def ready(locator):
                try:
                    locator.wait_for()
                except Exception:
                    result['failure_url'] = page.url
                    result['failure_ui'] = page.locator('body').inner_text()[:4000]
                    capture('failure.png')
                    raise

            def layout(name, width, theme, height=None):
                height_suffix = f'-{height}h' if height is not None else ''
                height = height if height is not None else (844 if width <= 390 else 1000)
                page.set_viewport_size({'width': width, 'height': height})
                target = 'ライトモードに切替' if theme == 'light' else 'ダークモードに切替'
                toggle = page.get_by_role('button', name=target, exact=True)
                if toggle.count() and not page.locator('[role="dialog"][aria-modal="true"],dialog:modal').count():
                    toggle.click()
                else:
                    page.evaluate("theme => {localStorage.setItem('my-zeta-theme', theme);document.documentElement.dataset.theme=theme;}", theme)
                assert page.locator('html').get_attribute('data-theme') == theme
                page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                overflow = page.evaluate('''() => {
                    const selectors=['html','body','.k-shell__main','.k-chat-main','.k-first-chat-tutorial','.k-chat-recovery','.k-chat-recovery > div',
                        '.k-quote','[aria-label="今回の送信先と消費上限"]','[role="dialog"]','dialog','dialog > div','dialog details','dialog summary'];
                    return selectors.flatMap(s => [...document.querySelectorAll(s)].filter(e => e.clientWidth>0)
                        .map(e => ({selector:s,client:e.clientWidth,scroll:e.scrollWidth}))).filter(e => e.scroll>e.client+1);
                }''')
                layouts.append({'screen': name, 'width': width, 'height': height, 'theme': theme, 'horizontal_overflow': overflow})
                if overflow:
                    layouts[-1]['chat_overflow_diagnostics'] = page.evaluate('''() => {
                        const mains = [...document.querySelectorAll('.k-chat-main')];
                        return mains.flatMap(main => [main, ...main.querySelectorAll('*')].map(el => {
                            const rect = el.getBoundingClientRect();
                            const style = getComputedStyle(el);
                            return {tag: el.tagName, id: el.id, class_name: el.getAttribute('class'),
                                rect: rect.toJSON(), client_width: el.clientWidth, scroll_width: el.scrollWidth,
                                right_outside_viewport: rect.right > innerWidth + 1,
                                scroll_overflow: el.scrollWidth > el.clientWidth,
                                display: style.display, visibility: style.visibility, overflow_x: style.overflowX};
                        }).filter(el => el.right_outside_viewport || el.scroll_overflow));
                    }''')
                capture(f'{name}-{width}-{theme}{height_suffix}.png')
                assert not overflow, layouts[-1]

            page.goto(base)
            page.get_by_role('heading', name='おすすめのキャラクター', exact=False).wait_for()
            page.locator('a[href="#/characters/butler"]').first.wait_for()
            assert page.get_by_role('heading', name='ログイン / 新規登録', exact=True).count() == 0
            for width in (390, 1440):
                for theme in ('light', 'dark'):
                    layout('guest-home', width, theme)
            page.locator('a[href="#/characters/butler"]').first.click()
            page.get_by_role('button', name='ログインして会話をはじめる', exact=False).wait_for()
            capture('guest-butler-detail.png')
            assert not private_guest_requests, private_guest_requests
            assert not any(path in {'/api/chat/settings','/api/chat/intro/inject'} for path in calls)
            result['guest_initial_private_api_requests'] = []
            result['guest_home_and_butler_detail'] = True
            page.get_by_role('button', name='ログインして会話をはじめる', exact=False).click()
            page.get_by_role(
                "heading", name="キャラクターと、記憶や世界を持ち続ける。", exact=True
            ).wait_for()
            page.get_by_text("入力・出力の外部安全検査は行いません。", exact=False).wait_for()
            assert '安全検査の固定送信先' not in page.locator('body').inner_text()
            page.get_by_text("この環境のログインは準備中です。",exact=True).wait_for()
            assert "OpenCode Go" not in page.locator("body").inner_text()
            assert page.get_by_role("button", name="Googleで始める").is_disabled()
            login_available = True
            with page.expect_response(lambda response: response.url.endswith('/api/cloud/status')):
                page.evaluate("window.dispatchEvent(new Event('online'))")
            page.get_by_text("この環境のログインは準備中です。",exact=True).wait_for(state='hidden')
            assert page.get_by_role('checkbox', name='18歳以上です', exact=True).count() == 0
            page.get_by_label('居住国', exact=True).select_option('JP')
            for checkbox in page.get_by_role("checkbox").all():
                checkbox.check()
            assert page.get_by_role("button", name="Googleで始める").is_enabled()
            for width in (390, 1440):
                for theme in ('light', 'dark'):
                    layout('cloud-login', width, theme)
            page.get_by_label("メールアドレス",exact=True).fill("owner@example.test")
            page.get_by_role("button",name="メールリンクを送る",exact=True).click()
            page.get_by_text("確認メールを送りました。このブラウザでリンクを開いてください。",exact=True).wait_for()
            page.get_by_role("button",name="Googleで始める",exact=True).click()
            page.get_by_role("heading",name="Simulated OAuth provider",exact=True).wait_for()
            page.goto(base+"/#/?login_error=login_cancelled")
            page.get_by_text("ログインをキャンセルしました。もう一度Googleまたはメールでログインできます。",exact=True).wait_for()
            assert "login_error" in page.url  # Error remains until retry or choosing guest browsing.
            assert page.evaluate("sessionStorage.getItem('kyalulu-cloud-login-return')") == '/characters/butler'
            authenticated = True
            page.goto(base + '/#/')  # The mocked callback redirects here, like the real backend.
            page.reload()  # A callback loads a fresh document; hash-only goto does not recheck the mock cookie.
            ready(page.get_by_role('button', name='会話をはじめる', exact=False))
            assert urlsplit(page.url).fragment == '/characters/butler'
            result['mock_oauth_returns_selected_butler'] = True
            capture('authenticated-butler-return.png')
            page.get_by_role('button', name='会話をはじめる', exact=False).click()
            page.get_by_label('メッセージ', exact=True).wait_for()
            assert urlsplit(page.url).fragment.startswith('/chats/chat_')
            tutorial = page.get_by_role('region', name='初トークの案内', exact=True)
            tutorial.wait_for()
            ready(page.get_by_text('会話の準備完了', exact=True))
            assert page.get_by_label('メッセージ', exact=True).input_value() == ''
            result['first_talk_tutorial_visible_without_auto_send'] = True
            for width in (390, 1440):
                for theme in ('light', 'dark'):
                    layout('first-talk-tutorial', width, theme)
            tutorial.get_by_role('button', name='スキップ', exact=True).click()
            tutorial.wait_for(state='hidden')
            assert page.evaluate("localStorage.getItem('kyalulu-first-chat-tutorial-v1')") == 'skipped'
            result['tutorial_skippable'] = True
            page.reload()
            page.get_by_label('メッセージ', exact=True).wait_for()
            assert tutorial.count() == 0
            page.get_by_role('button', name='初トークの案内', exact=True).click()
            tutorial.wait_for()
            result['tutorial_reopen_after_reload'] = True
            draft = page.get_by_label('メッセージ', exact=True)
            draft.fill('日本語の入力中')
            page.wait_for_function("() => document.querySelector('.k-composer__send')?.disabled === false")
            draft.evaluate('''el => {
                el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true,data:'入力'}));
                el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true}));
                el.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true,data:'入力'}));
            }''')
            assert draft.input_value() == '日本語の入力中'
            assert not blocked, blocked
            result['synthetic_ime_enter_preserves_draft_no_send'] = True
            for step in range(3):
                tutorial.get_by_role('button', name='次へ', exact=True).click()
            tutorial.get_by_role('button', name='案内を完了', exact=True).click()
            tutorial.wait_for(state='hidden')
            assert page.evaluate("localStorage.getItem('kyalulu-first-chat-tutorial-v1')") == 'completed'
            page.reload()
            page.get_by_label('メッセージ', exact=True).wait_for()
            assert tutorial.count() == 0
            assert page.get_by_label('メッセージ', exact=True).input_value() == '日本語の入力中'
            result['tutorial_completed_reload_keeps_closed_and_draft'] = True
            result['tutorial_candidate_build_verified'] = True
            result['tutorial_final_curie_source_verified'] = args.final_tutorial
            capture('tutorial-completed-reload.png')
            page.set_viewport_size({'width': 390, 'height': 844})
            page.goto(base + "/#/profile")
            page.reload()
            page.locator(".k-cloud__balance").filter(has_text="500").wait_for()
            page.get_by_text("クレジット使用履歴と料金", exact=True).click()
            page.get_by_text("生成中 · 消費上限 5", exact=True).wait_for()
            page.get_by_text("3 消費", exact=True).wait_for()
            assert '予約中' not in page.locator('body').inner_text()
            assert 'SFW検査あり' not in page.content()
            assert 'クレジットは予約せず' in page.locator('body').inner_text()
            result['wallet_pending_spend_cap_and_actual_settlement_without_reservation'] = True
            page.get_by_text("アカウント情報・データ管理", exact=True).click()
            page.get_by_text("ログイン中：owner@example.test", exact=True).wait_for()
            assert page.get_by_label("同期する範囲", exact=True).input_value() == "off"
            assert page.get_by_role("button", name="契約・解約・請求を管理").count() == 0
            assert page.get_by_role("button", name="K-Creditsを追加", exact=False).count() == 0
            assert page.get_by_text("成人向けコンテンツ", exact=True).count() == 0
            page.screenshot(path=str(output / "cloud-account-390.png"), full_page=True)
            page.goto(base + "/#/chats/ui-test")
            page.get_by_role("button", name="キャラ・プリセット", exact=True).click()
            sheet = page.get_by_role('dialog').filter(has=page.get_by_text('キャラ・プリセット', exact=True))
            models = sheet.get_by_label("会話モデル", exact=True)
            models.locator('option[value="cloud-claude-haiku"]').wait_for(state='attached')
            assert models.locator('option').count() == 8
            assert models.locator('option[value="cloud-deepseek-decart"]').is_enabled()
            assert models.locator('option[value="cloud-deepseek-baidu"]').is_enabled()
            assert models.locator('option[value="cloud-gpt-luna-flex"]').is_enabled()
            assert models.locator('option[value="contributor"]').count() == 0
            assert models.locator('option[value="structured"]').count() == 0
            assert page.get_by_role("checkbox", name="この1回の生成で送る", exact=False).count() == 0
            assert page.get_by_role("alert").count() == 0
            models.select_option("cloud-glm-inferencenet")
            assert models.input_value() == "cloud-glm-inferencenet"
            result['six_choices_show_actual_availability'] = True
            page.screenshot(path=str(output / "cloud-route-openrouter-390.png"), full_page=True)
            models.select_option('cloud-deepseek-baidu')
            model_details = sheet.locator('details').first
            assert not model_details.evaluate('el => el.open')
            assert '学習' in sheet.inner_text() and '同意' in sheet.inner_text()
            model_details.locator('summary').focus()
            page.keyboard.press('Enter')
            assert model_details.evaluate('el => el.open')
            focusable_count = sheet.evaluate('el => [...el.querySelectorAll("button,select,input,summary,[tabindex]")].filter(node=>node.tabIndex>=0&&!node.disabled&&node.getClientRects().length).length')
            for key in ('Tab','Shift+Tab'):
                for _ in range(focusable_count + 1):
                    page.keyboard.press(key)
                    assert sheet.evaluate('el => el.contains(document.activeElement)')
            for width, height in ((320,844),(390,844),(390,600),(1440,1000)):
                for theme in ('light','dark'):
                    for expanded in (False,True):
                        model_details.evaluate('(el, open) => el.open = open', expanded)
                        layout('preset-details' if expanded else 'preset', width, theme, height)
                        close = sheet.get_by_role('button',name='閉じる',exact=True)
                        assert close.evaluate('el => {const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}')
                        sheet.get_by_label('会話の生成プリセット',exact=True).scroll_into_view_if_needed()
                        assert sheet.get_by_label('会話の生成プリセット',exact=True).is_visible()
            model_details.evaluate('el => el.open = false')
            page.set_viewport_size({'width':390,'height':844})
            page.keyboard.press('Escape')
            assert page.get_by_role('button',name='キャラ・プリセット',exact=True).evaluate('el => el===document.activeElement')
            result['preset_details_collapsed_privacy_visible_scrollable'] = True
            result['preset_keyboard_details_focus_cycle_and_escape_return'] = True
            quote_panel = page.get_by_role('region', name='送信前の見積確認', exact=True)
            draft = page.get_by_label('メッセージ', exact=True)
            for attempt in range(2):
                draft.fill('Baidu送信同意の取り消し試験')
                page.get_by_role('button', name='送信', exact=True).click()
                quote_panel.wait_for()
                assert quote_panel.evaluate('el => el.tagName === "SECTION" && el.classList.contains("k-quote")')
                assert page.locator('dialog:modal,[aria-modal="true"]').count() == 0
                quote_panel.get_by_role('heading', name='この送信の保存・学習利用', exact=True).wait_for()
                training = quote_panel.get_by_role('checkbox',
                    name='Baiduが会話・設定・記憶・生成結果を保存し、AIの学習・改善に利用する可能性に同意します', exact=True)
                confirm = quote_panel.get_by_role('button', name='送信する', exact=True)
                cancel = quote_panel.get_by_role('button', name='キャンセル', exact=True)
                visible_quote = quote_panel.inner_text()
                assert public_route(mock_config, route_id='cloud-deepseek-baidu')['display_name'] in visible_quote
                assert 'Baidu' in visible_quote and re.search(r'5\s*K-Credits', visible_quote), visible_quote
                assert '上限' in visible_quote and 'クレジットは予約せず' in visible_quote and '実費精算' in visible_quote
                assert '失敗時の消費は0' in visible_quote
                assert quote_panel.locator('.k-quote__expires').get_attribute('role') is None
                assert not training.is_checked() and confirm.is_disabled()
                assert not stream_fixture['requests'] and '/api/chat/stream' not in calls
                if attempt == 0:
                    capture('baidu-quote-unchecked-390.png')
                training.check()
                assert confirm.is_enabled()
                assert '/api/chat/stream' not in calls, 'Checking consent alone must not dispatch'
                if attempt == 0:
                    capture('baidu-training-consent-390.png')
                    for width, height in ((320, 844), (390, 844), (1440, 1000), (390, 600)):
                        for theme in ('light', 'dark'):
                            layout('baidu-inline-quote', width, theme, height)
                            hits = []
                            for button in (confirm, cancel):
                                button.scroll_into_view_if_needed()
                                hit = button.evaluate('''el => {
                                    const r = el.getBoundingClientRect();
                                    const x = r.x + r.width / 2, y = r.y + r.height / 2;
                                    const target = document.elementFromPoint(x, y);
                                    return {label: el.textContent.trim(),
                                        in_viewport: r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0
                                            && r.right <= innerWidth && r.bottom <= innerHeight,
                                        hittable: el === target || el.contains(target)};
                                }''')
                                hits.append(hit)
                            layouts[-1]['button_hits'] = hits
                            assert all(hit['in_viewport'] and hit['hittable'] for hit in hits), layouts[-1]
                            assert training.is_checked() and confirm.is_enabled()
                            background = page.get_by_role('button', name='キャラ・プリセット', exact=True)
                            background.focus()
                            assert background.evaluate('el => el === document.activeElement'), 'Inline consent must allow background focus'
                            focusable_count = quote_panel.evaluate('''el => [...el.querySelectorAll('button,input')]
                                .filter(node => !node.disabled && node.getClientRects().length).length''')
                            for button, key in ((confirm, 'Tab'), (cancel, 'Shift+Tab')):
                                button.focus()
                                for _ in range(focusable_count + 1):
                                    page.keyboard.press(key)
                                    if not quote_panel.evaluate('el => el.contains(document.activeElement)'):
                                        break
                                assert not quote_panel.evaluate('el => el.contains(document.activeElement)'), 'Inline consent must not trap Tab'
                    page.set_viewport_size({'width': 390, 'height': 844})
                training.uncheck()
                assert confirm.is_disabled()
                assert '/api/chat/stream' not in calls
                cancel.click()
                quote_panel.wait_for(state='hidden')
                page.get_by_role('button', name='送信', exact=True).wait_for()
                assert draft.input_value() == 'Baidu送信同意の取り消し試験'
                assert not blocked, blocked
                assert not any(path in {'/api/chat', '/api/chat/stream', '/api/chat/suggest'} for path in calls), calls
            assert quote_number == 2
            result['baidu_training_unchecked_blocks_send'] = True
            result['baidu_training_resets_each_quote_cancel_sends_nothing'] = True
            result['quote_inline_cancel_preserves_draft'] = True
            result['quote_inline_allows_background_focus_and_tab'] = True
            result['quote_inline_320_390_1440_and_short_viewport_light_dark'] = True
            result['quote_inline_confirm_cancel_hit_targets'] = True

            quote_expires_in = 1
            draft.fill('期限切れ後も残す下書き')
            page.get_by_role('button', name='送信', exact=True).click()
            quote_panel.wait_for()
            quote_panel.wait_for(state='hidden')
            page.get_by_role('button', name='送信', exact=True).wait_for()
            assert draft.input_value() == '期限切れ後も残す下書き'
            assert quote_number == 3 and '/api/chat/stream' not in calls
            quote_expires_in = 120
            result['quote_expiry_preserves_draft_without_dispatch_or_retry'] = True

            draft.fill('見積同意中のアカウント失効後も残す下書き')
            page.get_by_role('button', name='送信', exact=True).click()
            quote_panel.wait_for()
            owner = ''
            with page.expect_response(lambda response: response.url.endswith('/api/mobile/status')):
                page.evaluate("window.dispatchEvent(new Event('focus'))")
            page.get_by_role('button', name='もう一度接続する', exact=True).wait_for()
            assert quote_panel.count() == 0 and '/api/chat/stream' not in calls
            owner = 'ui-test'
            page.get_by_role('button', name='もう一度接続する', exact=True).click()
            draft.wait_for()
            assert draft.input_value() == '見積同意中のアカウント失効後も残す下書き'
            assert quote_panel.count() == 0 and quote_number == 4 and '/api/chat/stream' not in calls
            result['quote_identity_invalidation_preserves_draft_without_dispatch_or_retry'] = True
            histories['ui-test'] = [{'id': 2, 'role': 'assistant', 'content': 'こんにちは。',
                'model_id':'cloud-claude-haiku', 'reasoning_summary':'直近の会話と設定を確認しました。',
                'reasoning_summary_status':'available'}]
            page.reload()
            summary = page.get_by_label('この返事の公式推論要約', exact=True)
            summary.wait_for()
            assert not summary.evaluate('el => el.open')
            assert summary.evaluate('el => {const reply=el.closest(".k-msg__col").querySelector(".k-bubble");return reply && Boolean(el.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING)}')
            result['official_summary_precedes_reply'] = True
            summary.locator('summary').click()
            summary.get_by_text('直近の会話と設定を確認しました。', exact=True).wait_for()
            assert 'RAW PRIVATE THINKING' not in page.content()
            result['official_summary_persisted_collapsed_after_reload'] = True
            capture('official-summary-390.png')
            draft = page.get_by_label('メッセージ', exact=True)
            draft.fill('認証失効後も残す検証用の下書き')
            authenticated = False
            page.evaluate("location.hash='/profile'")
            page.get_by_role('heading',name='ログイン / 新規登録',exact=True).wait_for()
            assert page.locator('.k-cloud__balance').count() == 0
            status_offline = True
            with page.expect_request(lambda request: request.url.endswith('/api/cloud/status')):
                page.evaluate("window.dispatchEvent(new Event('online'))")
            page.get_by_role('button',name='ログイン状態を再確認',exact=True).wait_for()
            assert page.get_by_role('button',name='Googleで始める').is_disabled()
            status_offline = False
            page.get_by_role('button',name='ログイン状態を再確認',exact=True).click()
            page.get_by_role('button',name='ログイン状態を再確認',exact=True).wait_for(state='hidden')
            authenticated = True
            with page.expect_response(lambda response: response.url.endswith('/api/mobile/status')):
                page.evaluate("window.dispatchEvent(new Event('online'))")
            page.locator('.k-cloud__balance').wait_for()
            page.evaluate("location.hash='/chats/ui-test'")
            page.get_by_label('メッセージ',exact=True).wait_for()
            assert page.get_by_label('メッセージ',exact=True).input_value() == '認証失効後も残す検証用の下書き'
            owner = ''
            with page.expect_response(lambda response: response.url.endswith('/api/mobile/status')):
                page.evaluate("window.dispatchEvent(new Event('focus'))")
            page.get_by_role('button',name='もう一度接続する',exact=True).wait_for()
            assert page.get_by_label('メッセージ',exact=True).count() == 0
            owner = 'ui-test'
            page.get_by_role('button',name='もう一度接続する',exact=True).click()
            page.get_by_label('メッセージ',exact=True).wait_for()
            assert page.get_by_label('メッセージ',exact=True).input_value() == '認証失効後も残す検証用の下書き'
            assert not any("/api/chat/stream" in call for call in calls)
            assert not errors, errors
            assert not blocked, blocked
            assert not any(path in {"/api/chat", "/api/chat/stream"} for path in calls)
            page.get_by_role('button',name='キャラ・プリセット',exact=True).click()
            page.get_by_role('dialog',name='キャラ・プリセット',exact=True).get_by_label('会話モデル',exact=True).select_option('cloud-deepseek-baidu')
            page.keyboard.press('Escape')
            stream_fixture['enabled'] = True
            histories['ui-test'] = [{'id':3,'role':'assistant','content':'Mock completed reply','model_id':'cloud-deepseek-baidu'}]
            page.get_by_label('メッセージ',exact=True).fill('Mock waiting animation check')
            page.get_by_role('button',name='送信',exact=True).click()
            pending_quote = page.get_by_role('region',name='送信前の見積確認',exact=True)
            pending_quote.get_by_role('checkbox').check()
            pending_quote.get_by_role('button',name='送信する',exact=True).click()
            pending_quote.wait_for(state='hidden')
            waiting = page.locator('.k-reply-wait')
            waiting.wait_for()
            for width in (320,390,1440):
                for theme in ('light','dark'):
                    layout('reply-wait',width,theme)
                    assert 'UNSAVED FIXTURE TEXT' not in page.locator('body').inner_text()
                    assert not any(text in page.locator('.k-chat-main').inner_text() for text in ('安全性を確認','送信内容を確認','返事を保存しています'))
            page.emulate_media(reduced_motion='reduce')
            assert waiting.evaluate('el => [el,...el.querySelectorAll("*")].every(node=>getComputedStyle(node).animationName==="none")')
            capture('reply-wait-reduced-motion.png')
            release_stream.set()
            page.get_by_text('Mock completed reply',exact=True).first.wait_for()
            waiting.wait_for(state='hidden')
            page.get_by_label('メッセージ', exact=True).wait_for()
            expect(page.get_by_label('メッセージ', exact=True)).to_have_value('')
            assert len(stream_fixture['requests']) == 1
            assert not errors and not blocked, {'errors':errors,'blocked':blocked}
            result['mock_waiting_stream_requests'] = len(stream_fixture['requests'])
            result['branded_wait_reduced_motion_unsaved_text_hidden_completion'] = True
            result['direct_generation_no_screening_or_credit_reservation'] = True
            page.emulate_media(reduced_motion='no-preference')
            page.get_by_role('button', name='キャラ・プリセット', exact=True).click()
            page.get_by_role('dialog', name='キャラ・プリセット', exact=True).get_by_label('会話モデル', exact=True).select_option('cloud-glm-inferencenet')
            page.keyboard.press('Escape')
            histories['ui-test'] = [{'id': 4, 'role': 'assistant', 'content': 'Ordinary one-click reply', 'model_id': 'cloud-glm-inferencenet'}]
            page.evaluate('''() => {
                window.ordinaryConfirmationSeen = false;
                window.ordinaryQuoteObserver = new MutationObserver(records => {
                    const selector = '[aria-label="送信前の見積確認"],dialog[open],[aria-modal="true"]';
                    if (document.querySelector(selector) || records.some(record => [...record.addedNodes]
                        .some(node => node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))))) {
                        window.ordinaryConfirmationSeen = true;
                    }
                });
                window.ordinaryQuoteObserver.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-modal']});
            }''')
            draft.fill('通常送信のワンクリック試験')
            with page.expect_request(lambda request: urlsplit(request.url).path == '/api/chat/stream'):
                page.get_by_role('button', name='送信', exact=True).click()
            page.get_by_text('Ordinary one-click reply', exact=True).first.wait_for()
            waiting.wait_for(state='hidden')
            assert page.evaluate('() => {window.ordinaryQuoteObserver.disconnect();return !window.ordinaryConfirmationSeen;}'), 'Ordinary send showed a confirmation'
            metadata = page.get_by_label('今回の送信先と消費上限', exact=True)
            metadata.wait_for()
            assert quote_panel.count() == 0 and page.locator('dialog:modal,[aria-modal="true"]').count() == 0
            assert page.get_by_role('button', name='送信する', exact=True).count() == 0
            text = metadata.inner_text()
            ordinary_route = public_route(mock_config, route_id='cloud-glm-inferencenet')
            assert ordinary_route['display_name'] in text and ordinary_route['upstream'] in text and re.search(r'5\s*K-Credits', text), text
            assert metadata.evaluate('el => Boolean(el.compareDocumentPosition(el.parentElement.querySelector("textarea")) & Node.DOCUMENT_POSITION_FOLLOWING)')
            assert draft.input_value() == ''
            assert len(stream_fixture['requests']) == 2
            assert stream_fixture['requests'][-1]['provider_training_consent'] is False
            for width in (320, 390, 1440):
                for theme in ('light', 'dark'):
                    layout('ordinary-one-click-metadata', width, theme)
                    assert metadata.is_visible() and quote_panel.count() == 0
            assert not errors and not blocked, {'errors': errors, 'blocked': blocked}
            result['ordinary_one_click_send_without_modal'] = True
            result['ordinary_quote_metadata_persists_above_composer'] = True
            result['mock_total_stream_requests'] = len(stream_fixture['requests'])
            result.update({
                "status": "passed",
                "chromium": True,
                "physical_android": False,
                "login_consent": True,
                "unconfigured_login_disabled": True,
                "google_oauth_start_mocked": True,
                "email_link_start_mocked": True,
                "cancelled_login_recovers": True,
                "login_online_recovery_without_reload": True,
                "failed_login_status_manual_recovery": True,
                "auth_expiry_draft_recovery_without_reload": True,
                "missing_owner_blocks_workspace": True,
                "live_google_login_verified": False,
                "sync_defaults_off": True,
                "billing_closed": True,
                "private_test_no_billing_controls": True,
                "verified_identity_visible": True,
                "admin_500_credit_balance_visible": True,
                "initial_backend": "openrouter",
                "openrouter_deepseek_fixed": True,
                "muse_unavailable_on_openrouter": True,
                "cloud_adult_toggle_hidden": True,
                "pageerrors": errors,
                "real_inference_attempts": 0,
            })
            assert hashlib.sha256(index.read_bytes()).hexdigest() == index_hash, 'Candidate dist changed during acceptance; rerun against one build.'
            assert all(hashlib.sha256((args.dist / name.lstrip('/')).read_bytes()).hexdigest() == digest
                       for name, digest in entry_assets.items()), 'Candidate entry JS changed during acceptance.'
            print(json.dumps(result))
            browser.close()
    except Exception as exc:
        result['status'] = 'failed'
        result['failure'] = str(exc)
        raise
    finally:
        release_stream.set()
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)
        result.update({'pageerrors': errors, 'blocked_requests': blocked,
                       'anonymous_private_requests': private_guest_requests,
                       'layouts': layouts, 'api_calls': calls,
                       'temporary_server_stopped': not server_thread.is_alive(),
                       'chromium_disconnected': browser is None or not browser.is_connected()})
        (output / 'acceptance.json').write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
        checks = [f'- {key}: {value}' for key, value in result.items() if isinstance(value, bool)]
        report = '\n'.join(['# Mock Chromium Cloud onboarding acceptance', '',
            f"Status: {result['status']}", f'Candidate dist: {args.dist.resolve()}',
            f'index.html SHA256: {index_hash}', '', *checks, '',
            f"Initial guest browsing private API requests: {len(result.get('guest_initial_private_api_requests', []))}",
            f'Expected private API 401 responses during explicit auth-expiry test: {len(private_guest_requests)}',
            f'Blocked/unmocked requests: {len(blocked)}', f'Page errors: {len(errors)}',
            f'Light/dark layout observations (inline quote: 320/390/1440 and 390x600): {len(layouts)}', '',
            'All API responses and OAuth provider pages are mocked. No external or paid requests are sent.',
            'IME events are synthetic Chromium events; physical Android/Japanese IME and live OAuth remain unverified.',
            ('The coordinator confirmed this candidate contains the final Curie tutorial source; it was reused without rebuilding.'
             if args.final_tutorial else 'Tutorial evidence applies to this existing candidate build. Final Curie source needs a matching rebuilt candidate and rerun.'),
            '', f"Failure: {result.get('failure', 'none')}", '',
            'Screenshots are alongside this report. See acceptance.json for the request and layout evidence.'])
        (output / 'REPORT.md').write_text(report, encoding='utf-8')
        if errors:
            print(json.dumps({"pageerrors": errors}, ensure_ascii=False))


if __name__ == "__main__":
    main()
