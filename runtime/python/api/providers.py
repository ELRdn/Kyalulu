"""Provider health and metadata discovery, without generation calls."""
import asyncio
import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from python.providers.factory import get_provider
from python.providers.le import LEProvider

router = APIRouter()
TYPES = ("le", "ollama", "lm_studio", "openai_compatible", "responses", "mock")


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


@router.get("/le/capabilities")
async def le_capabilities():
    """Renderer never holds the LE token; the API relays LE's capability report."""
    le = LEProvider()
    try:
        async with asyncio.timeout(8):
            return {"version": await le.le_version(), "capabilities": await le.le_capabilities()}
    except (httpx.HTTPError, TimeoutError, ValueError) as e:
        return JSONResponse({"error": f"LE unavailable: {type(e).__name__}"}, status_code=503)
