"""Provider health and metadata discovery, without generation calls."""
import asyncio
from fastapi import APIRouter
from python.providers.factory import get_provider

router = APIRouter()
TYPES = ("ollama", "lm_studio", "openai_compatible", "responses", "mock")


@router.get("/providers")
async def list_providers():
    return {"providers": [{"id": name, "type": name, "capabilities": get_provider(name).capabilities()} for name in TYPES]}


@router.get("/providers/health")
async def providers_health():
    async def check(name):
        try:
            async with asyncio.timeout(4):
                return {"id": name, **await get_provider(name).health_check()}
        except Exception:
            return {"id": name, "provider": name, "status": "offline"}
    return {"health": await asyncio.gather(*(check(name) for name in TYPES))}
