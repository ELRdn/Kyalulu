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
    temperature: float | None = None
    session_id: str = "default"
    system_prompt: str | None = None


class SessionSettings(BaseModel):
    session_id: str = "default"
    system_prompt: str = ""
    temperature: float = 0.8
    character_id: str | None = None
    persona_id: str | None = None
    world_id: str | None = None
    intro: str = ""


async def _save_settings(
    session_id: str,
    system_prompt: str | None,
    temperature: float | None,
    character_id: str | None = None,
    persona_id: str | None = None,
    world_id: str | None = None,
    intro: str | None = None,
    _has_char: bool = False,
    _has_persona: bool = False,
    _has_world: bool = False,
    _has_intro: bool = False,
) -> None:
    """設定をupsert（部分更新対応）"""
    await init_db()
    sid = session_id or "default"
    # 現在値を取得してマージ
    cur_settings = await _load_settings(sid)
    sp = system_prompt if system_prompt is not None else cur_settings.system_prompt
    temp = temperature if temperature is not None else cur_settings.temperature
    temp = max(0.0, min(2.0, temp))
    char_id = character_id if _has_char else cur_settings.character_id
    per_id = persona_id if _has_persona else cur_settings.persona_id
    w_id = world_id if _has_world else cur_settings.world_id
    intro_val = intro if _has_intro else cur_settings.intro
    if intro_val is not None and len(intro_val) > 10000:
        intro_val = intro_val[:10000]
    if sp is not None and len(sp) > 10000:
        sp = sp[:10000]
    async with aiosqlite.connect(DB_PATH) as db:
        # 既存レコードの有無で分岐せず、常に全列をupsert（存在しない列はマイグレーション後に作成済み）
        await db.execute(
            """
            INSERT INTO session_settings (session_id, system_prompt, temperature, character_id, persona_id, world_id, intro, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(session_id) DO UPDATE SET
                system_prompt=excluded.system_prompt,
                temperature=excluded.temperature,
                character_id=excluded.character_id,
                persona_id=excluded.persona_id,
                world_id=excluded.world_id,
                intro=excluded.intro,
                updated_at=datetime('now')
            """,
            (sid, sp or "", temp, char_id, per_id, w_id, intro_val or ""),
        )
        await db.commit()


async def _load_settings(session_id: str) -> SessionSettings:
    """session_settings から取得、なければグローバル(__global__)→デフォルトをフォールバック"""
    await init_db()
    sid = session_id or "default"
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            # セッション固有（新列が無いDBでも動くように try）
            try:
                cur = await db.execute("SELECT system_prompt, temperature, character_id, persona_id, world_id, intro FROM session_settings WHERE session_id=?", (sid,))
            except Exception:
                try:
                    cur = await db.execute("SELECT system_prompt, temperature, character_id, persona_id, world_id FROM session_settings WHERE session_id=?", (sid,))
                except Exception:
                    cur = await db.execute("SELECT system_prompt, temperature FROM session_settings WHERE session_id=?", (sid,))
            row = await cur.fetchone()
            if row is not None:
                # 列の有無を安全に取得
                def _get(k, default=None):
                    try:
                        return row[k]
                    except Exception:
                        return default
                return SessionSettings(
                    session_id=sid,
                    system_prompt=_get("system_prompt") or "",
                    temperature=_get("temperature") if _get("temperature") is not None else 0.8,
                    character_id=_get("character_id"),
                    persona_id=_get("persona_id"),
                    world_id=_get("world_id"),
                    intro=_get("intro") or "",
                )
            # グローバルフォールバック
            try:
                cur = await db.execute("SELECT system_prompt, temperature, character_id, persona_id, world_id, intro FROM session_settings WHERE session_id='__global__'")
            except Exception:
                try:
                    cur = await db.execute("SELECT system_prompt, temperature, character_id, persona_id, world_id FROM session_settings WHERE session_id='__global__'")
                except Exception:
                    cur = await db.execute("SELECT system_prompt, temperature FROM session_settings WHERE session_id='__global__'")
            grow = await cur.fetchone()
            if grow is not None:
                def _gget(k, default=None):
                    try:
                        return grow[k]
                    except Exception:
                        return default
                if _gget("system_prompt"):
                    return SessionSettings(
                        session_id=sid,
                        system_prompt=_gget("system_prompt") or "",
                        temperature=_gget("temperature") if _gget("temperature") is not None else 0.8,
                        character_id=_gget("character_id"),
                        persona_id=_gget("persona_id"),
                        world_id=_gget("world_id"),
                        intro=_gget("intro") or "",
                    )
    except Exception as e:
        print(f"[settings] load failed {e}")
    return SessionSettings(session_id=sid, system_prompt="", temperature=0.8)


def _inject_system(messages: list[dict], system_prompt: str) -> list[dict]:
    """先頭に system メッセージを注入（既にsystemがあれば先頭を置換）"""
    if not system_prompt or not system_prompt.strip():
        return messages
    sp = system_prompt.strip()
    if messages and messages[0].get("role") == "system":
        # 既存systemを上書き
        return [{"role": "system", "content": sp}] + messages[1:]
    return [{"role": "system", "content": sp}] + messages


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


@router.get("/chat/settings")
async def get_settings(session_id: str = "default"):
    """セッション設定を取得"""
    s = await _load_settings(session_id)
    return s.model_dump()


@router.put("/chat/settings")
async def put_settings(body: SessionSettings):
    """セッション設定を保存（upsert）"""
    if len(body.system_prompt or "") > 10000:
        return JSONResponse(status_code=400, content={"error": "system_prompt too long (max 10000)"})
    if len(body.intro or "") > 10000:
        return JSONResponse(status_code=400, content={"error": "intro too long (max 10000)"})
    await _save_settings(
        body.session_id,
        body.system_prompt,
        body.temperature,
        body.character_id,
        body.persona_id,
        body.world_id,
        body.intro,
        _has_char=body.character_id is not None or "character_id" in body.model_fields_set,
        _has_persona=body.persona_id is not None or "persona_id" in body.model_fields_set,
        _has_world=body.world_id is not None or "world_id" in body.model_fields_set,
        _has_intro="intro" in body.model_fields_set,
    )
    s = await _load_settings(body.session_id)
    return {"ok": True, **s.model_dump()}


@router.post("/chat/intro/inject")
async def inject_intro(session_id: str = "default"):
    """イントロを chat_history に初回アシスタントメッセージとして注入（重複防止）"""
    await init_db()
    s = await _load_settings(session_id)
    intro = (s.intro or "").strip()
    # キャラのデフォイントロをフォールバック
    if not intro and s.character_id:
        from python.core.prompt_compiler import _load_yaml, CHAR_DIR
        char = _load_yaml(CHAR_DIR, s.character_id)
        if char and char.get("intro"):
            intro = char["intro"].strip()
    if not intro:
        return JSONResponse(status_code=400, content={"error": "intro is empty (set session intro or character intro)"})
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT COUNT(*) as c FROM chat_history WHERE session_id=?", (session_id,))
        row = await cur.fetchone()
        if row and row[0] > 0:
            # 既に履歴がある場合は先頭が同じintroでなければ追加しない（重複防止の簡易チェック）
            cur2 = await db.execute("SELECT content FROM chat_history WHERE session_id=? ORDER BY id ASC LIMIT 1", (session_id,))
            first = await cur2.fetchone()
            if first and first[0] == intro:
                return {"ok": True, "injected": False, "reason": "already injected"}
        # history が空 or まだintroが未注入なら追加（モデルは intro）
        await db.execute("INSERT INTO chat_history (session_id, role, content, model_id) VALUES (?, ?, ?, ?)", (session_id, "assistant", intro, "intro"))
        await db.commit()
        return {"ok": True, "injected": True, "intro": intro}


@router.post("/chat")
async def chat_non_stream(req: ChatRequest):
    """非ストリーミング (デバッグ用)"""
    models = load_yaml_registry()
    cfg = next((m for m in models if m.get("id") == req.model_id), None)
    if not cfg:
        return JSONResponse(status_code=404, content={"error": f"model {req.model_id} not found"})
    provider = get_provider_for_model(cfg)
    provider_cfg = cfg.get("provider", {}) if isinstance(cfg.get("provider"), dict) else {}
    # 設定を解決：フロントから送られた値を優先（即時反映）、無ければDB
    settings = await _load_settings(req.session_id)
    sp = req.system_prompt if req.system_prompt is not None else settings.system_prompt
    temp = req.temperature if req.temperature is not None else settings.temperature
    # 自動保存（チャット送信時に設定も一緒に永続化）
    if req.system_prompt is not None or req.temperature is not None:
        try:
            await _save_settings(req.session_id, sp, temp)
        except Exception as e:
            print(f"[chat] auto-save settings failed {e}")
    # Character/Runtime: もしキャラ等が選択されていれば Compilerで最終system_promptを生成
    final_sp = sp
    try:
        if settings.character_id or settings.persona_id or settings.world_id:
            from python.core.prompt_compiler import compile_prompt

            compiled = compile_prompt(
                character_id=settings.character_id,
                persona_id=settings.persona_id,
                world_id=settings.world_id,
                extra_system_prompt=sp if sp and sp.strip() else None,
            )
            final_sp = compiled.system_prompt
    except Exception as e:
        print(f"[chat] compile failed {e}, fallback to raw sp")
    messages = _inject_system([m.model_dump() for m in req.messages], final_sp)
    text = await provider.generate("", messages=messages, model=provider_cfg.get("model"), temperature=temp)
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
    settings = await _load_settings(req.session_id)
    sp = req.system_prompt if req.system_prompt is not None else settings.system_prompt
    temp = req.temperature if req.temperature is not None else settings.temperature
    # 自動保存（送信と同時に設定も永続化）
    if req.system_prompt is not None or req.temperature is not None:
        try:
            await _save_settings(req.session_id, sp, temp)
        except Exception as e:
            print(f"[chat] auto-save settings failed {e}")
    # Character/Runtime: Compilerで最終system_promptを生成
    final_sp = sp
    try:
        if settings.character_id or settings.persona_id or settings.world_id:
            from python.core.prompt_compiler import compile_prompt

            compiled = compile_prompt(
                character_id=settings.character_id,
                persona_id=settings.persona_id,
                world_id=settings.world_id,
                extra_system_prompt=sp if sp and sp.strip() else None,
            )
            final_sp = compiled.system_prompt
    except Exception as e:
        print(f"[chat] compile failed {e}, fallback to raw sp")
    messages = _inject_system([m.model_dump() for m in req.messages], final_sp)

    async def gen():
        # meta
        yield {"event": "meta", "data": json.dumps({"model_id": req.model_id, "provider_type": provider_cfg.get("type")}, ensure_ascii=False)}
        full = ""
        start = time.time()
        try:
            async for chunk in provider.stream_generate("", messages=messages, model=provider_cfg.get("model"), temperature=temp):
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
                cur = await db.execute("SELECT id, role, content, model_id, created_at, session_id FROM chat_history WHERE session_id=? ORDER BY id DESC LIMIT ?", (session_id, limit))
            else:
                cur = await db.execute("SELECT id, role, content, model_id, created_at, session_id FROM chat_history ORDER BY id DESC LIMIT ?", (limit,))
            rows = await cur.fetchall()
            rows = list(reversed(rows))
            return {"history": [dict(r) for r in rows]}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


class HistoryUpdateIn(BaseModel):
    content: str


@router.put("/chat/history/{msg_id}")
async def update_history_message(msg_id: int, body: HistoryUpdateIn):
    content = body.content.strip()
    if not content:
        return JSONResponse(status_code=400, content={"error": "content is empty"})
    if len(content) > 10000:
        return JSONResponse(status_code=400, content={"error": "content too long"})
    try:
        await init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            cur = await db.execute("SELECT id FROM chat_history WHERE id=?", (msg_id,))
            if not await cur.fetchone():
                return JSONResponse(status_code=404, content={"error": "message not found"})
            await db.execute("UPDATE chat_history SET content=? WHERE id=?", (content, msg_id))
            await db.commit()
            return {"ok": True, "id": msg_id}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.delete("/chat/history/{msg_id}")
async def delete_history_message(msg_id: int):
    try:
        await init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            cur = await db.execute("SELECT id FROM chat_history WHERE id=?", (msg_id,))
            if not await cur.fetchone():
                return JSONResponse(status_code=404, content={"error": "message not found"})
            await db.execute("DELETE FROM chat_history WHERE id=?", (msg_id,))
            await db.commit()
            return {"ok": True, "id": msg_id}
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


@router.get("/chat/debug")
async def chat_debug(session_id: str = "default"):
    """M7: Debug Drawer 用 — 現在セッションの compiled prompt / token内訳 / state を返す（Researcherのみ前面で利用）"""
    try:
        s = await _load_settings(session_id)
        from python.core.prompt_compiler import compile_prompt
        compiled = compile_prompt(
            character_id=s.character_id,
            persona_id=s.persona_id,
            world_id=s.world_id,
            extra_system_prompt=s.system_prompt,
        )
        # session の履歴件数と簡易state
        await init_db()
        history_count = 0
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                cur = await db.execute("SELECT COUNT(*) as c FROM chat_history WHERE session_id=?", (session_id,))
                row = await cur.fetchone()
                if row:
                    history_count = row[0]
        except Exception:
            pass
        from python.core.state import infer_relationship
        # turnは履歴件数から推定（user+assistantで2件=1往復の簡易）
        approx_turn = max(0, history_count // 2)
        return {
            "session_id": session_id,
            "settings": s.model_dump(),
            "compiled": compiled.model_dump(),
            "history_count": history_count,
            "approx_turn": approx_turn,
            "relationship": infer_relationship(approx_turn),
        }
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
