"""Model Registry - YAML(正) + SQLite(キャッシュ) の両方対応"""

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
    for p in sorted(MODELS_DIR.glob("*.yaml")):
        try:
            data = yaml.safe_load(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                result.append(data)
            elif isinstance(data, list):
                result.extend(data)
        except Exception as e:
            print(f"[registry] Failed to load {p}: {e}")
    return result


async def sync_to_db(models: list[dict[str, Any]]) -> None:
    """YAMLの内容をSQLiteへ同期 (upsert)"""
    if not models:
        return
    # init_db 済み前提だが念のためDDL実行
    from python.storage.db import DDL
    async with aiosqlite.connect(DB_PATH) as db:
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
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute("SELECT extra_json FROM models")
            rows = await cur.fetchall()
            if rows:
                return [json.loads(r["extra_json"]) for r in rows]
    except Exception:
        pass
    # フォールバック: YAML直接
    return load_yaml_registry()
