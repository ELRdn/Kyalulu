"""Catalog API — Character / Persona / World 一覧と Prompt Compile"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from python.core.prompt_compiler import compile_prompt, list_available, CHAR_DIR, PERSONA_DIR, WORLD_DIR
from python.core.schemas import CompiledPrompt
from python.core.portable_schema import LibraryBinding

router = APIRouter()

@router.get("/characters")
async def list_characters(include_nsfw: bool = False):
    try:
        chars = list_available(CHAR_DIR)
        from python.storage.db import init_db
        from python.storage.library import list_items, character_info
        await init_db()
        chars += [character_info(item) for item in list_items() if item.document.kind == 'character']
        if not include_nsfw:
            chars = [c for c in chars if not c.get("nsfw")]
        return {"characters": chars}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@router.get("/personas")
async def list_personas():
    try:
        return {"personas": list_available(PERSONA_DIR)}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@router.get("/worlds")
async def list_worlds():
    try:
        return {"worlds": list_available(WORLD_DIR)}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

class CompileRequest(BaseModel):
    character_id: str | None = None
    persona_id: str | None = None
    world_id: str | None = None
    extra_system_prompt: str | None = None
    library_binding: LibraryBinding | None = None

@router.post("/prompt/compile")
async def prompt_compile(req: CompileRequest):
    try:
        result: CompiledPrompt = compile_prompt(
            character_id=req.character_id,
            persona_id=req.persona_id,
            world_id=req.world_id,
            extra_system_prompt=req.extra_system_prompt,
            library_binding=req.library_binding.model_dump() if req.library_binding else None,
        )
        return result.model_dump()
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
