"""Cloud plot detail/chat regression in Chromium; strict mocked API, no inference."""

import functools
import http.server
import json
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright
from python.core.prompt_compiler import CHAR_DIR, WORLD_DIR, list_available

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".artifacts/cloud-catalog-ui"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(
        QuietHandler, directory=str(ROOT / "apps/web/dist")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    calls, errors = [], []
    unavailable = False
    settings = {"session_id": "catalog-chat", "character_id": "mocha_sfw",
                "temperature": 0.8, "system_prompt": ""}
    writes = []

    def mock(route):
        url = urlsplit(route.request.url)
        calls.append((route.request.method, url.path, url.query))
        data, status = {}, 200
        if url.path in {"/api/mobile/status", "/api/cloud/status"}:
            data = {"cloud_mode": True, "authenticated": True, "remote_mode": False,
                    "administrative": False, "owner_scope": "catalog-test"}
        elif url.path == "/api/cloud/profile":
            data = {"revision": 0, "display_name": "Traveler", "saved_characters": [], "pinned_sessions": []}
        elif url.path == "/api/characters":
            assert parse_qs(url.query).get("include_nsfw") == ["false"]
            if unavailable:
                data, status = {"error": "cloud_unavailable"}, 503
            else:
                data = {"characters": [c for c in list_available(CHAR_DIR) if not c.get("nsfw")]}
        elif url.path == "/api/worlds":
            data = {"worlds": list_available(WORLD_DIR)}
        elif url.path == "/api/chat/sessions":
            data = {"sessions": []}
        elif url.path == "/api/chat/settings":
            if route.request.method == "PUT":
                settings.update(json.loads(route.request.post_data))
                writes.append(settings.copy())
            data = settings
        elif url.path == "/api/chat/history":
            data = {"history": []}
        elif url.path == "/api/models":
            data = {"models": [{"id": "cloud-standard", "display_name": "Kyalulu Cloud Standard",
                                "provider_type": "openrouter", "provider_model": "deepseek/deepseek-v4.1-flash"}]}
        elif url.path == "/api/personas":
            data = {"personas": []}
        elif url.path == "/api/library":
            data = {"items": []}
        elif url.path == "/api/memory":
            data = {"memories": []}
        elif url.path == "/api/memory/conflicts":
            data = {"conflicts": []}
        elif url.path == "/api/memory/events":
            data = {"events": []}
        elif url.path.startswith("/api/memory/session/"):
            data = {"enabled": False}
        elif url.path == "/api/chat/debug":
            data = {"settings": {}, "state": {}, "compiled": {}}
        assert route.request.method == "GET" or (url.path == "/api/chat/settings" and route.request.method == "PUT"), "no generation allowed"
        route.fulfill(status=status, content_type="application/json", body=json.dumps(data))

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for width in (1440, 390):
                settings["world_id"] = None
                context = browser.new_context(viewport={"width": width, "height": 950}, service_workers="block")
                context.route("**/api/**", mock)
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                base = f"http://127.0.0.1:{server.server_port}"
                page.goto(base + "/#/characters/mocha_sfw", wait_until="networkidle")
                page.get_by_role("heading", name="モカちゃん（日常）", exact=True).wait_for()
                assert "今日は何を飲もうか" in page.locator("body").inner_text()
                assert page.get_by_role("button", name="会話をはじめる", exact=False).is_enabled()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                page.screenshot(path=str(OUTPUT / f"mocha-{width}.png"), full_page=True)
                unavailable = True
                page.reload(wait_until="networkidle")
                page.get_by_text("キャラクターを読み込めませんでした", exact=True).wait_for()
                assert "削除されたか" not in page.locator("body").inner_text()
                unavailable = False
                page.get_by_role("button", name="再読み込み", exact=True).click()
                page.get_by_role("heading", name="モカちゃん（日常）", exact=True).wait_for()
                page.goto(base + "/#/characters/missing", wait_until="networkidle")
                page.get_by_text("キャラクターが見つかりません", exact=True).wait_for()
                before_writes = len(writes)
                page.goto(base + "/#/chats/catalog-chat", wait_until="networkidle")
                try:
                    page.locator(".k-chat-header__name").filter(has_text="モカちゃん").wait_for(timeout=5000)
                except Exception:
                    print(json.dumps({"errors": errors, "body": page.locator("body").inner_text()[:4000], "calls": calls[-25:]}, ensure_ascii=False))
                    raise
                page.wait_for_timeout(1200)
                assert len(writes) == before_writes, "opening an existing chat must not write settings"
                page.get_by_role("button", name="モカちゃん（日常）の情報を表示", exact=True).click()
                page.locator("summary").filter(has_text="会話の設定").click()
                page.get_by_label("舞台", exact=False).select_option("beast_world", timeout=5000)
                page.wait_for_timeout(1200)
                assert len(writes) == before_writes + 1 and writes[-1]["world_id"] == "beast_world"
                page.reload(wait_until="networkidle")
                page.wait_for_timeout(1200)
                assert len(writes) == before_writes + 1, "reading saved edits must not save them again"
                assert "獣人の世界" in page.locator(".k-chat-header__sub").inner_text()
                context.close()
            assert not errors, errors
            result = {"desktop_mobile_plot": True, "error_retry": True, "missing_character": True,
                      "chat_character": True, "unchanged_settings_no_write": True,
                      "edited_settings_saved": True, "inference_requests": 0, "api_requests": len(calls)}
            (OUTPUT / "acceptance.json").write_text(json.dumps(result), encoding="utf-8")
            print(json.dumps(result))
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
