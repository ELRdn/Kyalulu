"""Interrupt an admitted Cloud generation with a real loopback Caddy switch."""
import argparse
import asyncio
import base64
from contextlib import ExitStack, closing
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from uuid import uuid4

from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
import httpx
from playwright.async_api import async_playwright, expect

from e2e_online_character_baseline import fixture
from e2e_online_coexistence import CARD, ROOT, complete_login_and_chat, process
from e2e_unified_proxy import free_port, ready
from python.cloud.app import create_app
from python.cloud.auth import provider_consent_version
from test_cloud_cost_accounting import VALID_OUTPUT, config as metered_config, generation_response, screened_response


async def run(dist, caddy, online):
    build_id = (online / ".next/BUILD_ID").read_text(encoding="ascii").strip()
    release = json.loads((dist.parent / "online-release.json").read_text(encoding="utf-8"))
    assert release["next_build_id"] == build_id
    proxy_port, node_port = free_port(), free_port()
    assert proxy_port != node_port
    origin = f"https://localhost:{proxy_port}"
    owner = str(uuid4())
    slots = []
    entered, finish = asyncio.Event(), asyncio.Event()
    call_count = 0
    waiting_reply = None

    async def provider(request):
        nonlocal call_count
        if request.url.host == "supabase.test":
            if request.url.path == "/auth/v1/token":
                return httpx.Response(200, json={"access_token": "fixture", "refresh_token": "fixture", "expires_in": 3600})
            assert request.url.path == "/auth/v1/user"
            return httpx.Response(200, json={"id": owner, "email": "owner@example.test",
                                             "email_confirmed_at": "2026-01-01", "user_metadata": {}})
        assert request.url.host == "openrouter.ai" and request.url.path.endswith("/chat/completions")
        if not json.loads(request.content).get("stream"):
            return screened_response(.000003001, case="valid")
        call_count += 1
        result = json.loads(VALID_OUTPUT)
        if waiting_reply:
            result["reply"] = waiting_reply
            entered.set()
            await asyncio.wait_for(finish.wait(), 45)
        return generation_response(json.dumps(result), {"prompt_tokens": 10, "completion_tokens": 5, "cost": .00001})

    def build_app(base):
        config = replace(metered_config(base.root), origin=origin, web_dist=dist,
                         private_test=False, legal_approved=True, signup_limit=2, monthly_subsidy_jpy=3000,
                         unified_enabled=True, region_policies=(("JP", {"accepted": True, "version": "fixture"}),),
                         supabase_url="https://supabase.test", supabase_key="fixture")
        app = create_app(config, transport=httpx.MockTransport(provider))
        store = app.state.store
        store.account(owner, consent=provider_consent_version(config))
        store.admin_grant(owner, 500, "fixture-grant")
        slots.append(store)
        return app

    with TemporaryDirectory(dir=ROOT / ".artifacts", prefix="ar-") as temp, ExitStack() as proxy:
        tmp = Path(temp)
        config = tmp / "Caddyfile"
        site = (ROOT / "deploy/cloud/Caddyfile.unified.example").read_text(encoding="utf-8")
        site = site.replace("{$APP_DOMAIN} {", f"localhost:{proxy_port} {{\n bind 127.0.0.1\n tls internal")
        config.write_text("{\n admin off\n auto_https disable_redirects\n skip_install_trust\n}\n" + site, encoding="utf-8")
        async with fixture(dist, origin, build_app) as upstream, async_playwright() as pw:
            env = dict(os.environ, KYALULU_PUBLIC_ORIGIN=origin, NEXT_TELEMETRY_DISABLED="1",
                       CLOUD_UPSTREAM=upstream, ONLINE_UPSTREAM=f"127.0.0.1:{node_port}", RELAY_DOMAIN="relay.test",
                       ONLINE_COHORT="all", ONLINE_ASSETS="on", ONLINE_PACKAGED_ASSETS="on",
                       XDG_DATA_HOME=str(tmp / "data"), XDG_CONFIG_HOME=str(tmp / "config"))

            async def switch(mode):
                proxy.close()
                switches = {"ONLINE_" + group: mode for group in ("CHARACTER", "ENTRY", "CHATS", "PAGES", "BROWSE", "FALLBACK")}
                child = proxy.enter_context(process([str(caddy), "run", "--config", str(config)], ROOT,
                                                    {**env, **switches}, tmp, "proxy-" + mode))
                await ready(origin + "/api/health", child, verify=False)

            await switch("on")
            env["NODE_EXTRA_CA_CERTS"] = str(next((tmp / "data").rglob("root.crt")))
            cert = x509.load_pem_x509_certificate(next((tmp / "data").rglob("localhost.crt")).read_bytes())
            key = cert.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
            pin = base64.b64encode(hashlib.sha256(key).digest()).decode()
            with process(["node", str(online / "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", str(node_port)],
                         online, env, tmp, "next") as node:
                await ready(origin + CARD, node, verify=False)
                browser = await pw.chromium.launch(args=["--no-proxy-server", "--ignore-certificate-errors-spki-list=" + pin])
                try:
                    context = await browser.new_context(locale="ja-JP", service_workers="block")
                    async def only_loopback(route):
                        if urlsplit(route.request.url).netloc == urlsplit(origin).netloc:
                            await route.continue_()
                        else:
                            await route.abort()
                    await context.route("**/*", only_loopback)
                    page = await context.new_page()
                    posts = []
                    def observe(request):
                        if request.method == "POST" and urlsplit(request.url).path in ("/api/chat", "/api/chat/stream"):
                            posts.append(request.post_data_json["generation_id"])
                    page.on("request", observe)
                    await page.goto(origin + CARD)
                    await complete_login_and_chat(context, page, origin)
                    session_url = page.url
                    session = urlsplit(session_url).path.rsplit("/", 1)[1]
                    history = page.locator(".k-chat-messages")
                    composer = page.locator(".k-composer textarea")
                    held_chunk = await page.locator('script[src^="/_next/static/"]').first.get_attribute("src")
                    assert held_chunk and call_count == 1
                    ids, results, persisted = [], [], []

                    for mode, reload_pending in (("off", False), ("on", True)):
                        entered.clear()
                        finish.clear()
                        waiting_reply = "確認の返事 " + mode
                        message = "続きのテスト " + mode
                        await page.evaluate("window.activeRolloutDocument = true")
                        await composer.fill(message)
                        async with page.expect_request(lambda req: urlsplit(req.url).path == "/api/chat/stream") as submitted:
                            await page.locator(".k-composer__send").click()
                        request = await submitted.value
                        generation = request.post_data_json["generation_id"]
                        ids.append(generation)
                        await asyncio.wait_for(entered.wait(), 15)
                        response = await request.response()
                        assert response and response.ok
                        status_url = f"/api/chat/generations/{generation}?session_id={session}"
                        status = await page.evaluate("async url => (await fetch(url)).json()", status_url)
                        assert status["status"] == "pending"
                        async with page.expect_event("requestfailed", predicate=lambda failed: failed is request):
                            await switch(mode)
                        if reload_pending:
                            await page.reload()
                            await expect(page.get_by_text("前の送信は処理中です。", exact=False)).to_be_visible()
                        else:
                            assert await page.evaluate("document.documentElement.dataset.kyaluluFrontend === 'next'")
                        finish.set()
                        await expect(history.get_by_text(waiting_reply, exact=True)).to_have_count(1)
                        await expect(history.get_by_text(message, exact=True)).to_have_count(1)
                        status = await page.evaluate("async url => (await fetch(url)).json()", status_url)
                        assert status["status"] == "completed" and status["user_id"] and status["assistant_id"]
                        await expect(page.locator(".k-chat-failed"), "Recovered replies must clear the failed-send alert").to_have_count(0)
                        if not reload_pending:
                            assert await page.evaluate("window.activeRolloutDocument === true")
                        persisted.extend((("user", message, status["user_id"]), ("assistant", waiting_reply, status["assistant_id"])))
                        await page.reload()
                        await expect(history.get_by_text(waiting_reply, exact=True)).to_have_count(1)
                        assert (await page.locator('script[src^="/_next/static/"]').count() > 0) == (mode == "on")
                        assert page.url == session_url
                        assert await page.evaluate("async url => (await fetch(url)).ok", held_chunk)
                        results.append({"target": "next" if mode == "on" else "legacy", "reloaded_while_pending": reload_pending,
                                        "sse_interrupted": True, "same_conversation": True, "completed_once": True})
                finally:
                    finish.set()
                    await browser.close()
                store = slots[0]
                assert len(set(ids)) == 2 and call_count == 3 and len(posts) == 3 and posts[1:] == ids
                with store.transaction() as db:
                    operations = db.execute("SELECT id, state, charged_credits FROM operations WHERE owner=?", (owner,)).fetchall()
                    assert len(operations) == 3 and set(ids) <= {op["id"] for op in operations}
                    assert all(op["state"] == "completed" and op["charged_credits"] > 0 for op in operations)
                    assert store.balance(owner, db) == 500 - sum(op["charged_credits"] for op in operations)
                    for table in ("credit_holds", "fund_holds"):
                        assert db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
                with closing(sqlite3.connect(store.config.root / "tenants" / owner / "data.db")) as db:
                    for role, content, message_id in persisted:
                        assert db.execute("SELECT id FROM chat_history WHERE session_id=? AND role=? AND content=?",
                                          (session, role, content)).fetchall() == [(message_id,)]
                print(json.dumps({"build": build_id, "switches": results, "browser_posts": len(posts), "model_calls": call_count,
                                  "settled_credit_operations": len(operations), "outstanding_holds": 0}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--caddy", type=Path, required=True)
    parser.add_argument("--online", type=Path, default=ROOT / "apps/online")
    args = parser.parse_args()
    asyncio.run(run(args.dist.resolve(), args.caddy.resolve(), args.online.resolve()))
