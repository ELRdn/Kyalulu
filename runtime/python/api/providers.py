"""Providers Health API"""

from fastapi import APIRouter
from python.providers.factory import get_provider
from python.core.config import settings

router = APIRouter()


@router.get("/providers")
async def list_providers():
    providers = [
        {"id": "ollama", "type": "ollama", "base_url": settings.ollama_url},
        {"id": "lm_studio", "type": "lm_studio", "base_url": settings.lm_studio_url},
        {"id": "openai_compatible", "type": "openai_compatible", "base_url": settings.openai_compatible_url or "(未設定)"},
        {"id": "mock", "type": "mock", "base_url": "internal"},
    ]
    return {"providers": providers}


@router.get("/providers/health")
async def providers_health():
    """全Providerのヘルスチェック"""
    results = []
    for ptype, url in [
        ("ollama", settings.ollama_url),
        ("lm_studio", settings.lm_studio_url),
        ("openai_compatible", settings.openai_compatible_url),
        ("mock", None),
    ]:
        prov = get_provider(ptype, base_url=url) if url else get_provider(ptype)
        try:
            h = await prov.health_check()
        except Exception as e:
            h = {"status": "error", "provider": ptype, "error": str(e)}
        h["id"] = ptype
        results.append(h)
    return {"health": results}
