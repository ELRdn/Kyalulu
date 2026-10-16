"""Model Registry - YAML(正) + SQLite(キャッシュ) の両方対応"""

from python.storage.context import get_db_path
import asyncio
from pathlib import Path
import yaml
import json
import aiosqlite
from typing import Any

from python.storage.db import DB_PATH

MODELS_DIR = Path(__file__).resolve().parents[3] / "models"


def load_yaml_registry() -> list[dict[str, Any]]:
    """models/*.yaml を読み込み"""
    if not MODELS_DIR.exists():
        return []
    result = []
    import os
    custom = Path(os.environ["KYALULU_MODELS_DIR"]) if os.getenv("KYALULU_MODELS_DIR") else DB_PATH.parent / "models"
    files = {p.name: p for p in MODELS_DIR.glob("*.yaml")}
    if custom.resolve() != MODELS_DIR.resolve():
        files.update({p.name: p for p in custom.glob("*.yaml")})
    for p in sorted(files.values()):
        try:
            data = yaml.safe_load(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                result.append(data)
            elif isinstance(data, list):
                result.extend(data)
        except Exception as e:
            print(f"[registry] Failed to load {p}: {e}")
    return result


LE_PREFIX = "le:"


def le_model_entry(le_id: str) -> dict[str, Any]:
    """Registry entry for a model LE serves, addressed as ``le:<LE model id>``.

    LE passes ``response_format`` through to llama-server / Ollama / LM Studio, all of which honor
    a JSON schema, so the structured reply + state contract is enforced on this path too."""
    return {"id": LE_PREFIX + le_id, "display_name": f"{le_id} (LE)",
            "provider": {"type": "le", "model": le_id, "structured_output": True}}


def find_model(model_id: str | None) -> dict[str, Any] | None:
    """models/*.yaml first; ``le:<id>`` falls through to LE, which validates the id itself."""
    cfg = next((m for m in load_yaml_registry() if m.get("id") == model_id), None)
    if cfg is None and model_id and model_id.startswith(LE_PREFIX) and len(model_id) > len(LE_PREFIX):
        cfg = le_model_entry(model_id[len(LE_PREFIX):])
    if cfg is None and model_id:
        for prefix, provider in (("ollama:", "ollama"), ("lmstudio:", "lm_studio")):
            if model_id.startswith(prefix) and len(model_id) > len(prefix):
                cfg = {"id": model_id, "display_name": model_id, "provider": {"type": provider, "model": model_id[len(prefix):], "structured_output": True}}
    return cfg


async def list_local_models():
    from python.providers.factory import get_provider
    async def discover(kind, prefix):
        try:
            async with asyncio.timeout(3):
                models = await get_provider(kind).list_models()
                return [{"id": prefix+m["id"], "display_name": m.get("display_name", m["id"]),
                         "provider": {"type": kind, "model": m["id"], "structured_output": True}} for m in models]
        except Exception:
            return []
    results = await asyncio.gather(discover("ollama", "ollama:"), discover("lm_studio", "lmstudio:"))
    return [m for result in results for m in result]


async def list_le_models() -> list[dict[str, Any]]:
    """Models LE currently serves; empty when LE is not running or not authorised."""
    from python.providers.le import LEProvider
    le = LEProvider()
    if not le.api_key:
        return []
    try:
        async with asyncio.timeout(3):
            return [le_model_entry(i) for i in await le.served_models()]
    except Exception:
        return []


async def sync_to_db(models: list[dict[str, Any]]) -> None:
    """YAMLの内容をSQLiteへ同期 (upsert)"""
    if not models:
        return
    # init_db 済み前提だが念のためDDL実行
    from python.storage.db import DDL
    async with aiosqlite.connect(get_db_path(DB_PATH)) as db:
        await db.executescript(DDL)
        for m in models:
            await db.execute(
                """
                INSERT INTO models (id, display_name, provider_type, provider_model_id, quantization, context_length, extra_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    display_name=excluded.display_name,
                    provider_type=excluded.provider_type,
                    provider_model_id=excluded.provider_model_id,
                    quantization=excluded.quantization,
                    context_length=excluded.context_length,
                    extra_json=excluded.extra_json
                """,
                (
                    m.get("id"),
                    m.get("display_name", m.get("id")),
                    m.get("provider", {}).get("type", "unknown") if isinstance(m.get("provider"), dict) else m.get("provider_type", "unknown"),
                    m.get("provider", {}).get("model", m.get("provider_model_id", m.get("id"))) if isinstance(m.get("provider"), dict) else m.get("provider_model_id", m.get("id")),
                    m.get("quantization"),
                    m.get("context_length"),
                    json.dumps(m, ensure_ascii=False),
                ),
            )
        await db.commit()


async def list_models_from_db() -> list[dict[str, Any]]:
    """SQLiteから一覧取得、なければYAMLから"""
    try:
        async with aiosqlite.connect(get_db_path(DB_PATH)) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute("SELECT extra_json FROM models")
            rows = await cur.fetchall()
            if rows:
                return [json.loads(r["extra_json"]) for r in rows]
    except Exception:
        pass
    # フォールバック: YAML直接
    return load_yaml_registry()
