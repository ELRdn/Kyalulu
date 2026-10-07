"""Optional local-to-managed-cloud sync. No keys or machine settings in snapshots."""

import asyncio
import json
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from uuid import uuid4
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from python.storage import db as storage
from python.cloud.transfers import snapshot_pages, apply_download
from python.local_backup import backup

router = APIRouter(prefix="/local/cloud")
lock = asyncio.Lock()


def config_path():
    return storage.DB_PATH.parent / "cloud-sync.json"


def read_config():
    try:
        config = json.loads(config_path().read_text(encoding="utf-8"))
    except FileNotFoundError:
        config = {"mode": "off", "revision": 0, "selected": []}
    current_origin = origin()
    if config.get("origin") != current_origin:
        # Unknown/changed endpoints require explicit enrollment; never forward old keys.
        config.update(mode="off", token="", revision=0, image_consent=False)
    config["origin"] = current_origin
    return config


def save_config(config):
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path.with_suffix(".tmp"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as file:
        json.dump(config, file)
    path.with_suffix(".tmp").replace(path)


def origin():
    from urllib.parse import urlsplit

    value = os.getenv("KYALULU_MANAGED_CLOUD_ORIGIN", "https://cloud.kyalulu.com")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid managed cloud origin")
    return value


async def remote(config, path, *, method="GET", body=None):
    if not config.get("token"):
        raise ValueError("クラウドの同期用トークンを登録してください")
    async with httpx.AsyncClient(timeout=120, follow_redirects=False) as client:
        for attempt in range(13):
            response = await client.request(
                method,
                origin() + "/api/cloud/sync" + path,
                json=body,
                headers={"Authorization": "Bearer " + config["token"], "Origin": origin()},
            )
            if response.status_code != 429 or attempt == 12:
                break
            await asyncio.sleep(5)
    if len(response.content) > 16_000_000:
        raise ValueError("同期データが大きすぎます")
    if response.status_code == 409:
        return {
            "conflict": True,
            "error": "クラウドが更新されています。クラウド版を採用するか、ローカル版を別コピーに保存してください。",
        }
    if not response.is_success:
        raise ValueError("クラウドの同期に失敗しました（HTTP %s）" % response.status_code)
    return response.json()


@router.get("")
async def settings():
    config = read_config()
    return {
        "mode": config["mode"],
        "connected": bool(config.get("token")),
        "revision": config["revision"],
        "selected": config.get("selected", []),
        "origin": origin(),
    }


@router.put("")
async def configure(request: Request):
    body = await request.json()
    if body.get("mode") not in {"off", "selected", "all"} or not isinstance(
        body.get("selected", []), list
    ):
        raise ValueError("同期の範囲を確認してください")
    async with lock:
        config = read_config()
        if "token" in body:
            if not isinstance(body["token"], str) or len(body["token"]) > 256:
                raise ValueError("同期用トークンを確認してください")
            if body["token"] != config.get("token"):
                config["revision"] = 0
            config["token"] = body["token"]
        if (body["mode"] != config["mode"]
                or body.get("selected", []) != config.get("selected", [])):
            config["revision"] = 0
        config.update(mode=body["mode"], selected=body.get("selected", []))
        config["image_consent"] = body.get("image_consent") is True
        if config["mode"] != "off":
            if body.get("consent") is not True:
                raise ValueError("クラウド保存とDeepSeekでのSFW検査に同意してください")
            result = await remote(config, "", method="PUT", body={"mode": config["mode"]})
            if result.get("conflict"):
                return JSONResponse(result, status_code=409)
            # Connecting never adopts a new head as a baseline: a non-empty cloud
            # workspace must be explicitly pulled or resolved by the user first.
        save_config(config)
        return await settings()


@router.post("/push")
async def push():
    await storage.init_db()
    async with lock:
        config = read_config()
        if config["mode"] == "off":
            raise ValueError("同期はオフです")
        selected = config["selected"] if config["mode"] == "selected" else None
        result = await remote(
            config,
            "/transfers",
            method="POST",
            body={
                "direction": "upload",
                "selected_sessions": selected,
                "base_revision": config["revision"],
                "request_id": uuid4().hex,
                "image_consent": config.get("image_consent") is True,
            },
        )
        if result.get("conflict"):
            return JSONResponse(result, status_code=409)
        transfer = result["transfer_id"]
        try:
            # Never hold a live local DB read lock across network calls.
            with tempfile.TemporaryDirectory(dir=storage.DB_PATH.parent) as tmp:
                path = Path(tmp) / "data.db"
                with (
                    closing(sqlite3.connect(storage.DB_PATH)) as source,
                    closing(sqlite3.connect(path)) as dest,
                ):
                    source.backup(dest)
                count, chain = 0, ""
                for page in snapshot_pages(path, selected, include_assets=True, asset_directory=storage.DB_PATH.parent / "library_assets"):
                    if page.get("assets") and config.get("image_consent") is not True:
                        raise ValueError("画像のクラウド保存とDeepSeekへのSFW検査送信に同意してください")
                    acknowledged = await remote(
                        config, f"/transfers/{transfer}/pages/{count}", method="PUT", body=page
                    )
                    if acknowledged.get("conflict"):
                        return JSONResponse(acknowledged, status_code=409)
                    chain = acknowledged["chain"]
                    count += 1
                result = await remote(
                    config,
                    f"/transfers/{transfer}/commit",
                    method="POST",
                    body={"pages": count, "chain": chain},
                )
                if result.get("conflict"):
                    return JSONResponse(result, status_code=409)
            config["revision"] = result["revision"]
            save_config(config)
            return result
        finally:
            try:
                await remote(config, f"/transfers/{transfer}", method="DELETE")
            except (ValueError, httpx.HTTPError):
                pass  # encrypted temporary upload expires after one hour


@router.post("/adopt")
async def adopt():
    await storage.init_db()
    async with lock:
        config = read_config()
        if config["mode"] == "off":
            raise ValueError("同期はオフです")
        selected = config["selected"] if config["mode"] == "selected" else None
        result = await remote(
            config,
            "/transfers",
            method="POST",
            body={"direction": "download", "selected_sessions": selected},
        )
        if result.get("deleted"):
            raise ValueError("クラウドコピーは削除されています")
        transfer = result["transfer_id"]
        try:
            with tempfile.TemporaryDirectory(dir=storage.DB_PATH.parent) as tmp:
                tmp = Path(tmp)
                for i in range(result["pages"]):
                    page = await remote(config, f"/transfers/{transfer}/pages/{i}")
                    (tmp / f"{i}.json").write_text(json.dumps(page), encoding="utf-8")
                before = (
                    storage.DB_PATH.parent
                    / "backups"
                    / ("before-cloud-adopt-" + uuid4().hex + ".zip")
                )
                backup(storage.DB_PATH.parent, before)
                pages = (
                    json.loads((tmp / f"{i}.json").read_text(encoding="utf-8"))
                    for i in range(result["pages"])
                )
                apply_download(storage.DB_PATH, selected, pages)
            config["revision"] = result["revision"]
            save_config(config)
            return {"revision": result["revision"], "local_copy": str(before)}
        finally:
            try:
                await remote(config, f"/transfers/{transfer}", method="DELETE")
            except (ValueError, httpx.HTTPError):
                pass


@router.post("/copy")
async def separate_copy():
    await storage.init_db()
    path = storage.DB_PATH.parent / "backups" / ("local-conflict-copy-" + uuid4().hex + ".zip")
    backup(storage.DB_PATH.parent, path)
    return {"local_copy": str(path)}
