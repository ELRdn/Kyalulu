"""Execution capabilities describe implemented operations, not release acceptance."""
from fastapi import APIRouter

router = APIRouter()


def capabilities(*, cloud=False, community=False, media=False):
    return {
        "schema_version": 1, "mode": "cloud" if cloud else "local",
        "features": {"regenerate": True, "suggestions": not cloud,
            "stored_context": True, "progress": cloud, "branch": True,
            "permanent_delete": True, "summaries": True, "world_memory": True,
            "story_rules": True, "community": community,
            "media_playback": media or not cloud, "media_generation": False},
        "model_selection": "cloud-routes" if cloud else "local",
    }


@router.get("/capabilities")
async def local_capabilities():
    return capabilities()
