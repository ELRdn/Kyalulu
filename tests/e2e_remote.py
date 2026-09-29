"""Real browser -> opaque loopback Relay -> Host -> isolated Runtime acceptance.

Uses the actual PWA in Vite development mode (localhost secure-context exception).
No user model or data. Physical Android/TLS/production deployment are separate gates.
"""

import asyncio
import base64
import copy
import hashlib
import io
import json
import os
import socket
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class MemoryVault:
    def __init__(self, config):
        self.config = config

    def read(self):
        return copy.deepcopy(self.config)

    def write(self, value):
        self.config = copy.deepcopy(value)


async def run():
    output = ROOT / ".artifacts" / "remote-v1" / ("e2e-" + uuid.uuid4().hex[:8])
    output.mkdir(parents=True)
    os.environ["KYALULU_DATA_DIR"] = str(output)
    os.environ["KYALULU_EXPERIMENTS_DIR"] = str(output / "experiments")
    os.environ["KYALULU_REMOTE_MODE"] = "0"
    os.environ.pop("KYALULU_WEB_DIST", None)
    import httpx
    import uvicorn
    from playwright.async_api import Error as PlaywrightError
    from playwright.async_api import async_playwright, expect
    from python.api.main import app
    from python.relay.app import create_app
    from python.remote.crypto import generate_keypair
    from python.remote.host import HostService

    relay_port, web_port = port(), port()
    relay_origin, web_origin = (
        f"http://127.0.0.1:{relay_port}",
        f"http://127.0.0.1:{web_port}",
    )
    relay = create_app(str(output / "relay.sqlite3"), [web_origin])
    store = relay.state.store
    issued = store.redeem_invite(store.invite(), "Acceptance PC")
    private, public = generate_keypair()
    vault = MemoryVault(
        dict(
            version=1,
            relay=relay_origin,
            app_origin=web_origin,
            **issued,
            private_key=private.hex(),
            public_key=public.hex(),
            devices={},
            pairings={},
        )
    )
    host = HostService(app, vault, le_probe=lambda: None)
    server = uvicorn.Server(
        uvicorn.Config(
            relay,
            host="127.0.0.1",
            port=relay_port,
            log_level="error",
            access_log=False,
        )
    )
    server_task = asyncio.create_task(server.serve())
    vite = None
    report = {
        "checks": [],
        "limits": ["Mock model", "emulated Android", "loopback development origins"],
    }

    async def wait_until(predicate, seconds=15):
        for _ in range(seconds * 20):
            if predicate():
                return
            await asyncio.sleep(0.05)
        raise AssertionError("condition timeout")

    try:
        await wait_until(lambda: server.started)
        async with app.router.lifespan_context(app):
            app.state.remote_host = host
            await host.start()
            await wait_until(lambda: host.connected)
            env = {**os.environ, "VITE_RELAY_ORIGIN": relay_origin}
            log = (output / "vite.log").open("wb")
            vite = await asyncio.to_thread(
                subprocess.Popen,
                [
                    "node",
                    str(ROOT / "apps/web/node_modules/vite/bin/vite.js"),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(web_port),
                    "--strictPort",
                ],
                cwd=ROOT / "apps/web",
                env=env,
                stdout=log,
                stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            async with httpx.AsyncClient(trust_env=False) as check:
                for _ in range(100):
                    try:
                        if (await check.get(web_origin)).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.1)
                else:
                    raise AssertionError("Vite did not start")
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                try:
                    context = await browser.new_context(
                        viewport={"width": 393, "height": 851},
                        is_mobile=True,
                        has_touch=True,
                    )
                    page = await context.new_page()
                    errors, requests = [], []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    page.on("request", lambda r: requests.append(r.url))
                    link = await host.pair()
                    await page.goto(link["url"])
                    assert "#remote=" not in page.url
                    await page.get_by_label("このスマホの名前").fill(
                        "Acceptance Android"
                    )
                    await page.get_by_role(
                        "button", name="このPCに登録する", exact=True
                    ).click()
                    await wait_until(lambda: bool(host.status()["pending"]))
                    code = await page.locator(
                        'form [role="status"] strong'
                    ).inner_text()
                    device = host.status()["pending"][0]["device_id"]
                    assert not host.authorized(device)
                    await page.screenshot(
                        path=str(output / "approval.png"), full_page=True
                    )
                    await host.approve(device, code)
                    await expect(
                        page.get_by_role("heading", name="登録できました")
                    ).to_be_visible()
                    await page.get_by_role(
                        "button", name="会話を開く", exact=True
                    ).click()
                    await expect(
                        page.get_by_role("heading", name="チャット", exact=True)
                    ).to_be_visible(timeout=30000)
                    report["checks"].append(
                        "QR fragment erased; Noise pinned pairing; PC approval; persisted reconnect"
                    )

                    async def api(path, method="GET", body=None):
                        return await page.evaluate(
                            """async a => {
                          const {apiFetch} = await import('/src/lib/transport.ts');
                          const r = await apiFetch(a.path, {method:a.method, headers:a.body?{'Content-Type':'application/json'}:undefined, body:a.body?JSON.stringify(a.body):undefined});
                          return {status:r.status, body:await r.text()};
                        }""",
                            {"path": path, "method": method, "body": body},
                        )

                    assert (await api("/api/diagnostics"))["status"] == 403
                    assert (await api("/api/remote/pair", "POST"))["status"] == 403
                    report["checks"].append(
                        "Runtime and Host administration denied over encrypted channel"
                    )
                    await page.get_by_role(
                        "button", name="新しいチャット", exact=True
                    ).click()
                    await page.wait_for_url("**/#/chats/*")
                    diagnostic = await api(
                        "/api/chat/settings?session_id=" + page.url.rsplit("/", 1)[1]
                    )
                    (output / "settings-check.json").write_text(
                        json.dumps(diagnostic), encoding="utf-8"
                    )
                    await page.get_by_role(
                        "button", name="会話エンジンを選ぶ", exact=True
                    ).click()
                    await (
                        page.get_by_role("dialog")
                        .get_by_label("会話モデル", exact=True)
                        .select_option("mock-echo")
                    )
                    await page.get_by_role("button", name="閉じる", exact=True).click()
                    composer = page.locator(".k-composer__input")
                    await expect(composer).to_be_enabled()
                    await composer.fill("暗号化通信の下書き")
                    await page.reload()
                    await expect(composer).to_have_value(
                        "暗号化通信の下書き", timeout=30000
                    )
                    await expect(composer).to_be_enabled()
                    await composer.fill("REMOTE_PRIVATE_CANARY_こんにちは")
                    await page.get_by_role("button", name="送信", exact=True).click()
                    await expect(
                        page.get_by_text(
                            "Mock: REMOTE_PRIVATE_CANARY_こんにちは", exact=True
                        )
                    ).to_be_visible(timeout=30000)
                    sid = page.url.rsplit("/", 1)[1]
                    await wait_until(lambda: not host.bridge._closed)
                    for _ in range(100):
                        history = json.loads(
                            (await api("/api/chat/history?session_id=" + sid))["body"]
                        )["history"]
                        if len(history) == 2:
                            break
                        await asyncio.sleep(0.1)
                    assert len(history) == 2
                    assert history[0]["content"] == "REMOTE_PRIVATE_CANARY_こんにちは"
                    report["checks"].append(
                        "draft reload, explicit Mock model, one durable user/assistant pair"
                    )
                    from python.api import chat
                    from python.providers.mock import MockProvider

                    original_stream = MockProvider.stream_events

                    async def delayed_stream(self, *args, **kwargs):
                        async for event in original_stream(self, *args, **kwargs):
                            await asyncio.sleep(0.04)
                            yield event

                    MockProvider.stream_events = delayed_stream
                    try:
                        await composer.fill("REMOTE_DISCONNECT_覚えていて")
                        await page.get_by_role(
                            "button", name="送信", exact=True
                        ).click()
                        await wait_until(lambda: bool(chat._running))
                        await host.socket.close()
                        await asyncio.sleep(2)
                        await wait_until(lambda: host.connected)
                        await page.reload()
                        await expect(page.locator(".k-composer__input")).to_be_visible(
                            timeout=30000
                        )
                        for _ in range(100):
                            restored = json.loads(
                                (await api("/api/chat/history?session_id=" + sid))[
                                    "body"
                                ]
                            )["history"]
                            if len(restored) == 4:
                                break
                            await asyncio.sleep(0.1)
                        assert len(restored) == 4
                        assert (
                            sum(
                                m["role"] == "user"
                                and m["content"] == "REMOTE_DISCONNECT_覚えていて"
                                for m in restored
                            )
                            == 1
                        )
                        report["checks"].append(
                            "disconnect DURING generation then reload: one durable completion, no resubmission"
                        )
                    finally:
                        MockProvider.stream_events = original_stream
                    from PIL import Image

                    png = io.BytesIO()
                    Image.frombytes(
                        "RGB", (1024, 1024), os.urandom(1024 * 1024 * 3)
                    ).save(png, format="PNG")
                    image_bytes = png.getvalue()
                    binary = await page.evaluate(
                        """async raw => {
                      const {apiFetch} = await import('/src/lib/transport.ts');
                      const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
                      const form = new FormData(); form.set('file', new Blob([bytes], {type:'image/png'}), 'private.png');
                      const uploaded = await apiFetch('/api/library/assets', {method:'POST',body:form});
                      if(!uploaded.ok) throw new Error('upload_failed_'+uploaded.status);
                      const asset = await uploaded.json();
                      const response = await apiFetch('/api/library/assets/'+asset.asset_id);
                      if(!response.ok) throw new Error('download_failed');
                      const body = await response.arrayBuffer();
                      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(b=>b.toString(16).padStart(2,'0')).join('');
                      const {default:React} = await import('/node_modules/.vite/deps/react.js');
                      const {default:ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js');
                      const {RuntimeImage} = await import('/src/components/RuntimeMedia.tsx');
                      const container = document.createElement('div');container.id='acceptance-image';document.body.appendChild(container);
                      window.acceptanceImageRoot = ReactDOM.createRoot(container);
                      window.acceptanceImageRoot.render(React.createElement(RuntimeImage, {src:'/api/library/assets/'+asset.asset_id,alt:'private fixture'}));
                      return {hash, bytes:body.byteLength};
                    }""",
                        base64.b64encode(image_bytes).decode(),
                    )
                    assert binary == {
                        "hash": hashlib.sha256(image_bytes).hexdigest(),
                        "bytes": len(image_bytes),
                    }
                    await expect(
                        page.locator("#acceptance-image img")
                    ).to_have_attribute(
                        "src", __import__("re").compile("^blob:"), timeout=30000
                    )
                    await page.evaluate(
                        "window.acceptanceImageRoot.unmount(); document.getElementById('acceptance-image').remove()"
                    )
                    report["checks"].append(
                        "3MiB multipart image upload, hash-identical encrypted download, Blob image rendering"
                    )
                    assert not any("/api/" in url for url in requests), requests
                    assert not any("REMOTE_PRIVATE_CANARY" in url for url in requests)
                    report["checks"].append(
                        "Runtime requests never use plaintext browser HTTP URLs"
                    )
                    await page.screenshot(
                        path=str(output / "conversation.png"), full_page=True
                    )
                    for width in (320, 360, 393, 1280):
                        await page.set_viewport_size({"width": width, "height": 851})
                        assert not await page.evaluate(
                            "document.documentElement.scrollWidth > innerWidth"
                        )
                    report["checks"].append(
                        "320/360/393/1280 viewport: no horizontal overflow"
                    )
                    # Closing the Host transport preserves its Runtime and database.
                    await host.socket.close()
                    await asyncio.sleep(2)
                    await wait_until(lambda: host.connected)
                    for _ in range(30):
                        try:
                            if (await api("/api/health"))["status"] == 200:
                                break
                        except PlaywrightError:
                            await asyncio.sleep(0.5)
                    else:
                        raise AssertionError("reconnect failed")
                    assert (
                        len(
                            json.loads(
                                (await api("/api/chat/history?session_id=" + sid))[
                                    "body"
                                ]
                            )["history"]
                        )
                        == 4
                    )
                    report["checks"].append(
                        "Host WSS reconnect retains authoritative history"
                    )
                    await host.revoke(device)
                    try:
                        await asyncio.wait_for(api("/api/chat/sessions"), timeout=20)
                    except (PlaywrightError, TimeoutError):
                        report["checks"].append(
                            "revoked device cannot fetch Runtime data"
                        )
                    else:
                        raise AssertionError("revoked client accepted")
                    assert not errors, errors
                    await context.close()
                except Exception:
                    if "page" in locals():
                        await page.screenshot(
                            path=str(output / "failure.png"), full_page=True
                        )
                        (output / "failure.txt").write_text(
                            await page.locator("body").inner_text(), encoding="utf-8"
                        )
                        (output / "errors.json").write_text(
                            json.dumps(errors), encoding="utf-8"
                        )
                    raise
                finally:
                    await browser.close()
            await host.stop()
    finally:
        await host.stop()
        server.should_exit = True
        await server_task
        if vite:
            vite.terminate()
            await asyncio.to_thread(vite.wait, 10)
            log.close()
        (output / "acceptance.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(
        json.dumps(
            {
                "passed": len(report["checks"]),
                "report": str(output / "acceptance.json"),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    asyncio.run(run())
