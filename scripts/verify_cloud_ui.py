"""Real Chromium UI with all API calls mocked; zero paid/external inference."""

import functools
import argparse
import http.server
import json
from pathlib import Path
import threading
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".artifacts/cloud-auth-ui-2026-10-04"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, default=ROOT / 'apps/web/dist')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=str(args.dist)
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(
                viewport={"width": 390, "height": 844}, service_workers="block"
            )
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            authenticated = False
            login_available = False
            backend = "openrouter"
            owner = "ui-test"
            status_offline = False
            calls = []
            blocked = []
            base = f"http://127.0.0.1:{server.server_port}"

            def mock(route):
                path = urlsplit(route.request.url).path
                calls.append(path)
                if path in {'/api/chat','/api/chat/stream','/api/cloud/quotes'}:
                    blocked.append(path);route.abort('blockedbyclient');return
                if status_offline and path == '/api/cloud/status':
                    route.abort('internetdisconnected');return
                if not authenticated and path not in {'/api/mobile/status','/api/cloud/status','/api/cloud/auth/login'}:
                    route.fulfill(status=401,content_type='application/json',body='{"error":"authentication_required"}')
                    return
                data = {}
                if path in {"/api/mobile/status", "/api/cloud/status"}:
                    data = {
                        "cloud_mode": True,
                        "remote_mode": False,
                        "authenticated": authenticated,
                        "login_available": login_available,
                        "private_test": True,
                        "administrative": False,
                        "owner_scope": owner,
                        "operator_route": {"provider": backend, "upstream": "InferenceNet" if backend == "openrouter" else None,
                                           "contributor_available": backend == "opencode-go"},
                        "provider_consent_version": "2026-10-03-provider-routing-v2" + (
                            "-openrouter-inferencenet-deepseek-v2" if backend == "openrouter" else ""),
                    }
                elif path == "/api/cloud/profile":
                    data = {"revision": 0, "display_name": "Traveler", "saved_characters": [], "pinned_sessions": []}
                elif path == "/api/cloud/account":
                    data = {
                        "wallet": {"credits": 500, "plan": "free", "lots": []},
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
                    assert body["adult"] is True and body["consent"] is True
                    assert body["operator_backend"] == "openrouter"
                    assert body["provider_disclosure_version"].endswith("openrouter-inferencenet-deepseek-v2")
                    data={"url":"https://supabase.test/auth/v1/authorize"} if body.get("provider")=="google" else {"sent":True}
                elif path == "/api/cloud/backups":
                    data = {"backups": []}
                elif path == "/api/chat/sessions":
                    data = {"sessions": []}
                elif path == "/api/characters":
                    data = {"characters": []}
                elif path == "/api/worlds":
                    data = {"worlds": []}
                elif path == "/api/models":
                    data = {
                        "models": [
                            {
                                "id": "cloud-standard",
                                "display_name": "Kyalulu Cloud Standard",
                                "provider_type": "openrouter",
                                "provider_model": "auto",
                            }
                        ]
                    }
                elif path == "/api/chat/history":
                    data = {"history": []}
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
                    data = {
                        "session_id": "ui-test",
                        "system_prompt": "",
                        "temperature": 0.8,
                    }
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
            page.goto(base)
            page.get_by_role(
                "heading", name="キャラクターと、記憶や世界を持ち続ける。", exact=True
            ).wait_for()
            page.get_by_text("生成と安全検査はOpenRouter経由で", exact=False).wait_for()
            page.get_by_text("この環境のログインは準備中です。",exact=True).wait_for()
            assert "OpenCode Go" not in page.locator("body").inner_text()
            assert page.get_by_role("button", name="Googleで始める").is_disabled()
            login_available = True
            with page.expect_response(lambda response: response.url.endswith('/api/cloud/status')):
                page.evaluate("window.dispatchEvent(new Event('online'))")
            page.get_by_text("この環境のログインは準備中です。",exact=True).wait_for(state='hidden')
            for checkbox in page.get_by_role("checkbox").all():
                checkbox.check()
            assert page.get_by_role("button", name="Googleで始める").is_enabled()
            page.screenshot(path=str(output / "cloud-login-390.png"), full_page=True)
            page.get_by_label("メールアドレス",exact=True).fill("owner@example.test")
            page.get_by_role("button",name="メールリンクを送る",exact=True).click()
            page.get_by_text("確認メールを送りました。このブラウザでリンクを開いてください。",exact=True).wait_for()
            page.get_by_role("button",name="Googleで始める",exact=True).click()
            page.get_by_role("heading",name="Simulated OAuth provider",exact=True).wait_for()
            page.goto(base+"/#/?login_error=login_cancelled")
            page.get_by_text("ログインをキャンセルしました。もう一度Googleまたはメールでログインできます。",exact=True).wait_for()
            assert "login_error" not in page.url
            authenticated = True
            page.goto(base + "/#/profile")
            page.reload()
            page.locator(".k-cloud__balance").filter(has_text="500").wait_for()
            page.get_by_text("アカウント情報・データ管理", exact=True).click()
            page.get_by_text("ログイン中：owner@example.test", exact=True).wait_for()
            assert page.get_by_label("同期する範囲", exact=True).input_value() == "off"
            assert page.get_by_role("button", name="契約・解約・請求を管理").count() == 0
            assert page.get_by_role("button", name="K-Creditsを追加", exact=False).count() == 0
            assert page.get_by_text("成人向けコンテンツ", exact=True).count() == 0
            page.screenshot(path=str(output / "cloud-account-390.png"), full_page=True)
            page.goto(base + "/#/chats/ui-test")
            page.get_by_role("button", name="キャラ・プリセット", exact=True).click()
            models = page.get_by_label("クラウドの会話モデル", exact=False)
            assert models.locator('option[value="contributor"]').count() == 0
            assert models.locator('option[value="structured"]').count() == 0
            assert page.get_by_role("checkbox", name="この1回の生成で送る", exact=False).count() == 0
            assert page.get_by_role("alert").count() == 0
            models.select_option("auto")
            assert models.input_value() == "auto"
            page.screenshot(path=str(output / "cloud-route-openrouter-390.png"), full_page=True)
            page.keyboard.press('Escape')
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
            result = {
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
            }
            (output / "acceptance.json").write_text(
                json.dumps(result, indent=2), encoding="utf-8"
            )
            print(json.dumps(result))
            browser.close()
    finally:
        if errors:
            print(json.dumps({"pageerrors": errors}, ensure_ascii=False))
        server.shutdown()


if __name__ == "__main__":
    main()
