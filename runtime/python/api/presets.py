"""Prompt Presets API - システムプロンプトのプリセット管理"""

import uuid
from typing import List
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import aiosqlite

from python.storage.db import DB_PATH, init_db

router = APIRouter()


class PresetIn(BaseModel):
    name: str
    content: str
    temperature: float = 0.8
    nsfw: bool = False
    nsfw_level: str | None = None


class PresetOut(BaseModel):
    id: str
    name: str
    content: str
    temperature: float
    created_at: str | None = None
    updated_at: str | None = None
    nsfw: bool = False
    nsfw_level: str | None = None


@router.get("/prompts/presets")
async def list_presets(include_nsfw: bool = False):
    await init_db()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if include_nsfw:
            cur = await db.execute("SELECT id, name, content, temperature, nsfw, nsfw_level, created_at, updated_at FROM prompt_presets ORDER BY updated_at DESC")
        else:
            cur = await db.execute("SELECT id, name, content, temperature, nsfw, nsfw_level, created_at, updated_at FROM prompt_presets WHERE COALESCE(nsfw,0)=0 ORDER BY updated_at DESC")
        rows = await cur.fetchall()
        # nsfwをboolに正規化
        out = []
        for r in rows:
            d = dict(r)
            d["nsfw"] = bool(d.get("nsfw"))
            out.append(d)
        return {"presets": out}


@router.post("/prompts/presets")
async def create_preset(body: PresetIn):
    await init_db()
    name = body.name.strip()
    content = body.content.strip()
    if not name:
        return JSONResponse(status_code=400, content={"error": "name is required"})
    if not content:
        return JSONResponse(status_code=400, content={"error": "content is required"})
    if len(content) > 10000:
        return JSONResponse(status_code=400, content={"error": "content too long (max 10000)"})
    if len(name) > 100:
        return JSONResponse(status_code=400, content={"error": "name too long (max 100)"})
    temp = max(0.0, min(2.0, body.temperature))
    pid = f"preset_{uuid.uuid4().hex[:8]}"
    nsfw_int = 1 if body.nsfw else 0
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO prompt_presets (id, name, content, temperature, nsfw, nsfw_level) VALUES (?, ?, ?, ?, ?, ?)",
                (pid, name, content, temp, nsfw_int, body.nsfw_level),
            )
            await db.commit()
            cur = await db.execute("SELECT id, name, content, temperature, nsfw, nsfw_level, created_at, updated_at FROM prompt_presets WHERE id=?", (pid,))
            row = await cur.fetchone()
            if row:
                db.row_factory = aiosqlite.Row
                cur2 = await db.execute("SELECT id, name, content, temperature, nsfw, nsfw_level, created_at, updated_at FROM prompt_presets WHERE id=?", (pid,))
                r = await cur2.fetchone()
                d = dict(r) if r else {"id": pid, "name": name, "content": content, "temperature": temp}
                d["nsfw"] = bool(d.get("nsfw"))
                return d
            return {"id": pid, "name": name, "content": content, "temperature": temp, "nsfw": body.nsfw, "nsfw_level": body.nsfw_level}
    except Exception as e:
        if "UNIQUE" in str(e):
            return JSONResponse(status_code=409, content={"error": f"preset name '{name}' already exists"})
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.put("/prompts/presets/{preset_id}")
async def update_preset(preset_id: str, body: PresetIn):
    await init_db()
    name = body.name.strip()
    content = body.content.strip()
    if not name or not content:
        return JSONResponse(status_code=400, content={"error": "name and content required"})
    temp = max(0.0, min(2.0, body.temperature))
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT id FROM prompt_presets WHERE id=?", (preset_id,))
        if not await cur.fetchone():
            return JSONResponse(status_code=404, content={"error": "preset not found"})
        try:
            await db.execute(
                "UPDATE prompt_presets SET name=?, content=?, temperature=?, nsfw=?, nsfw_level=?, updated_at=datetime('now') WHERE id=?",
                (name, content, temp, 1 if body.nsfw else 0, body.nsfw_level, preset_id),
            )
            await db.commit()
        except Exception as e:
            if "UNIQUE" in str(e):
                return JSONResponse(status_code=409, content={"error": f"preset name '{name}' already exists"})
            return JSONResponse(status_code=500, content={"error": str(e)})
        cur = await db.execute("SELECT id, name, content, temperature, nsfw, nsfw_level, created_at, updated_at FROM prompt_presets WHERE id=?", (preset_id,))
        row = await cur.fetchone()
        if row:
            d = dict(row)
            d["nsfw"] = bool(d.get("nsfw"))
            return d
        return {"ok": True}


@router.delete("/prompts/presets/{preset_id}")
async def delete_preset(preset_id: str):
    await init_db()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM prompt_presets WHERE id=?", (preset_id,))
        await db.commit()
        return {"ok": True}
