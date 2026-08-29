"""SQLite 初期化・マイグレーション (軽量版)"""

import aiosqlite
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "data.db"

# 初期DDL
DDL = """
CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    provider_model_id TEXT NOT NULL,
    quantization TEXT,
    context_length INTEGER,
    extra_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    base_url TEXT,
    last_health TEXT,
    last_ok INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


async def init_db() -> None:
    """DB初期化（存在しなければ作成）"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(DDL)
        await db.commit()


async def get_db():
    """依存注入用: async generator"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db
