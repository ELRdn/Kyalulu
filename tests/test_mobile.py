"""Exercise security against actual API routes, without network/model dependencies."""

import time

import httpx
import pytest
from fastapi import FastAPI
from python.api import mobile
from python.api.main import app as desktop_app

ORIGIN = "https://home.example:8000"


def make_app(config, dist=None):
    app = FastAPI()
    # Reuse production API handlers but never production state/database/lifespan.
    for route in desktop_app.routes:
        if (
            getattr(route, "path", "").startswith("/api/")
            or type(route).__name__ == "_IncludedRouter"
        ):
            app.router.routes.append(route)
    app.state.mobile_config = config
    app.state.mobile_devices = mobile.Devices()
    if dist:
        app.mount("/", mobile.WebDist(directory=str(dist), html=True))
    app.add_middleware(
        mobile.MobileSecurity, config=config, devices=app.state.mobile_devices
    )
    return app


@pytest.fixture
def app():
    return make_app(mobile.Config(True, ORIGIN))


def client(app, local=False, base=None, peer=None):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(
            app=app, client=(peer or ("127.0.0.1" if local else "192.168.1.50"), 1234)
        ),
        base_url=base or ("http://127.0.0.1:8000" if local else ORIGIN),
        headers={} if local else {"Origin": ORIGIN},
    )


async def pair(app, remote):
    async with client(app, local=True) as admin:
        issued = await admin.post("/api/mobile/admin/code")
        assert issued.status_code == 200
    result = await remote.post(
        "/api/mobile/pair", json={"code": issued.json()["code"], "name": "Pixel"}
    )
    assert result.status_code == 200
    return result, issued.json()["code"]


@pytest.mark.asyncio
async def test_pair_cookie_one_use_logout_and_revocation(app):
    async with client(app) as remote, client(app, local=True) as admin:
        assert (await remote.get("/api/mobile/status")).json() == {
            "remote_mode": True,
            "authenticated": False,
            "administrative": False,
        }
        assert (await remote.get("/api/chat/sessions")).status_code == 401
        response, code = await pair(app, remote)
        cookie = response.headers["set-cookie"]
        for flag in (
            "HttpOnly",
            "Secure",
            "SameSite=strict",
            "Path=/",
            "Max-Age=2592000",
        ):
            assert flag in cookie
        assert "Domain=" not in cookie
        assert (await remote.get("/api/mobile/status")).json()["device_name"] == "Pixel"
        assert (await remote.get("/api/mobile/status")).json()[
            "administrative"
        ] is False
        assert (await admin.get("/api/mobile/status")).json()["administrative"] is True
        assert (
            await remote.post("/api/mobile/pair", json={"code": code, "name": "Other"})
        ).status_code == 400
        token = remote.cookies.get(mobile.COOKIE)
        assert token not in app.state.mobile_devices.sessions
        devices = (await admin.get("/api/mobile/admin/devices")).json()["devices"]
        assert len(devices) == 1 and token not in str(devices)
        assert (
            await admin.delete("/api/mobile/admin/devices/" + devices[0]["id"])
        ).status_code == 204
        assert (await remote.get("/api/chat/sessions")).status_code == 401
        await pair(app, remote)
        token = remote.cookies.get(mobile.COOKIE)
        assert (await remote.post("/api/mobile/logout")).status_code == 204
        assert not remote.cookies.get(mobile.COOKIE)
        remote.cookies.set(mobile.COOKIE, token)
        assert (await remote.get("/api/chat/sessions")).status_code == 401


@pytest.mark.asyncio
async def test_expiry_lock_rate_limit_and_restart(app, monkeypatch):
    devices = app.state.mobile_devices
    now = time.time()
    monkeypatch.setattr(mobile.time, "time", lambda: now)
    code = devices.issue()["code"]
    now += mobile.CODE_TTL
    assert devices.pair(code, "phone").status_code == 400
    code = devices.issue()["code"]
    wrong = "00000000" if code != "00000000" else "11111111"
    for _ in range(5):
        assert devices.pair(wrong, "phone").status_code == 400
    assert devices.pair(code, "phone").status_code == 429
    async with client(app) as remote:
        await pair(app, remote)
        now += mobile.SESSION_TTL
        assert (await remote.get("/api/chat/sessions")).status_code == 401
        await pair(app, remote)
        app.state.mobile_devices.sessions.clear()  # restart creates an empty store
        assert (await remote.get("/api/chat/sessions")).status_code == 401
    fresh = mobile.Devices()
    for _ in range(30):
        fresh.pair(fresh.issue()["code"], "phone")
    assert fresh.pair(fresh.issue()["code"], "phone").status_code == 429


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    [
        "/api/le/models",
        "/api/le/models/download",
        "/api/commands",
        "/api/models/download",
        "/api/diagnostics",
        "/api/providers",
        "/api/experiments/run",
        "/api/benchmarks",
        "/api/research",
        "/api/admin",
        "/api/mobile/admin/code",
        "/api/mobile/admin/devices",
        "/api/chat/debug",
        "/api/imports/url/resolve",
        "/api/library/x/admin",
        "/api/creator/admin",
        "/api/future-admin",
        "/api/chat/new-admin",
        "/api/le%2Fmodels",
        "/api/chat/history/1/admin",
    ],
)
async def test_all_methods_on_admin_and_unknown_paths_denied(app, path):
    async with client(app) as remote:
        await pair(app, remote)
        for method in ("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"):
            response = await remote.request(method, path)
            assert response.status_code == 403, (method, path, response.text)
            assert response.headers["cache-control"] == "no-store, private"


@pytest.mark.asyncio
async def test_origins_host_forwarded_and_loopback_do_not_grant_admin(app):
    async with client(app) as remote:
        await pair(app, remote)
        for origin in ("https://evil.example", "null", "http://localhost:5173"):
            response = await remote.get(
                "/api/mobile/status", headers={"Origin": origin}
            )
            assert response.status_code == 403
            assert "access-control-allow-origin" not in response.headers
        remote.headers.pop("Origin")
        assert (await remote.get("/api/mobile/status")).status_code == 200
        assert (await remote.post("/api/mobile/logout")).status_code == 403
        assert (
            await remote.get(
                "/api/mobile/status", headers={"Sec-Fetch-Site": "cross-site"}
            )
        ).status_code == 403
        for host in ("evil.example", "localhost:8000", "home.example:9999"):
            assert (
                await remote.get("/api/mobile/status", headers={"Host": host})
            ).status_code == 403
    async with client(app, base=ORIGIN, peer="127.0.0.1") as proxy:
        assert (await proxy.post("/api/mobile/admin/code")).status_code == 401
        await pair(app, proxy)
        assert (await proxy.post("/api/mobile/admin/code")).status_code == 403
    async with client(app, local=True) as local:
        for headers in (
            {"X-Forwarded-For": "127.0.0.1"},
            {"Forwarded": "for=127.0.0.1"},
            {"Cookie": mobile.COOKIE + "=forged"},
        ):
            assert (
                await local.post("/api/mobile/admin/code", headers=headers)
            ).status_code == 403
    async with client(app, base="http://home.example:8000") as insecure:
        assert (await insecure.get("/api/mobile/status")).status_code == 403


@pytest.mark.asyncio
async def test_desktop_stays_local_and_remote_opt_in_required(isolated):
    async with client(desktop_app, local=True) as local:
        assert (await local.get("/api/mobile/status")).json() == {
            "remote_mode": False,
            "authenticated": True,
            "administrative": True,
        }
        assert (await local.get("/api/chat/debug")).status_code == 200
        assert (
            await local.get("/api/health", headers={"Origin": "http://127.0.0.1:5174"})
        ).status_code == 200
        assert (
            await local.get(
                "/api/health",
                headers={"Host": "evil.example", "Origin": "http://evil.example"},
            )
        ).status_code == 403
    async with client(desktop_app) as remote:
        assert (await remote.get("/api/health")).status_code == 403


@pytest.mark.asyncio
async def test_paired_mock_chat_stream_history_and_models(app, isolated, monkeypatch):
    from python.core import registry

    async def entries():
        return [
            {
                "id": "mock-echo",
                "display_name": "Mock",
                "provider": {"api_key": "secret"},
            }
        ]

    async def no_le():
        return []

    monkeypatch.setattr(registry, "list_models_from_db", entries)
    monkeypatch.setattr(registry, "list_le_models", no_le)
    async with client(app) as remote:
        await pair(app, remote)
        assert (await remote.get("/api/models")).json() == {
            "models": [{"id": "mock-echo", "display_name": "Mock"}]
        }
        response = await remote.post(
            "/api/chat/stream",
            json={
                "model_id": "mock-echo",
                "session_id": "phone",
                "messages": [{"role": "user", "content": "hello"}],
            },
        )
        assert response.status_code == 200 and "event: done" in response.text
        assert response.headers["cache-control"] == "no-store, private"
        history = await remote.get("/api/chat/history?session_id=phone")
        assert len(history.json()["history"]) == 2
        assert history.headers["cache-control"] == "no-store, private"
        assert (
            await remote.put(
                "/api/chat/settings", json={"session_id": "phone", "temperature": 0.5}
            )
        ).status_code == 200


@pytest.mark.asyncio
async def test_static_same_origin_spa_api_and_sw_headers(tmp_path):
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "sw.js").write_text("// service worker")
    (tmp_path / "main.js").write_text("// built asset")
    (tmp_path / ".env").write_text("never serve")
    app = make_app(mobile.Config(True, ORIGIN), tmp_path)
    async with client(app) as remote:
        for path in ("/", "/chat/session"):
            response = await remote.get(path, headers={"Accept": "text/html"})
            assert response.status_code == 200 and "<html>app" in response.text
        sw = await remote.get("/sw.js")
        assert sw.headers["cache-control"] == "no-store"
        assert sw.headers["service-worker-allowed"] == "/"
        assert "javascript" in sw.headers["content-type"]
        for path in ("/missing.js", "/.env", "/%2eenv", "/assets/missing.png"):
            assert (
                await remote.get(path, headers={"Accept": "text/html"})
            ).status_code == 404
        assert (
            await remote.get("/api/missing", headers={"Accept": "text/html"})
        ).status_code == 401
        for path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"):
            assert (await remote.get(path)).status_code == 403
        async with client(app, local=True) as local:
            response = await local.get("/api/missing", headers={"Accept": "text/html"})
            assert response.status_code == 404 and "<html>app" not in response.text
            assert response.headers["cache-control"] == "no-store, private"


@pytest.mark.parametrize(
    "origin",
    [
        "",
        "http://home.example",
        "https://home.example/",
        "https://u:p@home.example",
        "https://home.example/path",
        "https://home.example?x=1",
        "https://home.example:bad",
        "https://home.example?",
        "https://home.example#",
        "https://home. example",
    ],
)
def test_configuration_fails_closed(monkeypatch, origin):
    monkeypatch.setenv("KYALULU_REMOTE_MODE", "1")
    monkeypatch.setenv("KYALULU_PUBLIC_ORIGIN", origin)
    with pytest.raises(ValueError):
        mobile.Config.from_env()


def test_invalid_dist_and_flag_fail_startup(monkeypatch, tmp_path):
    monkeypatch.setenv("KYALULU_REMOTE_MODE", "yes")
    with pytest.raises(ValueError):
        mobile.Config.from_env()
    monkeypatch.setenv("KYALULU_REMOTE_MODE", "0")
    monkeypatch.setenv("KYALULU_WEB_DIST", str(tmp_path))
    with pytest.raises(ValueError):
        mobile.Config.from_env()


@pytest.mark.asyncio
async def test_remote_content_crud_and_import_export(app, isolated):
    import json

    from python.storage.db import init_db

    await init_db()
    async with client(app) as remote:
        await pair(app, remote)
        created = await remote.post(
            "/api/memory", json={"scope": "phone", "type": "semantic", "content": "tea"}
        )
        assert created.status_code == 200
        memory_id = created.json()["id"]
        assert (await remote.get("/api/memory?scope=phone")).json()["memories"][0][
            "id"
        ] == memory_id
        assert (
            await remote.patch("/api/memory/" + memory_id, json={"content": "coffee"})
        ).status_code == 200
        assert (await remote.get("/api/memory/" + memory_id)).json()[
            "content"
        ] == "coffee"
        assert (await remote.delete("/api/memory/" + memory_id)).status_code == 200
        for kind in ("persona", "world"):
            created = await remote.post(
                "/api/creator/" + kind,
                json={"display_name": "Phone creation", "description": "shared"},
            )
            assert created.status_code == 201, created.text
            ref = created.json()["id"]
            assert (await remote.get(f"/api/creator/{kind}/{ref}")).status_code == 200
            assert (
                await remote.get(f"/api/creator/{kind}/{ref}/export")
            ).status_code == 200
            assert (
                await remote.put(
                    f"/api/creator/{kind}/{ref}", json={"display_name": "Edited"}
                )
            ).status_code == 200
        card = {
            "spec": "chara_card_v2",
            "spec_version": "2.0",
            "data": {
                "name": "Phone card",
                "description": "A companion",
                "personality": "kind",
                "scenario": "home",
                "first_mes": "Hi",
                "mes_example": "",
                "creator_notes": "",
                "tags": [],
            },
        }
        preview = await remote.post(
            "/api/imports/preview",
            files={
                "file": ("card.json", json.dumps(card).encode(), "application/json")
            },
        )
        assert preview.status_code == 200, preview.text
        data = preview.json()
        assert (
            await remote.get("/api/imports/" + data["preview_id"])
        ).status_code == 200
        committed = await remote.post(
            "/api/imports/" + data["preview_id"] + "/commit",
            json={
                "request_id": "phone-import",
                "selections": [
                    {
                        "index": 0,
                        "document": data["documents"][0],
                        "history_indices": [],
                    }
                ],
            },
        )
        assert committed.status_code == 200, committed.text
        item = committed.json()["items"][0]
        assert (await remote.get("/api/library/" + item["id"])).status_code == 200
        assert (
            await remote.put(
                "/api/library/" + item["id"],
                json={"expected_revision": 1, "document": item["document"]},
            )
        ).status_code == 200
        exported = await remote.get(
            "/api/library/" + item["id"] + "/export?download=true"
        )
        assert (
            exported.status_code == 200
            and "attachment" in exported.headers["content-disposition"]
        )
        assert exported.headers["cache-control"] == "no-store, private"


@pytest.mark.asyncio
async def test_unhandled_api_failure_is_generic_and_uncacheable(app):
    @app.get("/api/failure")
    async def failure():
        raise RuntimeError("internal sensitive detail")

    async with client(app, local=True) as admin:
        response = await admin.get("/api/failure")
        assert response.status_code == 500
        assert response.json() == {"error": "internal_error", "code": "internal_error"}
        assert response.headers["cache-control"] == "no-store, private"


def test_recovery_contract_and_future_sensitive_content_routes():
    assert mobile.permitted("GET", "/api/chat/generations/phone-generation")
    assert mobile.permitted("POST", "/api/chat/generations/phone-generation/cancel")
    for path in (
        "/api/memory/admin",
        "/api/library/admin",
        "/api/prompts/presets/admin",
        "/api/imports/admin/commit",
    ):
        assert not any(
            mobile.permitted(method, path)
            for method in ("GET", "POST", "PUT", "PATCH", "DELETE")
        )


def test_home_cli_tls_name_verifies_public_certificate_with_loopback_host(tmp_path):
    """Real TLS handshake: public DNS certificate, loopback TCP/Host, no verify=False."""
    import http.server
    import shutil
    import ssl
    import subprocess
    import sys
    import threading
    from pathlib import Path

    openssl = shutil.which("openssl")
    if not openssl:
        pytest.skip("OpenSSL is needed only for this temporary TLS certificate fixture")
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(
        [
            openssl,
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-subj",
            "/CN=runtime.example",
            "-addext",
            "subjectAltName=DNS:runtime.example",
        ],
        check=True,
        capture_output=True,
    )
    seen = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append((self.path, self.headers["Host"]))
            body = b'{"code":"12345678","expires_in":120}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(cert), str(key))
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"https://127.0.0.1:{server.server_port}"
        script = Path(__file__).resolve().parents[1] / "scripts/home_server.py"
        args = [sys.executable, str(script), "code", "--url", url, "--ca", str(cert)]
        result = subprocess.run(
            [*args, "--tls-name", "runtime.example"],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        assert result.returncode == 0, result.stderr
        assert '"code": "12345678"' in result.stdout
        assert seen == [("/api/mobile/admin/code", f"127.0.0.1:{server.server_port}")]
        for extra in ([], ["--tls-name", "wrong.example"]):
            failed = subprocess.run(
                [*args, *extra], capture_output=True, text=True, timeout=15, check=False
            )
            assert (
                failed.returncode != 0 and "CERTIFICATE_VERIFY_FAILED" in failed.stderr
            )
        # Without the trusted CA even the correct public name must fail.
        untrusted = subprocess.run(
            [
                sys.executable,
                str(script),
                "code",
                "--url",
                url,
                "--tls-name",
                "runtime.example",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        assert (
            untrusted.returncode != 0
            and "CERTIFICATE_VERIFY_FAILED" in untrusted.stderr
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.asyncio
async def test_remote_session_scope_blocks_global_mutations(app, isolated):
    import aiosqlite
    from python.storage import db

    await db.init_db()
    async with aiosqlite.connect(db.DB_PATH) as conn:
        await conn.execute(
            "INSERT INTO chat_history(role,content,session_id) VALUES('user','keep','__global__')"
        )
        await conn.commit()
        reserved_id = (
            await (
                await conn.execute(
                    "SELECT id FROM chat_history WHERE session_id='__global__'"
                )
            ).fetchone()
        )[0]
    async with client(app) as remote:
        await pair(app, remote)
        for sid in (None, "", " ", "__global__", "__reserved", " space", "x\n"):
            body = {} if sid is None else {"session_id": sid}
            for path in ("/api/chat", "/api/chat/stream", "/api/chat/suggest"):
                assert (
                    await remote.post(
                        path,
                        json={
                            **body,
                            "model_id": "mock-echo",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                ).status_code == 400
            assert (
                await remote.put("/api/chat/settings", json=body)
            ).status_code == 400
            params = {} if sid is None else {"session_id": sid}
            assert (
                await remote.delete("/api/chat/history", params=params)
            ).status_code == 400
            assert (
                await remote.post("/api/chat/intro/inject", params=params)
            ).status_code == 400
            assert (
                await remote.get("/api/chat/generations/g", params=params)
            ).status_code == 400
            assert (
                await remote.post("/api/chat/generations/g/cancel", params=params)
            ).status_code == 400
        assert (
            await remote.delete(
                "/api/chat/history?session_id=phone&session_id=__global__"
            )
        ).status_code == 400
        assert (
            await remote.put("/api/memory/session/__global__", json={"enabled": False})
        ).status_code == 400
        assert (
            await remote.delete(f"/api/chat/history/{reserved_id}")
        ).status_code == 403
        assert (
            await remote.put(
                f"/api/chat/history/{reserved_id}", json={"content": "overwrite"}
            )
        ).status_code == 403
        assert (
            await remote.post(
                "/api/chat", content="[", headers={"Content-Type": "application/json"}
            )
        ).status_code == 400
        assert (
            await remote.post("/api/chat", content="x" * (2 * 1024 * 1024 + 1))
        ).status_code == 413
        assert (
            await remote.delete("/api/chat/history?session_id=phone")
        ).status_code == 200
    async with aiosqlite.connect(db.DB_PATH) as conn:
        assert (
            await (
                await conn.execute(
                    "SELECT content FROM chat_history WHERE id=?", (reserved_id,)
                )
            ).fetchone()
        )[0] == "keep"
        assert (
            await (
                await conn.execute(
                    "SELECT * FROM session_settings WHERE session_id='__global__'"
                )
            ).fetchone()
            is None
        )
    async with client(app, local=True) as admin:
        assert (
            await admin.put(
                "/api/chat/settings",
                json={
                    "session_id": "__global__",
                    "system_prompt": "local administrator",
                },
            )
        ).status_code == 200


@pytest.mark.asyncio
async def test_scoped_body_replay_keeps_remote_sse_and_individual_edits_working(
    app, isolated
):
    async with client(app) as remote:
        await pair(app, remote)
        response = await remote.post(
            "/api/chat/stream",
            json={
                "session_id": "phone",
                "model_id": "mock-echo",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        assert response.status_code == 200 and "event: done" in response.text
        history = (await remote.get("/api/chat/history?session_id=phone")).json()[
            "history"
        ]
        assert (
            await remote.put(
                f"/api/chat/history/{history[0]['id']}", json={"content": "edited"}
            )
        ).status_code == 200
        assert (
            await remote.delete(f"/api/chat/history/{history[0]['id']}")
        ).status_code == 200
