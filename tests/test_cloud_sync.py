"""Local sync baseline belongs to its connection and selection; no external I/O."""

import json

import pytest
from starlette.requests import Request

from python.api import cloud_sync
from python.storage import db as storage


def request(body):
    async def receive():
        return {"type": "http.request", "body": json.dumps(body).encode(), "more_body": False}
    return Request({"type": "http", "method": "PUT", "headers": []}, receive)


@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "data.db")
    monkeypatch.setenv("KYALULU_MANAGED_CLOUD_ORIGIN", "https://cloud.test")
    value = {"mode": "selected", "selected": ["chat-a"], "revision": 7,
             "token": "device-a", "origin": "https://cloud.test", "image_consent": False}
    cloud_sync.save_config(value)
    return value


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [
    {"token": "device-b"}, {"selected": ["chat-b"]}, {"mode": "all"},
])
async def test_changed_sync_binding_cannot_reuse_another_baseline(local, monkeypatch, change):
    calls = []

    async def remote(config, path, **kwargs):
        calls.append((path, kwargs))
        if path == "":
            return {"mode": config["mode"]}
        if path == "/transfers":
            # The new account/scope happens to have the same numeric head.
            assert kwargs["body"]["base_revision"] == 0
            return {"conflict": True, "error": "cloud was updated"}
        pytest.fail("conflicting baseline must not send data pages")

    monkeypatch.setattr(cloud_sync, "remote", remote)
    result = await cloud_sync.configure(request({
        "mode": local["mode"], "selected": local["selected"], "consent": True, **change,
    }))
    assert result["revision"] == 0
    assert (await cloud_sync.push()).status_code == 409
    assert [path for path, _ in calls] == ["", "/transfers"]


@pytest.mark.asyncio
async def test_unchanged_binding_preserves_baseline(local, monkeypatch):
    async def remote(config, path, **kwargs):
        assert path == ""
        return {"mode": config["mode"]}
    monkeypatch.setattr(cloud_sync, "remote", remote)
    result = await cloud_sync.configure(request({"mode": local["mode"],
        "selected": local["selected"], "token": local["token"], "consent": True}))
    assert result["revision"] == 7
    assert "token" not in result


@pytest.mark.asyncio
async def test_origin_change_disables_sync_without_sending_old_token(local, monkeypatch):
    monkeypatch.setenv("KYALULU_MANAGED_CLOUD_ORIGIN", "https://another-cloud.test")

    async def remote(*args, **kwargs):
        pytest.fail("old token or local data must never reach the changed origin")
    monkeypatch.setattr(cloud_sync, "remote", remote)
    settings = await cloud_sync.settings()
    assert settings["mode"] == "off" and not settings["connected"]
    assert settings["revision"] == 0
    with pytest.raises(ValueError, match="同期はオフ"):
        await cloud_sync.push()


def test_legacy_config_requires_fresh_baseline(local):
    local.pop("origin")
    cloud_sync.save_config(local)
    migrated = cloud_sync.read_config()
    assert migrated["revision"] == 0 and migrated["mode"] == "off" and not migrated["token"]


@pytest.mark.asyncio
async def test_failed_reconfiguration_preserves_existing_binding(local, monkeypatch):
    async def remote(*args, **kwargs):
        raise ValueError("unavailable")
    monkeypatch.setattr(cloud_sync, "remote", remote)
    with pytest.raises(ValueError, match="unavailable"):
        await cloud_sync.configure(request({"mode": "all", "token": "device-b", "consent": True}))
    assert cloud_sync.read_config() == local
