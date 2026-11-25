"""Run the built Next page and its predecessor behind the actual Caddy site policy."""
import argparse
import asyncio
import base64
from contextlib import closing, contextmanager
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sqlite3
from time import monotonic
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4

import httpx
import psutil
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from playwright.async_api import async_playwright, expect
from urllib.parse import urlsplit
from e2e_unified_proxy import free_port, ready
from e2e_online_character_baseline import fixture, sample
from online_chat_checks import CHUNK_RETRY_DRAFT, check_chat, check_chat_chunk_recovery, check_opening_proxy_fallback
from online_page_checks import check_guest_pages, check_member_pages, check_page_recovery, check_publication_visibility
from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE, provider_consent_version
from test_cloud_cost_accounting import config as metered_config, generation_response, screened_response, VALID_OUTPUT

ROOT = Path(__file__).resolve().parents[1]
CARD = "/characters/mocha_sfw"
CHUNK_SESSION = "fixture-chunk-recovery-session"


@contextmanager
def process(command, cwd, env, directory, name):
    with (directory / (name + ".log")).open("wb") as log:
        child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            yield child
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()


async def run(dist, caddy, samples, online):
    proxy, next_port = free_port(), free_port()
    assert proxy != next_port
    origin = f"https://localhost:{proxy}"
    owner = str(uuid4())
    other_owner = str(uuid4())
    recovery_owner = str(uuid4())
    apps = []

    def build_app(base):
        config = replace(metered_config(base.root), origin=origin, web_dist=base.web_dist,
                         private_test=False, legal_approved=True, signup_limit=3, monthly_subsidy_jpy=3000,
                         community_enabled=True, moderator_owners=(other_owner,),
                         unified_enabled=True, region_policies=(("JP", {"accepted": True, "version": "fixture"}),),
                         supabase_url="https://supabase.test", supabase_key="fixture")

        def provider(request):
            if request.url.host == "supabase.test":
                if request.url.path == "/auth/v1/token":
                    return httpx.Response(200, json={"access_token": "fixture", "refresh_token": "fixture", "expires_in": 3600})
                assert request.url.path == "/auth/v1/user"
                session_owner = {"Bearer other-fixture": other_owner,
                                 "Bearer chunk-fixture": recovery_owner}.get(request.headers.get("authorization"), owner)
                return httpx.Response(200, json={"id": session_owner, "email": "owner@example.test",
                                                  "email_confirmed_at": "2026-01-01", "user_metadata": {}})
            assert request.url.host == "openrouter.ai" and request.url.path.endswith("/chat/completions")
            if json.loads(request.content).get("stream"):
                return generation_response(VALID_OUTPUT, {"prompt_tokens": 10, "completion_tokens": 5, "cost": .00001})
            return screened_response(.000003001, case="valid")

        app = create_app(config, transport=httpx.MockTransport(provider))
        app.state.store.account(owner, consent=provider_consent_version(config))
        for account_owner, session, access_token in ((other_owner, "fixture-second-session", "other-fixture"),
                                                       (recovery_owner, CHUNK_SESSION, "chunk-fixture")):
            app.state.store.account(account_owner, consent=provider_consent_version(config))
            eligibility = app.state.store.unified_service.general_eligibility("JP", 25)
            app.state.store.secret(account_owner, "app-eligibility", json.dumps(eligibility))
            app.state.auth.save(session, account_owner, {
                "access_token": access_token, "refresh_token": "unused-fixture", "expires_in": 3600,
            })
        app.state.store.admin_grant(owner, 500, "fixture-grant")
        app.state.store.admin_grant(recovery_owner, 500, "fixture-recovery-grant")
        apps.append(app)
        return app

    async with fixture(dist, origin, build_app) as upstream:
        original, branch = await exercise(origin, upstream, proxy, next_port, caddy, samples, online,
                                          packaged_assets=(dist / "_next/static").is_dir())
        store = apps[0].state.store
        with store.transaction() as db:
            operations = db.execute("SELECT state,charged_credits,route FROM operations WHERE owner=?", (owner,)).fetchall()
            assert len(operations) == 6 and all(row["state"] == "completed" and row["charged_credits"] > 0 for row in operations)
            assert store.balance(owner, db) == 500 - sum(row["charged_credits"] for row in operations)
            assert db.execute("SELECT count(*) FROM operations WHERE owner=?", (other_owner,)).fetchone()[0] == 0
            recovery = db.execute("SELECT state,charged_credits FROM operations WHERE owner=?", (recovery_owner,)).fetchall()
            assert len(recovery) == 1 and recovery[0]["state"] == "completed" and recovery[0]["charged_credits"] > 0
            assert store.balance(recovery_owner, db) == 500 - recovery[0]["charged_credits"]
            for table in ("credit_holds", "fund_holds"):
                assert db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
        with closing(sqlite3.connect(store.config.root / "tenants" / owner / "data.db")) as db:
            assert db.execute("SELECT count(*), count(DISTINCT session_id) FROM chat_history WHERE role='user' AND content=? AND session_id!=?",
                              ("お待たせ", branch)).fetchone() == (3, 3)
            assert db.execute("SELECT count(*) FROM chat_history WHERE session_id=? AND role='user' AND content=?",
                              (original, "fixture recovery turn")).fetchone()[0] == 1
            assert db.execute("SELECT count(*) FROM chat_history WHERE role='user' AND content=?",
                              ("fixture signed-in first turn",)).fetchone()[0] == 1
            assert db.execute("SELECT count(*) FROM generations WHERE status='cancelled' AND session_id=?", (original,)).fetchone()[0] == 1
        with closing(sqlite3.connect(store.config.root / "tenants" / recovery_owner / "data.db")) as db:
            assert db.execute("SELECT count(*) FROM chat_history WHERE role='user' AND content=?",
                              (CHUNK_RETRY_DRAFT,)).fetchone()[0] == 1
    print("Verified Cloud chat start, interruption recovery, regeneration, branch, deletion, ledger, rollback and offline restart.")


async def complete_login_and_chat(context, page, origin):
    async def mock_authorization(route):
        await route.fulfill(status=302, headers={"Location": origin + "/auth/callback?code=fixture"})

    await context.route("https://supabase.test/auth/v1/authorize**", mock_authorization)
    await page.get_by_role("textbox", name="最初のメッセージ").fill("お待たせ")
    await page.locator("article form").evaluate("form => { form.requestSubmit(); form.requestSubmit(); }")
    sheet = page.locator(".k-cloud-login__sheet")
    await sheet.get_by_role("combobox", name="地域").select_option("JP")
    await sheet.get_by_role("spinbutton").fill("25")
    await sheet.get_by_role("checkbox", name="利用規約", exact=False).check()
    started = monotonic()
    await sheet.get_by_role("button", name="Googleで続ける").click()
    await page.wait_for_url("**/chats/chat_*")
    restored = monotonic()
    reply = page.locator(".k-chat-messages").get_by_text("hello", exact=True)
    await reply.wait_for()
    elapsed = round((monotonic() - started) * 1000)
    timings = await page.evaluate("""() => {
      const key = Object.keys(sessionStorage).find(k => k.startsWith('kyalulu-client-timings-v1:'));
      const v = key && Object.values(JSON.parse(sessionStorage.getItem(key))).at(-1);
      return v && Object.fromEntries(['context_fetch_ms','quote_fetch_ms','quote_consent_ms','post_to_first_body_ms','post_to_full_ms']
        .map(k => [k, typeof v[k] === 'number' ? Math.round(v[k]) : null]));
    }""")
    assert timings and timings["post_to_full_ms"] is not None
    print(json.dumps({"fixture_login_to_chat_ms": round((restored-started)*1000),
                      "fixture_login_to_reply_ms": elapsed, "client": timings}), flush=True)
    assert await page.locator('script[src*="/_next/static/"]').count()
    await page.reload()
    await reply.wait_for()
    assert await page.locator('script[src*="/_next/static/"]').count()


async def check_cohort(origin, ca, wave):
    cookie = "__Host-kyalulu-bucket"
    async with httpx.AsyncClient(base_url=origin, verify=str(ca), trust_env=False) as client:
        initial = await client.get(CARD, headers={"Accept": "text/html"})
        assert initial.status_code == 200 and "/_next/static/" not in initial.text
        bucket = initial.cookies.get(cookie)
        assert bucket in {"pilot", "beta", "stable"}, ("cohort enrollment", wave, bucket)
        assert "no-store" in initial.headers["cache-control"]
        for value in (bucket, "pilot", "beta", "stable", "invalid"):
            headers = {"Cookie": f"{cookie}={value}", "Accept": "text/html"}
            page = await client.get(CARD, headers=headers)
            status = await client.get("/api/mobile/status", headers={"Cookie": headers["Cookie"]})
            eligible = value == "pilot" or wave == "quarter" and value == "beta"
            assert page.status_code == status.status_code == 200 and cookie not in page.cookies
            assert ("/_next/static/" in page.text) == eligible
            assert (status.headers.get("X-Kyalulu-Next-Chats") == "1") == eligible


async def exercise(origin, upstream, proxy, next_port, caddy, samples, online, *, packaged_assets):
    manifest = json.loads((online / '.next/react-loadable-manifest.json').read_text(encoding='utf-8'))
    module_files = {key.rsplit(' -> ', 1)[-1]: set(entry['files']) for key, entry in manifest.items()
                    if 'chatRouteModules.ts' in key}
    chat_scripts = {path for path in module_files['../../../web/src/pages/ActiveChat'] - module_files['./Runtime']
                    if path.endswith('.js')}
    assert chat_scripts
    create_entry = next(entry for key, entry in manifest.items() if key.endswith(' -> ../../../web/src/pages/Create'))
    create_scripts = {path for path in create_entry['files'] if path.endswith('.js')
                      and b'k-create--guest' in (online / '.next' / path).read_bytes()}
    assert create_scripts
    markdown_chunks = set()
    for chunk in (online / '.next/static/chunks').glob('*.js'):
        body = chunk.read_bytes()
        if b'micromark' in body and b'mdast' in body:
            markdown_chunks.add(chunk.name)
    assert markdown_chunks

    with TemporaryDirectory(dir=ROOT / ".artifacts", prefix="on-") as directory:
        tmp = Path(directory)
        policy = (ROOT / "deploy/cloud/Caddyfile.unified.example").read_text(encoding="utf-8")
        policy = policy.replace('{$APP_DOMAIN} {', f'localhost:{proxy} {{\n bind 127.0.0.1\n tls internal')
        config = tmp / "Caddyfile"
        config.write_text("{\n admin off\n auto_https disable_redirects\n skip_install_trust\n}\n" + policy,
                          encoding="utf-8")
        env = {**os.environ, "KYALULU_PUBLIC_ORIGIN": origin,
               "ONLINE_UPSTREAM": f"127.0.0.1:{next_port}", "CLOUD_UPSTREAM": upstream,
               "RELAY_DOMAIN": "relay.test", "NEXT_TELEMETRY_DISABLED": "1",
               "XDG_DATA_HOME": str(tmp / "data"), "XDG_CONFIG_HOME": str(tmp / "config")}
        with process([str(caddy), "run", "--config", str(config)], ROOT, env, tmp, "bootstrap") as bootstrap:
            await ready(origin + "/api/health", bootstrap, verify=False)
            env["NODE_EXTRA_CA_CERTS"] = str(next((tmp / "data").rglob("root.crt")))
            certificate = x509.load_pem_x509_certificate(next((tmp / "data").rglob("localhost.crt")).read_bytes())
            spki = certificate.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
            pin = base64.b64encode(hashlib.sha256(spki).digest()).decode()
            options = {"args": ["--ignore-certificate-errors-spki-list=" + pin], "locale": "ja-JP"}
        with patch.dict(os.environ, {"NODE_EXTRA_CA_CERTS": env["NODE_EXTRA_CA_CERTS"]}), process(["node", str(online / "node_modules/next/dist/bin/next"),
                     "start", "-H", "127.0.0.1", "-p", str(next_port)], online, env, tmp, "next") as node:
            async with async_playwright() as pw:
                profile = tmp / "browser"
                context = await pw.chromium.launch_persistent_context(profile, **options)
                try:
                    page = await context.new_page()
                    violations = []
                    page.on("pageerror", lambda error: violations.append(str(error)))
                    await page.add_init_script("""document.addEventListener('securitypolicyviolation',e=>{
                      (window.policyViolations ||= []).push(e.effectiveDirective);
                    });""")
                    chunk = None
                    rollback_cookies = None
                    for mode in ("off", "on", "off"):
                        with process([str(caddy), "run", "--config", str(config)], ROOT,
                                     {**env, "ONLINE_CHARACTER": mode, "ONLINE_CHATS": mode, "ONLINE_PAGES": mode, "ONLINE_BROWSE": mode, "ONLINE_ENTRY": mode,
                                     "ONLINE_ASSETS": "on", "ONLINE_FALLBACK": "on",
                                     "ONLINE_PACKAGED_ASSETS": "on" if packaged_assets else "off"}, tmp, "proxy") as server:
                            await ready(origin + "/api/health", server, verify=False)
                            if samples and not chunk:
                                lab = await pw.chromium.launch(args=options["args"])
                                try:
                                    values = [await sample(lab, origin, CARD) for _ in range(samples)]
                                    print(json.dumps({"mode": mode, "chromium": lab.version, "samples": values}), flush=True)
                                finally:
                                    await lab.close()
                            if not chunk and mode == "off":
                                await page.goto(origin + "/")
                                await asyncio.wait_for(page.evaluate("""async () => {
                                  if (navigator.serviceWorker.controller) return;
                                  const registration = await navigator.serviceWorker.register('/sw.js', {scope:'/'});
                                  await new Promise((resolve,reject) => {
                                    const worker = registration.installing || registration.waiting || registration.active;
                                    const changed = () => {
                                      if (navigator.serviceWorker.controller) resolve(true);
                                      if (worker?.state === 'redundant') reject(Error('Shell install rejected'));
                                    };
                                    navigator.serviceWorker.addEventListener('controllerchange',changed);
                                    worker?.addEventListener('statechange',changed);
                                    changed();
                                  });
                                }"""), timeout=120)
                                await context.add_cookies([{"name": "coexistence_fixture", "value": "yes", "url": origin,
                                                            "secure": True, "httpOnly": True, "sameSite": "Lax"}])
                            ca = next((tmp / "data").rglob("root.crt"))
                            async with httpx.AsyncClient(base_url=origin, verify=str(ca), trust_env=False) as client:
                                result = await client.get(CARD, headers={"Accept": "text/html"})
                                assert result.status_code == 200, (mode, result.status_code,
                                                                  (tmp / "next.log").read_text(errors="replace"))
                                assert len(result.headers.get_list("content-security-policy")) == 1
                                assert ("_next/static" in result.text) == (mode == "on")
                                assert "モカちゃん（日常）" in result.text and "noindex" in result.headers["x-robots-tag"]
                                assert "no-store" in result.headers["cache-control"]
                                if mode == "on":
                                    html = result.text
                                    missing = await client.get("/unknown/online/route", headers={"Accept": "text/html"})
                                    assert missing.status_code == 404 and "/_next/static/" in missing.text
                                    assert "nonce-" in missing.headers["content-security-policy"]
                                    for marker in ("og:title", "og:image", 'rel="canonical"', "猫の獣人のお姉さん"):
                                        assert marker in html
                                    component = await client.get(CARD, headers={"RSC": "1"})
                                    assert "no-store" in component.headers["cache-control"]
                                assert (await client.get("/device/")).headers["cross-origin-embedder-policy"] == "require-corp"
                                assert (await client.get("/migration/")).headers["cross-origin-embedder-policy"] == "unsafe-none"
                                if chunk:
                                    assert (await client.get(chunk)).status_code == 200
                            await page.goto(origin + CARD)
                            assert any(c["name"] == "coexistence_fixture" and c["httpOnly"] for c in await context.cookies(origin))
                            await page.get_by_role("heading", name="モカちゃん（日常）").wait_for()
                            if mode == "on":
                                chunk = await page.locator('script[src*="/_next/static"]').first.get_attribute("src")
                                assert chunk
                                await check_guest_pages(page, origin)
                                await page.goto(origin + CARD)
                                composer = page.get_by_role("textbox", name="最初のメッセージ")
                                await composer.fill("お待たせ")
                                await page.reload()
                                await composer.wait_for()
                                assert await composer.input_value() == "お待たせ"
                                await composer.press("Enter")
                                await page.locator(".k-cloud-login__sheet").wait_for()
                                assert await page.evaluate("""JSON.parse(sessionStorage.getItem('kyalulu-pending-start')).text === 'お待たせ'""")
                                await page.keyboard.press("Escape")
                                await expect(page.get_by_role("dialog")).to_have_count(0)
                                await page.reload()
                                await expect(composer).to_have_value("お待たせ")
                                await composer.fill("編集した下書き")
                                await page.reload()
                                await expect(composer).to_have_value("編集した下書き")
                                assert await page.evaluate("sessionStorage.getItem('kyalulu-pending-start') === null")
                                await page.go_back()
                                await page.get_by_role("heading", name="モカちゃん（日常）").wait_for()
                                await page.reload()
                                assert await page.locator("article img").evaluate("img => img.complete && img.naturalWidth > 0")
                                await complete_login_and_chat(context, page, origin)
                                original, branch = await check_chat(page, origin)
                                created_item, publication = await check_member_pages(page, origin)
                                await check_publication_visibility(page, origin, ca, publication, visible=False)
                                await page.goto(origin + "/chats/" + original)
                                rollback_cookies = await context.cookies(origin)
                                private_draft = page.locator(".k-composer textarea")
                                await private_draft.fill("fixture first owner draft")
                                await context.add_cookies([{"name": SESSION_COOKIE, "value": "fixture-second-session",
                                                            "url": origin, "secure": True, "httpOnly": True, "sameSite": "Lax"}])
                                async with page.expect_response(lambda res: urlsplit(res.url).path == "/api/mobile/status"):
                                    await page.evaluate("window.dispatchEvent(new Event('focus'))")
                                await expect(private_draft).to_have_value("")
                                await expect(page.locator(".k-chat-messages").get_by_text("fixture recovery turn", exact=True)).to_have_count(0)
                                # An old client wrote a first line without an owner. This tenant
                                # cannot list the original session and must never hydrate the text.
                                await page.evaluate("history.replaceState({...history.state,usr:{send:'fixture old first line'}},'')")
                                await page.reload()
                                await expect(private_draft).to_be_editable()
                                await expect(private_draft).to_have_value("")
                                await page.goto(origin + "/publications")
                                await page.get_by_role("heading", name="審査キュー").wait_for()
                                await page.get_by_label("理由", exact=True).fill("Fixture review")
                                await page.locator("article").get_by_role("checkbox").check()
                                await page.get_by_role("button", name="承認して公開", exact=True).click()
                                await page.get_by_role("dialog").get_by_role("button", name="判断を記録", exact=True).click()
                                await page.get_by_role("link", name="公開版を確認", exact=True).wait_for()
                                await check_publication_visibility(page, origin, ca, publication, visible=True)
                                # FastAPI maps a missing library revision to invalid_input.
                                # The other owner must see exactly the same response for a foreign and an absent ID.
                                hidden = await page.evaluate("""async id => {
                                  const read = async key => {
                                    const reply = await fetch('/api/library/' + key);
                                    return [reply.status, await reply.text()];
                                  };
                                  const foreign = await read(id), absent = await read('lib_fixture_missing');
                                  return {status:foreign[0], same:JSON.stringify(foreign)===JSON.stringify(absent),
                                    disclosed:foreign[1].includes('Fixture private character')};
                                }""", created_item)
                                assert hidden == {"status": 400, "same": True, "disclosed": False}, hidden
                                await context.add_cookies(rollback_cookies)
                                await page.goto(origin + "/publications")
                                await page.get_by_role("button", name="取り下げる", exact=True).click()
                                await page.get_by_role("dialog").get_by_role("button", name="取り下げる", exact=True).click()
                                await page.locator("article p").filter(has_text="取り下げ済み").first.wait_for()
                                await check_publication_visibility(page, origin, ca, publication, visible=False)
                                await page.goto(origin + "/chats/" + original)
                                await expect(private_draft).to_have_value("fixture first owner draft")
                                await private_draft.fill("")
                                await page.evaluate("history.replaceState({...history.state,usr:{send:'fixture old first line'}},'')")
                                await page.reload()
                                await expect(private_draft).to_have_value("fixture old first line")
                                await private_draft.fill("fixture first owner draft")
                                first_sends = []
                                first_quotes = []
                                context_reads = []
                                handoff_documents = []
                                profile_handoffs = []
                                setup_writes = []
                                split_intro_writes = []
                                repeated_settings = []
                                pre_setup_catalog_reads = []
                                markdown_requested = asyncio.Event()
                                resume_markdown = asyncio.Event()

                                def markdown_url(url):
                                    return urlsplit(url).path.rsplit('/', 1)[-1] in markdown_chunks

                                async def hold_markdown(route):
                                    markdown_requested.set()
                                    await resume_markdown.wait()
                                    await route.continue_()

                                def observe_member_start(request):
                                    url = urlsplit(request.url)
                                    if request.method == "POST" and url.path in {"/api/chat", "/api/chat/stream"}:
                                        first_sends.append(request)
                                    if request.method == "POST" and url.path == "/api/cloud/quotes":
                                        first_quotes.append(request)
                                    if request.method == "GET" and url.path.startswith("/api/chat/context/"):
                                        context_reads.append(request)
                                    if request.method == "PUT" and url.path == "/api/chat/settings/opening":
                                        setup_writes.append(request)
                                    if request.method == "PUT" and url.path == "/api/chat/settings":
                                        repeated_settings.append(request)
                                    if request.method == "POST" and url.path == "/api/chat/intro/inject":
                                        split_intro_writes.append(request)
                                    if not setup_writes and request.method == "GET" and url.path in {
                                        "/api/characters", "/api/worlds", "/api/chat/sessions",
                                    }:
                                        pre_setup_catalog_reads.append(url.path)
                                    if url.path == CARD and "start=" in url.query:
                                        profile_handoffs.append(request)
                                    if request.is_navigation_request() and (url.path.startswith("/chats/chat_") or
                                            (url.path == CARD and "start=" in url.query)):
                                        handoff_documents.append(request)

                                # The main profile already rendered several Markdown messages.
                                # Use a cold browser to test the dependency on the first chat.
                                lab = await pw.chromium.launch(args=options["args"])
                                try:
                                    member_context = await lab.new_context(locale="ja-JP", service_workers="block")
                                    await member_context.add_cookies(await context.cookies(origin))
                                    member = await member_context.new_page()
                                    member.on("pageerror", lambda error: violations.append(str(error)))
                                    await member.route(markdown_url, hold_markdown)
                                    await member.goto(origin + CARD)
                                    assert not markdown_requested.is_set()
                                    member.on("request", observe_member_start)
                                    member_composer = member.get_by_role("textbox", name="最初のメッセージ")
                                    await member_composer.fill("fixture signed-in first turn")
                                    opening_saved = asyncio.Event()
                                    drop_opening_response = asyncio.Event()

                                    async def lose_setup_response(route):
                                        if route.request.method != "PUT":
                                            return await route.continue_()
                                        saved = await route.fetch()
                                        assert saved.status == 201
                                        opening_saved.set()
                                        await drop_opening_response.wait()
                                        await route.abort("connectionfailed")

                                    await member.route("**/api/chat/settings/opening", lose_setup_response)
                                    try:
                                        await member.get_by_role("button", name="会話をはじめる").click()
                                        await asyncio.wait_for(opening_saved.wait(), timeout=10)
                                        await expect(member.get_by_role("status").filter(has_text="会話を準備中…")).to_be_visible()
                                        await expect(member_composer).to_be_disabled()
                                        drop_opening_response.set()
                                        await expect(member.get_by_role("alert").filter(has_text="会話を開始できません")).to_be_visible()
                                        await expect(member.get_by_role("status").filter(has_text="会話を準備中…")).to_have_count(0)
                                        await expect(member_composer).to_have_value("fixture signed-in first turn")
                                        assert not first_sends and len(setup_writes) == 1
                                    finally:
                                        drop_opening_response.set()
                                        await member.unroute("**/api/chat/settings/opening", lose_setup_response)
                                    route_requested = asyncio.Event()
                                    resume_route = asyncio.Event()

                                    async def hold_chat_route(route):
                                        if route.request.headers.get("rsc") == "1":
                                            route_requested.set()
                                            await resume_route.wait()
                                        await route.continue_()

                                    await member.route("**/chats/chat_*", hold_chat_route)
                                    try:
                                        async with member.expect_response(lambda response:
                                                urlsplit(response.url).path.startswith("/chats/chat_")
                                                and response.request.headers.get("rsc") == "1") as chat_page:
                                            await member.get_by_role("button", name="会話をはじめる").click()
                                            try:
                                                await asyncio.wait_for(route_requested.wait(), timeout=10)
                                                await expect(member.get_by_role("status").filter(has_text="会話を開いています…")).to_be_visible()
                                                assert not first_quotes and not first_sends
                                            finally:
                                                resume_route.set()
                                    finally:
                                        await member.unroute("**/chats/chat_*", hold_chat_route)
                                    assert "text/x-component" in (await chat_page.value).headers.get("content-type", "")
                                    await member.wait_for_url("**/chats/chat_*")
                                    history = member.locator(".k-chat-messages")
                                    await asyncio.wait_for(markdown_requested.wait(), timeout=10)
                                    await expect(history.locator("p.md-view").first).to_be_visible()
                                    await expect(member.locator(".k-composer textarea")).to_be_editable()
                                    await expect(member.get_by_role("status").filter(has_text="会話を開いています…")).to_have_count(0)
                                    resume_markdown.set()
                                    await expect(history.locator("div.md-view p").first).to_be_visible()
                                    print("Chat textarea and literal history were visible with the Markdown parser held.", flush=True)
                                    await expect(history.get_by_text("fixture signed-in first turn", exact=True)).to_have_count(1)
                                    await expect(history.get_by_text("hello", exact=True)).to_have_count(1)
                                    assert not handoff_documents and not profile_handoffs
                                    assert len(setup_writes) == 2 and not pre_setup_catalog_reads and not split_intro_writes
                                    receipt = await setup_writes[1].response()
                                    assert receipt.status == 204
                                    assert setup_writes[0].post_data_json["session_id"] == setup_writes[1].post_data_json["session_id"]
                                    assert all(write.headers.get("x-kyalulu-owner") for write in setup_writes[:2])
                                    assert len(first_quotes) == len(first_sends) == 1 and not context_reads and not repeated_settings
                                    assert urlsplit(first_quotes[0].url).query == ""
                                    revision = receipt.headers["x-kyalulu-history-revision"]
                                    assert first_quotes[0].post_data_json["history_revision"] == revision
                                    assert first_sends[0].post_data_json["history_revision"] == revision
                                    await member.reload()
                                    await expect(history.get_by_text("hello", exact=True)).to_have_count(1)
                                    assert len(first_sends) == 1
                                    await member.goto(origin + CARD)
                                    stale_text = "fixture retained on conflict"
                                    await member_composer.fill(stale_text)

                                    async def stale_opening(route):
                                        await route.fulfill(status=409, json={"error": "history_revision_conflict",
                                                                              "code": "history_revision_conflict"})

                                    await member.route("**/api/cloud/quotes", stale_opening)
                                    await member.get_by_role("button", name="会話をはじめる").click()
                                    reload_chat = member.get_by_role("button", name="会話を再読み込み")
                                    textarea = member.locator(".k-composer textarea")
                                    await expect(reload_chat).to_be_visible()
                                    await expect(textarea).to_have_value(stale_text)
                                    await expect(textarea).to_be_disabled()
                                    assert len(first_sends) == 1 and len(first_quotes) == 2 and not repeated_settings
                                    await member.unroute("**/api/cloud/quotes", stale_opening)
                                    await reload_chat.click()
                                    await expect(textarea).to_be_editable()
                                    await expect(textarea).to_have_value(stale_text)
                                    assert len(first_sends) == 1
                                    recovery_cookie = {"name": SESSION_COOKIE, "value": CHUNK_SESSION, "url": origin,
                                                       "secure": True, "httpOnly": True, "sameSite": "Lax"}
                                    await check_chat_chunk_recovery(lab, origin, CARD, [recovery_cookie], chat_scripts)
                                    await check_opening_proxy_fallback(lab, origin, CARD, recovery_cookie)
                                    await check_page_recovery(lab, origin, create_scripts)
                                finally:
                                    resume_markdown.set()
                                    await lab.close()
                                await page.goto(origin + CARD)
                                await composer.fill("fixture member draft")
                                await context.clear_cookies(name=SESSION_COOKIE)
                                await page.get_by_role("button", name="会話をはじめる").click()
                                await composer.wait_for(state="hidden")
                                assert page.url == origin + CARD
                                await page.reload()
                                await composer.wait_for()
                                assert await composer.input_value() == ""
                                await composer.fill("fixture target switch")
                                await page.evaluate("localStorage.setItem('kyalulu-execution-target','pc')")
                                await page.get_by_role("button", name="会話をはじめる").click()
                                await composer.wait_for(state="hidden")
                                assert page.url == origin + CARD
                                await page.evaluate("localStorage.removeItem('kyalulu-execution-target')")
                                for _ in range(2):
                                    lab = await pw.chromium.launch(args=options["args"])
                                    try:
                                        fresh = await lab.new_context(locale="ja-JP", service_workers="block")
                                        visitor = await fresh.new_page()
                                        await visitor.goto(origin + CARD)
                                        await complete_login_and_chat(fresh, visitor, origin)
                                    finally:
                                        await lab.close()
                            assert not await page.evaluate("window.policyViolations || []")
                            if mode == "off" and rollback_cookies:
                                await context.add_cookies(rollback_cookies)
                                await page.goto(origin + "/chats/" + original)
                                await page.locator(".k-chat-messages").get_by_text("fixture recovery turn", exact=True).wait_for()
                                await expect(page.locator(".k-composer textarea")).to_have_value("fixture first owner draft")
                                assert not await page.locator('script[src*="/_next/static/"]').count()
                    assert not violations
                    for wave in ("pilot", "quarter"):
                        with process([str(caddy), "run", "--config", str(config)], ROOT,
                                     {**env, "ONLINE_COHORT": wave, "ONLINE_CHARACTER": "on", "ONLINE_CHATS": "on",
                                      "ONLINE_ASSETS": "on"}, tmp, "cohort") as server:
                            await ready(origin + "/api/health", server, verify=False)
                            await check_cohort(origin, ca, wave)
                    print("Next Node RSS after pilot journeys (MiB):", round(psutil.Process(node.pid).memory_info().rss / 2**20, 1))
                    await page.evaluate("""localStorage.setItem('kyalulu-app-preferences-v1', JSON.stringify({
                      version:1,language:'ja',country:'JP',age:25,accepted:true,genres:[],moods:[],activities:[],
                      favorites:[],dismissed:[]
                    }))""")
                    await context.close()
                    # All reverse proxies have stopped. The old installed worker must still boot the device shell.
                    context = await pw.chromium.launch_persistent_context(profile, offline=True, **options)
                    page = await context.new_page()
                    await page.goto(origin + "/device/#/chats/chat_offline_fixture")
                    await page.locator(".k-composer textarea").wait_for()
                    assert await page.evaluate("crossOriginIsolated && navigator.serviceWorker.controller !== null")
                finally:
                    await context.close()
    return original, branch


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--caddy", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=0)
    parser.add_argument("--online", type=Path, default=ROOT / "apps/online", help="Next service from the candidate bundle")
    args = parser.parse_args()
    asyncio.run(run(args.dist.resolve(), args.caddy.resolve(), args.samples, args.online.resolve()))
