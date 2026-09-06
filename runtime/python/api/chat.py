"""Chat API - SSEストリーミング対応"""

import json
import uuid
from typing import List

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel, Field

from python.providers.factory import get_provider_for_model
from python.core.registry import load_yaml_registry, list_models_from_db
from python.storage.db import init_db
import aiosqlite
from python.storage.db import DB_PATH

from python.storage import generations
from python.core.generation import generate_events
from python.core.prompt_compiler import compile_prompt
from python.core.portable_schema import LibraryBinding

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model_id: str
    messages: List[ChatMessage]
    generation_id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=128)
    seed: int | None = None
    regenerate_message_id: int | None = None
    allow_nsfw: bool = False
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
    library_binding: LibraryBinding | None = None


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
    library_binding: LibraryBinding | None = None,
    _has_binding: bool = False,
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
    from python.storage.library import get_item
    binding = library_binding.model_dump() if library_binding else {} if _has_binding else cur_settings.library_binding.model_dump() if cur_settings.library_binding else {}
    if char_id != cur_settings.character_id and not (_has_binding and (binding.get('character') or {}).get('id') == char_id):
        binding.pop('character', None)
        binding['expression_asset_id'] = None
    if char_id and char_id.startswith('lib_'):
        ref = binding.get('character')
        item = get_item(char_id, ref['revision'] if ref and ref['id'] == char_id else None)
        if not item or item.document.kind != 'character':
            raise ValueError('character revision not found')
        binding['character'] = {'id': item.id, 'revision': item.revision}
    else:
        binding.pop('character', None)
    # Validate related revisions before saving, without changing an existing conversation.
    from python.core.prompt_compiler import _portable_snapshot
    snapshot = _portable_snapshot(char_id, per_id, w_id, sp, binding)
    previous_binding = cur_settings.library_binding.model_dump() if cur_settings.library_binding else {}
    if temperature is None and snapshot and (binding.get('character') != previous_binding.get('character') or binding.get('profile') != previous_binding.get('profile')):
        suggested = snapshot['document']['profile']['settings'].get('temperature')
        if isinstance(suggested, (int, float)):
            temp = max(0.0, min(2.0, suggested))
    if intro_val is not None and len(intro_val) > 10000:
        intro_val = intro_val[:10000]
    if sp is not None and len(sp) > 10000:
        sp = sp[:10000]
    async with aiosqlite.connect(DB_PATH) as db:
        # 既存レコードの有無で分岐せず、常に全列をupsert（存在しない列はマイグレーション後に作成済み）
        await db.execute(
            """
            INSERT INTO session_settings (session_id, system_prompt, temperature, character_id, persona_id, world_id, intro, library_binding, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(session_id) DO UPDATE SET
                system_prompt=excluded.system_prompt,
                temperature=excluded.temperature,
                character_id=excluded.character_id,
                persona_id=excluded.persona_id,
                world_id=excluded.world_id,
                intro=excluded.intro,
                library_binding=excluded.library_binding,
                updated_at=datetime('now')
            """,
            (sid, sp or "", temp, char_id, per_id, w_id, intro_val or "", json.dumps(binding)),
        )
        await db.commit()


async def _load_settings(session_id: str) -> SessionSettings:
    """session_settings から取得、なければグローバル(__global__)→デフォルトをフォールバック"""
    await init_db()
    sid = session_id or "default"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        row = await (await db.execute(
            "SELECT * FROM session_settings WHERE session_id IN (?, '__global__') ORDER BY CASE WHEN session_id=? THEN 0 ELSE 1 END LIMIT 1",
            (sid, sid))).fetchone()
        if row:
            return SessionSettings(session_id=sid, library_binding=json.loads(row['library_binding']) if row['library_binding'] else None, **{k: row[k] for k in
                ("system_prompt", "temperature", "character_id", "persona_id", "world_id", "intro")})
    return SessionSettings(session_id=sid)


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
    except generations.Conflict as e:
        return JSONResponse(status_code=409, content={"error": str(e)})
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
        library_binding=body.library_binding,
        _has_binding='library_binding' in body.model_fields_set,
    )
    s = await _load_settings(body.session_id)
    return {"ok": True, **s.model_dump()}


@router.post("/chat/intro/inject")
async def inject_intro(session_id: str = "default"):
    """イントロを chat_history に初回アシスタントメッセージとして注入（重複防止）"""
    await init_db()
    s = await _load_settings(session_id)
    intro = s.intro or ""
    # キャラのデフォイントロをフォールバック
    if not intro and s.character_id:
        from python.core.prompt_compiler import _load_yaml, CHAR_DIR
        if s.library_binding and s.library_binding.character:
            from python.storage.library import get_item, character_info
            ref = s.library_binding.character
            char = character_info(get_item(ref.id, ref.revision))
        else:
            char = _load_yaml(CHAR_DIR, s.character_id)
        if char and char.get("intro"):
            intro = char["intro"].strip()
    if not intro:
        return JSONResponse(status_code=400, content={"error": "intro is empty (set session intro or character intro)"})
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('BEGIN IMMEDIATE')
        cur = await db.execute("SELECT COUNT(*) as c FROM chat_history WHERE session_id=?", (session_id,))
        row = await cur.fetchone()
        if row and row[0] > 0:
            # 既に履歴がある場合は先頭が同じintroでなければ追加しない（重複防止の簡易チェック）
            cur2 = await db.execute("SELECT content FROM chat_history WHERE session_id=? ORDER BY id ASC LIMIT 1", (session_id,))
            first = await cur2.fetchone()
            if first and first[0] == intro:
                return {"ok": True, "injected": False, "reason": "already injected"}
            return {'ok': True, 'injected': False, 'reason': 'conversation already started'}
        # history が空 or まだintroが未注入なら追加（モデルは intro）
        await db.execute("INSERT INTO chat_history (session_id, role, content, model_id) VALUES (?, ?, ?, ?)", (session_id, "assistant", intro, "intro"))
        await db.commit()
        return {"ok": True, "injected": True, "intro": intro}


async def prepare_generation(req: ChatRequest):
    cfg = next((m for m in load_yaml_registry() if m.get("id") == req.model_id), None)
    if cfg is None:
        raise ValueError("model not found")
    if not req.messages or req.messages[-1].role != "user":
        raise ValueError("last message must be a user message")
    await init_db()
    if req.regenerate_message_id:
        async with aiosqlite.connect(DB_PATH) as db:
            row = await (await db.execute("SELECT id,role FROM chat_history WHERE session_id=? ORDER BY id DESC LIMIT 1", (req.session_id,))).fetchone()
            if not row or row != (req.regenerate_message_id, "assistant"):
                raise ValueError("only the latest assistant can be regenerated")
    provider = get_provider_for_model(cfg)
    settings = await _load_settings(req.session_id)
    from python.core.prompt_compiler import _load_yaml, CHAR_DIR
    if not (settings.character_id or '').startswith('lib_') and (_load_yaml(CHAR_DIR, settings.character_id) or {}).get("nsfw") and not req.allow_nsfw:
        raise ValueError("NSFW execution requires allow_nsfw")
    compiled = compile_prompt(character_id=settings.character_id, persona_id=settings.persona_id,
        world_id=settings.world_id, extra_system_prompt=req.system_prompt if req.system_prompt is not None else settings.system_prompt,
        library_binding=settings.library_binding.model_dump() if settings.library_binding else None)
    if compiled.sections.get('portable_snapshot', {}).get('document', {}).get('nsfw') and not req.allow_nsfw:
        raise ValueError('NSFW execution requires allow_nsfw')
    requested = dict(cfg.get("recommended_generation") or {})
    requested.update(compiled.sections.get('generation_settings', {}))
    requested["temperature"] = req.temperature if req.temperature is not None else settings.temperature
    if req.seed is not None:
        requested["seed"] = req.seed
    replay = await generations.reserve(req.generation_id, req.session_id,
        req.model_dump(exclude={"stream", "generation_id"}))
    return cfg, provider, settings, compiled, requested, replay


async def run_chat(req, prepared):
    cfg, provider, settings, compiled, requested, replay = prepared
    if replay is not None:
        yield {"type": "result", "result": replay}
        return
    journal = []
    finished = False
    runtime_source = None
    try:
        state = await generations.load_state(req.session_id, settings.model_dump())
        if req.regenerate_message_id:
            state = await generations.state_before(req.session_id, req.regenerate_message_id, settings.model_dump())
        runtime_source = generate_events(provider, model=cfg["provider"]["model"],
                messages=[m.model_dump() for m in req.messages], compiled=compiled, state=state,
                requested=requested, generation_id=req.generation_id, journal=journal)
        async for event in runtime_source:
            if event["type"] == "result":
                event["result"]["replace_message_id"] = req.regenerate_message_id
                await generations.finish(req.generation_id, event["result"], req.messages[-1].model_dump(), req.model_id)
                finished = True
            yield event
    finally:
        if not finished:
            # Persist diagnostic output even when the SSE disconnect cancels its task group.
            import anyio
            with anyio.CancelScope(shield=True):
                if runtime_source is not None:
                    await runtime_source.aclose()
                await generations.finish(req.generation_id,
                    {"generation_id": req.generation_id, "status": "cancelled", "reply": "",
                     "error": "generation interrupted", "attempts": journal}, None, req.model_id)


@router.post("/chat")
async def chat_non_stream(req: ChatRequest):
    try:
        prepared = await prepare_generation(req)
    except generations.Conflict as exc:
        return JSONResponse(status_code=409, content={"error": str(exc)})
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    async for event in run_chat(req, prepared):
        if event["type"] == "result":
            result = event["result"]
            return JSONResponse(status_code=200 if result.get("reply") else 422, content=result)


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    try:
        prepared = await prepare_generation(req)
    except generations.Conflict as exc:
        return JSONResponse(status_code=409, content={"error": str(exc)})
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})

    async def stream():
        source = run_chat(req, prepared)
        try:
            yield {"event": "meta", "data": json.dumps({"generation_id": req.generation_id, "model_id": req.model_id})}
            async for event in source:
                kind = event["type"]
                if kind == "result":
                    result = event["result"]
                    if result.get("reply"):
                        payload = {k: v for k, v in result.items() if k not in {"attempts", "compiled", "raw_prompt"}}
                        yield {"event": "done", "data": json.dumps(payload, ensure_ascii=False)}
                    else:
                        yield {"event": "error", "data": json.dumps({"error": result.get("error") or "generation validation failed", "generation_id": req.generation_id})}
                else:
                    yield {"event": kind, "data": json.dumps(event, ensure_ascii=False)}
        finally:
            import anyio
            with anyio.CancelScope(shield=True):
                await source.aclose()
                await generations.cancel_pending(req.generation_id)
    return EventSourceResponse(stream(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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
    except generations.Conflict as e:
        return JSONResponse(status_code=409, content={"error": str(e)})
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
            await db.execute("BEGIN IMMEDIATE")
            cur = await db.execute("SELECT session_id FROM chat_history WHERE id=?", (msg_id,))
            row = await cur.fetchone()
            if not row:
                return JSONResponse(status_code=404, content={"error": "message not found"})
            await generations.invalidate(db, row[0], msg_id)
            await db.execute("UPDATE chat_history SET content=? WHERE id=?", (content, msg_id))
            await db.commit()
            return {"ok": True, "id": msg_id}
    except generations.Conflict as e:
        return JSONResponse(status_code=409, content={"error": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.delete("/chat/history/{msg_id}")
async def delete_history_message(msg_id: int):
    try:
        await init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("BEGIN IMMEDIATE")
            cur = await db.execute("SELECT session_id FROM chat_history WHERE id=?", (msg_id,))
            row = await cur.fetchone()
            if not row:
                return JSONResponse(status_code=404, content={"error": "message not found"})
            await generations.invalidate(db, row[0], msg_id)
            await db.execute("DELETE FROM chat_history WHERE id=?", (msg_id,))
            await db.commit()
            return {"ok": True, "id": msg_id}
    except generations.Conflict as e:
        return JSONResponse(status_code=409, content={"error": str(e)})
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
    except generations.Conflict as e:
        return JSONResponse(status_code=409, content={"error": str(e)})
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
            library_binding=s.library_binding.model_dump() if s.library_binding else None,
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
        state = await generations.load_state(session_id, s.model_dump())
        last = await generations.latest(session_id)
        return {"session_id": session_id, "settings": s.model_dump(),
            "compiled": last.get("compiled", compiled.model_dump()) if last else compiled.model_dump(),
            "history_count": history_count, "approx_turn": state.turn,
            "relationship": state.relationship, "state": state.model_dump(), "generation": last}
    except generations.Conflict as e:
        return JSONResponse(status_code=409, content={"error": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@router.delete("/chat/history")
async def clear_history(session_id: str | None = None):
    """履歴削除（session_id指定でその会話のみ、無指定で全削除）"""
    try:
        await init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("BEGIN IMMEDIATE")
            ids = [session_id] if session_id else [r[0] for r in await (await db.execute("SELECT session_id FROM runtime_states UNION SELECT session_id FROM chat_history")).fetchall()]
            for sid in ids:
                await generations.invalidate(db, sid)
            if session_id:
                await db.execute("DELETE FROM chat_history WHERE session_id=?", (session_id,))
            else:
                await db.execute("DELETE FROM chat_history")
            await db.commit()
            return {"ok": True}
    except generations.Conflict as e:
        return JSONResponse(status_code=409, content={"error": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
