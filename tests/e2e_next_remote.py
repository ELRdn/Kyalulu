"""Pair a disposable PC and recover active generations through a loopback Caddy switch."""
import argparse
import asyncio
import base64
from contextlib import AsyncExitStack, ExitStack, closing
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import ssl
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import urlsplit

import httpx
import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from playwright.async_api import async_playwright, expect
from websockets.asyncio.client import connect

from e2e_remote import MemoryVault, ROOT, port, runtime_ready

RELAY = "https://relay.test"


async def until(predicate):
    async with asyncio.timeout(30):
        while not predicate():
            await asyncio.sleep(.05)


async def exercise(page, host, origin):
    await page.goto(origin + "/#remote=invalid")
    await expect(page.get_by_role("alert")).to_be_visible()
    assert not urlsplit(page.url).fragment
    await page.get_by_role("button", name="閉じる", exact=True).click()
    link = await host.pair()
    try:
        await page.goto(link["url"])
    except Exception:
        raise AssertionError("Could not open the local pairing entry") from None
    field = page.get_by_label("この端末の名前", exact=True)
    await field.fill("Test browser")
    assert not urlsplit(page.url).fragment
    await page.get_by_role("button", name="このPCに登録する", exact=True).click()
    await until(lambda: bool(host.status()["pending"]))
    await expect(page.get_by_role("button", name="閉じる", exact=True)).to_be_disabled()
    device = host.status()["pending"][0]["device_id"]
    assert not host.authorized(device)
    await host.approve(device, await page.locator('form [role="status"] strong').inner_text())
    await page.get_by_role("button", name="会話を開く", exact=True).click()
    await runtime_ready(page, page.get_by_role("heading", name="トーク", exact=True))
    assert urlsplit(page.url).path == "/chats" and host.authorized(device)
    await page.get_by_role("button", name="キャラをさがす", exact=True).click()
    await page.wait_for_url("**/discover")
    await page.locator('a[href*="/characters/mocha_sfw"]').first.click()
    await page.get_by_role("button", name="会話をはじめる", exact=True).click()
    await page.wait_for_url("**/chats/*")
    await page.get_by_role("button", name="会話エンジンを選ぶ", exact=True).click()
    await page.get_by_role("dialog").get_by_label("会話モデル", exact=True).select_option("mock-echo")
    await page.get_by_role("dialog").get_by_role("button", name="戻る", exact=True).click()
    await page.locator(".k-composer__input").fill("fixture remote turn")
    await page.get_by_role("button", name="送信", exact=True).click()
    reply = page.locator(".k-chat-messages").get_by_text("Mock: fixture remote turn", exact=True)
    await expect(reply).to_be_visible(timeout=30000)
    await page.locator(".k-composer__input").fill("fixture retained draft")
    # Break the actual host WebSocket, then reopen the conversation with the stored keys.
    previous = host.socket
    await previous.close()
    await until(lambda: host.connected and host.socket is not previous)
    await page.reload()
    await runtime_ready(page, reply)
    await expect(page.locator(".k-composer__input")).to_have_value("fixture retained draft")
    await expect(reply).to_have_count(1)
    await expect(page.locator(".k-chat-messages .k-msg--user")).to_have_count(1)
    assert await page.evaluate("document.documentElement.dataset.kyaluluFrontend === 'next' && localStorage.getItem('kyalulu-execution-target') === 'pc'")
    return device


async def switch_active_chat(page, host, device, switch, wait_at_model, database):
    chat_url = page.url
    session = urlsplit(chat_url).path.rsplit("/", 1)[1]
    composer = page.locator(".k-composer__input")
    history = page.locator(".k-chat-messages")
    requests, resumes, results = [], [], []
    submit, resume = host.bridge.request, host.bridge.resume

    async def observe_request(id, method, path, headers, body, device_id):
        if method == "POST" and urlsplit(path).path in ("/api/chat", "/api/chat/stream"):
            requests.append((id, json.loads(body)["generation_id"], device_id))
        async for frame in submit(id, method, path, headers, body, device_id):
            yield frame

    async def observe_resume(id, after_seq, device_id):
        resumes.append((id, device_id))
        async for frame in resume(id, after_seq, device_id):
            yield frame

    with patch.object(host.bridge, "request", observe_request), patch.object(host.bridge, "resume", observe_resume):
        for mode in ("off", "on"):
            message = "fixture remote active " + mode
            entered, finish = wait_at_model[message]
            await page.evaluate("""() => {
              window.fixtureRemoteDocument = true;
              window.fixtureRemoteSocketClosed = false;
              window.addEventListener('kyalulu-remote-status', event => {
                if (!event.detail.connected) window.fixtureRemoteSocketClosed = true;
              });
            }""")
            try:
                await composer.fill(message)
                await page.get_by_role("button", name="送信", exact=True).click()
                await asyncio.wait_for(entered.wait(), 15)
                rpc_id, generation, target = requests[-1]
                assert target == device
                with closing(sqlite3.connect(database)) as db:
                    assert db.execute("SELECT status FROM generations WHERE generation_id=? AND session_id=?",
                                      (generation, session)).fetchone() == ("pending",)
                old_socket = host.socket
                await switch(mode)
                await page.wait_for_function("window.fixtureRemoteSocketClosed === true")
                await until(lambda: host.connected and host.socket is not old_socket)
                if mode == "off":
                    await until(lambda: (rpc_id, device) in resumes)
                else:
                    await page.reload()
                    await expect(page.get_by_text("前の送信は処理中です。", exact=False)).to_be_visible(timeout=30000)
                finish.set()
                await expect(history.get_by_text("Mock: " + message, exact=True)).to_have_count(1, timeout=30000)
                await expect(history.get_by_text(message, exact=True)).to_have_count(1)
                await expect(page.locator(".k-chat-failed")).to_have_count(0)
                if mode == "off":
                    assert await page.evaluate("window.fixtureRemoteDocument === true")
                await composer.fill("fixture retained across the switch")
                await page.reload()
                await runtime_ready(page, history.get_by_text("Mock: " + message, exact=True))
                await expect(composer).to_have_value("fixture retained across the switch")
                assert page.url == chat_url and host.authorized(device)
                assert await page.evaluate("localStorage.getItem('kyalulu-execution-target') === 'pc'")
                assert (await page.locator('script[src^="/_next/static/"]').count() > 0) == (mode == "on")
                with closing(sqlite3.connect(database)) as db:
                    state = db.execute("SELECT status,user_id,assistant_id FROM generations WHERE generation_id=? AND session_id=?",
                                       (generation, session)).fetchone()
                    assert state and state[0] == "completed"
                    for role, text, saved_id in (("user", message, state[1]), ("assistant", "Mock: " + message, state[2])):
                        assert db.execute("SELECT id FROM chat_history WHERE session_id=? AND role=? AND content=?",
                                          (session, role, text)).fetchall() == [(saved_id,)]
                results.append({"frontend": "next" if mode == "on" else "legacy",
                                "host_and_browser_reconnected": True, "same_conversation": True,
                                "reloaded_while_pending": mode == "on",
                                "same_rpc_resumed": (rpc_id, device) in resumes, "committed_once": True})
            finally:
                finish.set()
        assert len(requests) == 2 and len({row[1] for row in requests}) == 2
    print(json.dumps({"active_switches": results, "pc_generation_posts": len(requests)}, indent=2))


async def run(dist, caddy, relay_origin=RELAY):
    domain = urlsplit(relay_origin).hostname or ""
    if not re.fullmatch(r"[a-z0-9.-]+", domain) or relay_origin != f"https://{domain}" or domain == "localhost":
        raise ValueError("The local Relay fixture requires an exact HTTPS DNS origin")
    with TemporaryDirectory(dir=ROOT / ".artifacts", prefix="nr-") as directory:
        tmp = Path(directory)
        models = tmp / "models"
        models.mkdir()
        (models / "mock-echo.yaml").write_bytes((ROOT / "models/mock-echo.yaml").read_bytes())
        async with AsyncExitStack() as stack:
            proxy_process = stack.enter_context(ExitStack())
            stack.enter_context(patch.dict(os.environ, {"KYALULU_DATA_DIR": str(tmp / "pc"),
                "KYALULU_EXPERIMENTS_DIR": str(tmp / "experiments"), "KYALULU_MODELS_DIR": str(models),
                "KYALULU_REMOTE_MODE": "0"}))
            from python.core import config, registry
            from python.api import providers
            stack.enter_context(patch.object(config, "settings", config.Settings(_env_file=None,
                le_api_token="", openai_compatible_api_key="", llm_api_key="", le_token_file=str(tmp / "unused"))))
            stack.enter_context(patch.object(registry, "MODELS_DIR", models))
            stack.enter_context(patch.object(providers, "TYPES", ("mock",)))
            from python.api.main import app
            from python.providers import last_user_text
            from python.providers.mock import MockProvider
            from python.relay.app import create_app
            from python.remote.crypto import generate_keypair
            from python.remote.host import HostService
            from e2e_online_character_baseline import fixture
            from e2e_online_coexistence import process
            from e2e_unified_proxy import ready

            wait_at_model = {"fixture remote active " + mode: (asyncio.Event(), asyncio.Event()) for mode in ("off", "on")}
            mock_stream = MockProvider.stream_events

            async def paused_stream(provider, prompt="", **kwargs):
                gate = wait_at_model.get(last_user_text(prompt, kwargs.get("messages")))
                if gate:
                    entered, finish = gate
                    entered.set()
                    await asyncio.wait_for(finish.wait(), 60)
                async for event in mock_stream(provider, prompt, **kwargs):
                    yield event

            stack.enter_context(patch.object(MockProvider, "stream_events", paused_stream))

            proxy_port, node_port = port(), port()
            origin = f"https://localhost:{proxy_port}"
            relay = create_app(str(tmp / "relay.sqlite3"), [origin])
            listener = stack.enter_context(socket.socket())
            listener.bind(("127.0.0.1", 0))
            address = "127.0.0.1:" + str(listener.getsockname()[1])
            server = uvicorn.Server(uvicorn.Config(relay, access_log=False, log_level="error", timeout_graceful_shutdown=2))
            task = asyncio.create_task(server.serve(sockets=[listener]))

            async def stop():
                server.should_exit = True
                await task

            stack.push_async_callback(stop)
            await until(lambda: server.started)
            store = relay.state.store
            issued = store.redeem_invite(store.invite(), "Fixture PC")
            private, public = generate_keypair()

            async def control(method, path, body=None):
                async with httpx.AsyncClient(base_url="http://" + address, trust_env=False) as client:
                    response = await client.request(method, path, json=body, headers={"Authorization": "Bearer " + issued["host_token"]})
                    response.raise_for_status()
                    return response.json() if response.content else {}

            async def probe():
                return {"status": "offline"}

            upstream = await stack.enter_async_context(fixture(dist, origin))
            policy = (ROOT / "deploy/cloud/Caddyfile.unified.example").read_text(encoding="utf-8")
            policy = policy.replace('{$APP_DOMAIN} {', f'localhost:{proxy_port} {{\n bind 127.0.0.1\n tls internal')
            relay_site = (ROOT / "deploy/remote/Caddyfile.relay").read_text(encoding="utf-8").split("{$RELAY_DOMAIN} {", 1)[1]
            policy += f"\n{domain}:{proxy_port} {{\n bind 127.0.0.1\n tls internal" + relay_site.replace("relay:8787", address)
            caddyfile = tmp / "Caddyfile"
            caddyfile.write_text("{\n admin off\n auto_https disable_redirects\n skip_install_trust\n}\n" + policy, encoding="utf-8")
            env = dict(os.environ, KYALULU_PUBLIC_ORIGIN=origin, CLOUD_UPSTREAM=upstream, RELAY_DOMAIN=domain,
                       ONLINE_UPSTREAM=f"127.0.0.1:{node_port}", NEXT_TELEMETRY_DISABLED="1",
                       ONLINE_COHORT="all",
                       XDG_DATA_HOME=str(tmp / "data"), XDG_CONFIG_HOME=str(tmp / "config"))
            env.update(ONLINE_ASSETS="on", ONLINE_PACKAGED_ASSETS="on" if (dist / "_next/static").is_dir() else "off")

            async def switch(mode):
                proxy_process.close()
                flags = {"ONLINE_" + key: mode for key in ("ENTRY", "CHATS", "PAGES", "BROWSE", "CHARACTER", "FALLBACK")}
                proxy = proxy_process.enter_context(process([str(caddy), "run", "--config", str(caddyfile)],
                                                            ROOT, {**env, **flags}, tmp, "proxy-" + mode))
                await ready(origin + "/api/health", proxy, verify=False)

            await switch("on")
            certs = tmp / "data"
            env["NODE_EXTRA_CA_CERTS"] = str(next(certs.rglob("root.crt")))
            relay_tls = ssl.create_default_context(cafile=env["NODE_EXTRA_CA_CERTS"])
            await stack.enter_async_context(app.router.lifespan_context(app))
            host = HostService(app, MemoryVault(dict(version=1, relay=relay_origin, app_origin=origin, **issued,
                private_key=private.hex(), public_key=public.hex(), devices={}, pairings={})), control=control,
                connector=lambda url: connect(url, host="127.0.0.1", port=proxy_port, ssl=relay_tls, proxy=None), le_probe=probe)
            app.state.remote_host = host
            await host.start()
            stack.push_async_callback(host.stop)
            await until(lambda: host.connected)
            pins = []
            for name in ("localhost.crt", f"{domain}.crt"):
                cert = x509.load_pem_x509_certificate(next(certs.rglob(name)).read_bytes())
                key = cert.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
                pins.append(base64.b64encode(hashlib.sha256(key).digest()).decode())
            online = ROOT / "apps/online"
            build_id = (online / ".next/BUILD_ID").read_text(encoding="ascii").strip()
            release_path = dist.parent / "online-release.json"
            if release_path.exists():
                assert json.loads(release_path.read_text(encoding="utf-8"))["next_build_id"] == build_id
            node = stack.enter_context(process(["node", str(online / "node_modules/next/dist/bin/next"),
                "start", "-H", "127.0.0.1", "-p", str(node_port)], online, env, tmp, "node"))
            await ready(origin + "/chats", node, verify=False)
            pw = await stack.enter_async_context(async_playwright())
            browser = await pw.chromium.launch(args=["--no-proxy-server",
                f"--host-resolver-rules=MAP {domain}:443 127.0.0.1:{proxy_port}, MAP * ~NOTFOUND, EXCLUDE localhost",
                "--ignore-certificate-errors-spki-list=" + ",".join(pins)])
            stack.push_async_callback(browser.close)
            context = await browser.new_context(locale="ja-JP", viewport={"width":393,"height":852})
            await context.add_init_script("""if (!localStorage.getItem('kyalulu-app-preferences-v1')) {
              localStorage.setItem('kyalulu-execution-target','pc');
              localStorage.setItem('kyalulu-app-preferences-v1',JSON.stringify({version:1,language:'ja',country:'JP',age:25,
                accepted:true,genres:[],moods:[],activities:[],favorites:[],dismissed:[]}));
              localStorage.setItem('kyalulu-first-chat-tutorial-v1','skipped');
            }""")
            misdirected = []
            async def guard(route):
                url = urlsplit(route.request.url)
                if url.netloc not in (urlsplit(origin).netloc, domain) or (url.netloc == urlsplit(origin).netloc and
                        (url.path == "/api/chat" or url.path.startswith("/api/chat/"))):
                    misdirected.append(route.request.method)
                    await route.abort()
                else:
                    await route.continue_()
            await context.route("**/*", guard)
            page = await context.new_page()
            device = await exercise(page, host, origin)
            await switch_active_chat(page, host, device, switch, wait_at_model, tmp / "pc/data.db")
            assert not misdirected
            print(json.dumps({"build": build_id, "direct_cloud_requests": len(misdirected)}))
    print("Verified Next pairing, PC approval, live proxy switches, reconnect and draft recovery.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--caddy", type=Path, required=True)
    parser.add_argument("--relay-origin", default=RELAY, help="Map this compiled Relay origin to a loopback fixture")
    args = parser.parse_args()
    asyncio.run(run(args.dist.resolve(), args.caddy.resolve(), args.relay_origin))
