"""Chat API - SSEストリーミング対応"""

import json
import time
import uuid
from typing import List

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel

from python.providers.factory import get_provider_for_model
from python.core.registry import load_yaml_registry, list_models_from_db
from python.storage.db import init_db
import aiosqlite
from python.storage.db import DB_PATH

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model_id: str
    messages: List[ChatMessage]
    stream: bool = True
    temperature: float = 0.8
    session_id: str = "default"


@router.get("/models")
async def list_models():
    """YAML+DBからモデル一覧を返す"""
    try:
        models = await list_models_from_db()
        # フォールバック: YAML直接 (DB空の場合)
        if not models:
            models = load_yaml_registry()
        # 簡易整形
        out = []
        for m in models:
            out.append(
                {
                    "id": m.get("id"),
                    "display_name": m.get("display_name", m.get("id")),
                    "provider_type": m.get("provider", {}).get("type", "unknown") if isinstance(m.get("provider"), dict) else "unknown",
                    "provider_model": m.get("provider", {}).get("model", "") if isinstance(m.get("provider"), dict) else "",
                    "quantization": m.get("quantization", ""),
                    "context_length": m.get("context_length"),
                }
            )
        return {"models": out}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.post("/chat")
async def chat_non_stream(req: ChatRequest):
    """非ストリーミング (デバッグ用)"""
    models = load_yaml_registry()
    cfg = next((m for m in models if m.get("id") == req.model_id), None)
    if not cfg:
        return JSONResponse(status_code=404, content={"error": f"model {req.model_id} not found"})
    provider = get_provider_for_model(cfg)
    provider_cfg = cfg.get("provider", {}) if isinstance(cfg.get("provider"), dict) else {}
    messages = [m.model_dump() for m in req.messages]
    text = await provider.generate("", messages=messages, model=provider_cfg.get("model"), temperature=req.temperature)
    # 簡易履歴保存
    try:
        await init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            sid = req.session_id or "default"
            # 重複保存を避けるため、最後の1往復のみ保存（既に履歴にある場合はスキップされる想定）
            # 簡易: 最後のuserとassistantを保存
            last_user = req.messages[-1] if req.messages else None
            if last_user:
                await db.execute("INSERT INTO chat_history (session_id, role, content, model_id) VALUES (?, ?, ?, ?)", (sid, last_user.role, last_user.content, req.model_id))
            await db.execute("INSERT INTO chat_history (session_id, role, content, model_id) VALUES (?, ?, ?, ?)", (sid, "assistant", text, req.model_id))
            await db.commit()
    except Exception:
        pass
    return {"reply": text, "model_id": req.model_id}


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    """SSEストリーミング"""
    models = load_yaml_registry()
    cfg = next((m for m in models if m.get("id") == req.model_id), None)
    if not cfg:
        async def err_gen():
            yield {"event": "error", "data": json.dumps({"error": f"model {req.model_id} not found"}, ensure_ascii=False)}

        return EventSourceResponse(err_gen())

    provider = get_provider_for_model(cfg)
    provider_cfg = cfg.get("provider", {}) if isinstance(cfg.get("provider"), dict) else {}
    messages = [m.model_dump() for m in req.messages]

    async def gen():
        # meta
        yield {"event": "meta", "data": json.dumps({"model_id": req.model_id, "provider_type": provider_cfg.get("type")}, ensure_ascii=False)}
        full = ""
        start = time.time()
        try:
            async for chunk in provider.stream_generate("", messages=messages, model=provider_cfg.get("model"), temperature=req.temperature):
                if await request.is_disconnected():
                    break
                full += chunk
                yield {"event": "token", "data": json.dumps({"token": chunk}, ensure_ascii=False)}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"error": str(e)}, ensure_ascii=False)}
            return
        # done
        elapsed = time.time() - start
        yield {"event": "done", "data": json.dumps({"full": full, "elapsed_ms": int(elapsed * 1000)}, ensure_ascii=False)}
        # 保存 (fire-and-forget)
        try:
            await init_db()
            async with aiosqlite.connect(DB_PATH) as db:
                sid = req.session_id or "default"
                last_user = req.messages[-1] if req.messages else None
                if last_user:
                    await db.execute("INSERT INTO chat_history (session_id, role, content, model_id) VALUES (?, ?, ?, ?)", (sid, last_user.role, last_user.content, req.model_id))
                await db.execute("INSERT INTO chat_history (session_id, role, content, model_id) VALUES (?, ?, ?, ?)", (sid, "assistant", full, req.model_id))
                await db.commit()
        except Exception as e:
            print(f"[chat] save failed {e}")

    return EventSourceResponse(gen(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@router.get("/chat/history")
async def chat_history(limit: int = 50, session_id: str | None = None):
    """直近履歴を取得（session_id指定で絞り込み）"""
    try:
        await init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            if session_id:
                cur = await db.execute("SELECT role, content, model_id, created_at, session_id FROM chat_history WHERE session_id=? ORDER BY id DESC LIMIT ?", (session_id, limit))
            else:
                cur = await db.execute("SELECT role, content, model_id, created_at, session_id FROM chat_history ORDER BY id DESC LIMIT ?", (limit,))
            rows = await cur.fetchall()
            rows = list(reversed(rows))
            return {"history": [dict(r) for r in rows]}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.get("/chat/sessions")
async def list_sessions():
    """会話（セッション）一覧を取得"""
    try:
        await init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute("""
                SELECT session_id, COUNT(*) as count, MAX(created_at) as last_at,
                       (SELECT content FROM chat_history h2 WHERE h2.session_id = h.session_id ORDER BY id DESC LIMIT 1) as last_preview
                FROM chat_history h
                GROUP BY session_id
                ORDER BY last_at DESC
            """)
            rows = await cur.fetchall()
            sessions = [dict(r) for r in rows]
            # デフォルトセッションがまだ無い場合でも空で返す
            return {"sessions": sessions}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.delete("/chat/history")
async def clear_history(session_id: str | None = None):
    """履歴削除（session_id指定でその会話のみ、無指定で全削除）"""
    try:
        await init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            if session_id:
                await db.execute("DELETE FROM chat_history WHERE session_id=?", (session_id,))
            else:
                await db.execute("DELETE FROM chat_history")
            await db.commit()
            return {"ok": True}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
