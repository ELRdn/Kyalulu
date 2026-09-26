"""Connection diagnostics for the Status page and the desktop app.

One call answers "why can't I chat?": is the API's storage readable, which
providers answer, is LE reachable with a valid token, is a built-in model
loaded. Each check carries a Japanese message and, when it fails, a hint that
names the next step. Nothing here generates text or changes state.
"""
import asyncio
import os

import aiosqlite
import httpx
from fastapi import APIRouter

from python.api.providers import providers_health
from python.core.config import default_le_token_file
from python.providers.le import LEProvider
from python.storage import db as storage

router = APIRouter()
TIMEOUT = 5


def _check(id_: str, ok: bool | None, message: str, hint: str | None = None, **detail) -> dict:
    return {"id": id_, "ok": ok, "message": message, "hint": None if ok else hint, "detail": detail or None}


async def _storage() -> dict:
    try:
        async with aiosqlite.connect(storage.DB_PATH) as db:
            sessions = (await (await db.execute("SELECT COUNT(DISTINCT session_id) FROM chat_history")).fetchone())[0]
            library = (await (await db.execute("SELECT COUNT(*) FROM library_versions")).fetchone())[0]
    except Exception as e:
        return _check("storage", False, f"データベースを読めません（{type(e).__name__}）",
                      "KYALULU_DATA_DIR の場所と書き込み権限を確認してね", path=str(storage.DB_PATH))
    return _check("storage", True, f"会話 {sessions} 件・ライブラリ {library} 件を保存済み",
                  path=str(storage.DB_PATH), sessions=sessions, library_versions=library,
                  data_dir_env=bool(os.environ.get("KYALULU_DATA_DIR")))


async def _le() -> list[dict]:
    le = LEProvider()
    if not le.api_key:
        return [_check("le", None, "LE は未設定（トークンなし）",
                       "LE を使うなら le-daemon を起動するか、Desktop で KYALULU_LE_BINARY を設定してね",
                       token_file=str(default_le_token_file()))]
    try:
        async with asyncio.timeout(TIMEOUT):
            status, health = await le.call("GET", "health")
            if status == 401:
                return [_check("le", False, "LE がトークンを拒否しました",
                               "LE の api-token と Kyalulu の LE_API_TOKEN が一致しているか確認してね")]
            caps = await le.le_capabilities()
            _, res = await le.call("GET", "resources")
            _, models = await le.call("GET", "models")
            served = await le.served_models()
    except (httpx.HTTPError, TimeoutError, ValueError) as e:
        return [_check("le", False, f"LE に接続できません（{type(e).__name__}）",
                       "le-daemon が起動しているか、LE_API_URL を確認してね", url=le.root_url)]
    engine = ((caps.get("inference") or {}).get("engine") or {})
    backends = (caps.get("inference") or {}).get("backends") or []
    ready = [b["id"] for b in backends if b.get("state") == "ready"]
    installed = [m["id"] for m in models.get("models", []) if m.get("state") in ("ready", "loaded")]
    loaded = (res.get("engine") or {}).get("model_id")
    out = [_check("le", health.get("status") == "ok", f"LE 稼働中（{le.root_url}）", url=le.root_url,
                  backends_ready=ready, served_models=served)]
    out.append(_check("le_models", bool(served),
                      f"会話用モデル {len(served)} 件" if served else "会話用モデルは配信されていません",
                      "/le models で確認し、/le load <id> でモデルをロードしてね"))
    if not engine.get("available"):
        out.append(_check("le_engine", None, "内蔵エンジン（llama-server）は未設定",
                          "GGUF を LE で直接動かすなら LE_LLAMA_SERVER_BIN を設定してね"))
    elif loaded:
        out.append(_check("le_engine", True, f"{loaded} をロード中", model=loaded))
    elif installed:
        out.append(_check("le_engine", False, "内蔵モデルはロードされていません",
                          f"チャット欄で /le load {installed[0]} を実行するとロードできるよ", installed=installed))
    else:
        out.append(_check("le_engine", None, "内蔵モデルは未インストール",
                          "/le download <GGUFのURL> でダウンロードできるよ"))
    return out


@router.get("/diagnostics")
async def diagnostics():
    storage, le_checks, health = await asyncio.gather(_storage(), _le(), providers_health())
    providers = [h for h in health["health"] if h["id"] not in ("le", "mock")]
    reachable = [h["id"] for h in providers if h.get("status") == "ok" and h.get("models") != []]
    engine_ok = any(c["id"] == "le_engine" and c["ok"] for c in le_checks)
    le_models = any(c["id"] == "le_models" and c["ok"] for c in le_checks)
    chat_ready = bool(reachable) or engine_ok or le_models
    checks = [
        _check("api", True, "API 稼働中"),
        storage,
        _check("providers", bool(reachable),
               f"直接つながるエンジン: {', '.join(reachable)}" if reachable else "直接つながる会話エンジンはありません",
               "Ollama や LM Studio を起動するか、LE 経由のモデルを使ってね",
               status={h["id"]: h.get("status") for h in providers}),
        *le_checks,
    ]
    return {"ready": chat_ready and storage["ok"], "checks": checks}
