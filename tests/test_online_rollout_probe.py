import hashlib
from email.message import Message

import pytest

from scripts import probe_online_rollout as monitor


CURRENT = "/_next/static/chunks/current.js"
HELD = "/_next/static/chunks/previous.js"
FILES = {CURRENT: b"current", HELD: b"previous", "/sw.js": b"worker", "/source.tar.gz": b"source"}


@pytest.fixture
def wave(monkeypatch):
    hashes = {"web" + name: hashlib.sha256(content).hexdigest() for name, content in FILES.items()}
    hashes[monitor.NODE_STATIC + "chunks/current.js"] = hashes["web" + CURRENT]
    hashes["kyalulu-source.tar.gz"] = hashes.pop("web/source.tar.gz")

    def run(*, held=FILES[HELD], worker=FILES["/sw.js"], advertised=CURRENT, wrong_beta=False):
        requests = []

        def get(connection, path, bucket, _limit, accept):
            requests.append((connection, path, bucket, accept))
            headers = Message()
            headers["Cache-Control"] = "private, no-store"
            eligible = bucket == "pilot" or wrong_beta and bucket == "beta"
            if path in ("/api/health", "/healthz"):
                return 200, headers, b'{"status":"ok"}', 1
            if path == "/api/mobile/status":
                if eligible:
                    headers["X-Kyalulu-Next-Chats"] = "1"
                return 200, headers, b'{"authenticated":false,"cloud_mode":true}', 1
            content = {**FILES, HELD: held, "/sw.js": worker}
            if path in content:
                return 200, headers, content[path], 1
            headers["Content-Type"] = "text/html; charset=utf-8"
            if path == "/" and bucket is None:
                headers["Set-Cookie"] = f"{monitor.COOKIE}=beta; Path=/; HttpOnly; Secure; SameSite=Lax"
            if eligible and path == "/chats":
                markup = '<html data-kyalulu-frontend="next"><script src="' + advertised + '"></script></html>'
                return 200, headers, markup.encode(), 1
            return (404 if path == monitor.PROBE_404 else 200), headers, b"<html></html>", 1

        monkeypatch.setattr(monitor, "get", get)
        report = monitor.probe("app", hashes, cohort="pilot", enabled={"chats"}, held_chunks=[HELD], source=True, relay="relay")
        return report, requests

    return run


def test_anonymous_wave_and_retained_assets(wave):
    report, requests = wave(advertised=CURRENT + "?ignored=test")
    assert report["ok"] and not report["failures"]
    assert ("relay", "/healthz", None, "application/json") in requests
    assert requests.count(("app", CURRENT, None, "*/*")) == 1
    assert requests.count(("app", HELD, None, "*/*")) == 1
    assert "ignored" not in str(report)


@pytest.mark.parametrize(("override", "reason"), [
    ({"held": b"corrupted"}, "Bundle file mismatch"),
    ({"worker": b"wrong worker"}, "Bundle file mismatch"),
    ({"advertised": HELD}, "Next HTML referenced a script outside the selected build"),
    ({"wrong_beta": True}, "Unexpected chats delivery flag"),
])
def test_rollout_errors_fail_closed(wave, override, reason):
    report, _ = wave(**override)
    assert not report["ok"]
    assert any(failure["reason"] == reason for failure in report["failures"])
