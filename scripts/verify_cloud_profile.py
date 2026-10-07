"""Two isolated Chromium browsers share a mocked account; no paid inference."""

import functools
import argparse
import http.server
import json
from pathlib import Path
import threading
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".artifacts/cloud-profile-ui"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, default=ROOT / 'apps/web/dist')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(
        QuietHandler, directory=str(args.dist)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    owner = "profile-test"
    profiles = {owner: {"revision": 0, "display_name": "Traveler", "saved_characters": [], "pinned_sessions": []},
                "profile-other": {"revision": 0, "display_name": "別アカウント", "saved_characters": [], "pinned_sessions": []}}
    profile = profiles[owner]
    calls, errors, blocked = [], [], []
    origin = f"http://127.0.0.1:{server.server_port}"

    def mock(route):
        profile = profiles[owner]
        path = route.request.url.split("/api/")[-1].split("?")[0]
        calls.append(path)
        data, status = {}, 200
        if path in {"mobile/status", "cloud/status"}:
            data = {"remote_mode": False, "cloud_mode": True, "authenticated": True,
                    "administrative": False, "owner_scope": owner}
        elif path == "cloud/profile":
            if route.request.method == "PUT":
                body = json.loads(route.request.post_data)
                if body["revision"] != profile["revision"]:
                    data, status = {"error": "profile_conflict"}, 409
                else:
                    profile.update(body["change"])
                    profile["revision"] += 1
                    data = profile
            else:
                data = profile
        elif path == "cloud/account":
            data = {"profile": profile, "identity": {"id": owner, "email": owner + "@example.test"},
                    "private_test": True, "wallet": {"credits": 500, "plan": "free", "used_credits": 0,
                    "reserved_credits": 0, "lots": [{"remaining": 500, "expires": 1793716637, "kind": "admin"}]},
                    "entitlements": {"id": "free", "storage_bytes": 25000000}, "plans": [],
                    "storage_bytes": 200000, "byok_configured": False, "sync": {"mode": "off"},
                    "billing_available": False, "billing_portal_available": False,
                    "routes": [{"provider": "openrouter", "available": True}]}
        elif path == "cloud/backups":
            data = {"backups": []}
        elif path == "chat/sessions":
            data = {"sessions": []}
        elif path == "characters":
            data = {"characters": []}
        else:
            blocked.append('unmocked API: '+path);route.abort('blockedbyclient');return
        route.fulfill(status=status, content_type="application/json", body=json.dumps(data))

    def guard(route):
        url = urlsplit(route.request.url)
        if f'{url.scheme}://{url.netloc}' != origin:
            blocked.append('external: '+route.request.url);route.abort('blockedbyclient')
        elif url.path.startswith('/api/'):
            mock(route)
        else:
            route.continue_()

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            contexts, pages = [], []
            base = f"http://127.0.0.1:{server.server_port}/#/profile"
            for width in (1440, 390):
                context = browser.new_context(viewport={"width": width, "height": 1000 if width > 600 else 844},
                                              service_workers="block", color_scheme="dark")
                context.route("**/*", guard)
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(base, wait_until="networkidle")
                page.locator(".k-cloud__balance").filter(has_text="500").wait_for()
                page.get_by_label("表示名", exact=True).wait_for()
                contexts.append(context)
                pages.append(page)
            first, second = pages
            first.get_by_label("表示名", exact=True).fill("ひろなお")
            first.get_by_role("button", name="表示名を保存", exact=True).click()
            first.wait_for_function("document.querySelector('.k-shell__profile-name').textContent==='ひろなお'")
            second.reload(wait_until="networkidle")
            assert second.get_by_label("表示名", exact=True).input_value() == "ひろなお"
            assert "サーバーのHTTPSアドレス" not in first.locator("body").inner_text()
            assert "アカウント同期は未対応" not in first.locator("body").inner_text()
            assert first.locator(".k-cloud details[open]").count() == 0
            first.screenshot(path=str(output / "profile-desktop-dark.png"), full_page=True)
            second.screenshot(path=str(output / "profile-mobile-dark.png"), full_page=True)
            for page in pages:
                assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
            second.get_by_role("radio", name="ライト", exact=False).click()
            second.screenshot(path=str(output / "profile-mobile-light.png"), full_page=True)
            for detail in second.locator(".k-cloud summary").all():
                detail.click()
            assert second.get_by_label("同期する範囲", exact=True).input_value() == "off"
            assert second.get_by_role("button", name="キーを保存", exact=True).is_disabled()
            assert second.evaluate("document.documentElement.scrollWidth<=innerWidth")
            assert second.get_by_role("button", name="K-Creditsを追加", exact=False).count() == 0
            profile.update(revision=profile["revision"] + 1, display_name="別の端末の名前")
            first.get_by_label("表示名", exact=True).fill("古い編集")
            first.get_by_role("button", name="表示名を保存", exact=True).click()
            first.get_by_role("alert").filter(has_text="別の端末で変更されました").wait_for()
            assert first.get_by_label("表示名", exact=True).input_value() == "別の端末の名前"
            # Cookie changes must remount all account state, without a full reload.
            owner = "profile-other"
            with first.expect_response(lambda response: response.url.endswith('/api/mobile/status')):
                first.evaluate("window.dispatchEvent(new Event('focus'))")
            first.wait_for_function("document.querySelector('.k-shell__profile-name').textContent==='別アカウント'")
            first.get_by_text("アカウント情報・データ管理", exact=True).click()
            first.get_by_text("ログイン中：profile-other@example.test", exact=True).wait_for()
            assert first.get_by_label("表示名", exact=True).input_value() == "別アカウント"
            assert not errors, errors
            assert not blocked, blocked
            assert not any(path in {"chat", "chat/stream", "cloud/quotes"} for path in calls)
            result = {"two_browser_profile_sync": True, "conflict_preserves_latest": True,
                      "desktop_mobile_no_overflow": True, "light_dark": True,
                      "advanced_collapsed": True, "local_server_form_hidden": True,
                      "billing_off": True, "owner_switch_without_reload": True,
                      "real_inference_attempts": 0, "pageerrors": errors,
                      "backend": "mocked"}
            (output / "acceptance.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(json.dumps(result))
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
