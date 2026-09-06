"""SQLite 初期化・マイグレーション (軽量版)"""

import aiosqlite
import os
from pathlib import Path

DB_PATH = Path(os.environ.get("KYALULU_DATA_DIR", str(Path(__file__).resolve().parents[2]))) / "data.db"

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

CREATE TABLE IF NOT EXISTS session_settings (
    session_id TEXT PRIMARY KEY,
    system_prompt TEXT NOT NULL DEFAULT '',
    temperature REAL NOT NULL DEFAULT 0.8,
    extra_json TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    temperature REAL NOT NULL DEFAULT 0.8,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id TEXT NOT NULL,
    turn INTEGER NOT NULL,
    score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
    comment TEXT NOT NULL DEFAULT '',
    rater TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(experiment_id, turn)
);

CREATE TABLE IF NOT EXISTS runtime_states (
    session_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generations (
    generation_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT,
    user_id INTEGER,
    assistant_id INTEGER,
    valid INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_generation
ON generations(session_id) WHERE status = 'pending';
"""


# M3/M6/M7 マイグレーション
MIGRATIONS = [
    "ALTER TABLE session_settings ADD COLUMN character_id TEXT",
    "ALTER TABLE session_settings ADD COLUMN persona_id TEXT",
    "ALTER TABLE session_settings ADD COLUMN world_id TEXT",
    "ALTER TABLE prompt_presets ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE prompt_presets ADD COLUMN nsfw_level TEXT",
    "ALTER TABLE session_settings ADD COLUMN intro TEXT NOT NULL DEFAULT ''",
]


async def init_db() -> None:
    """DB初期化（存在しなければ作成）+ 軽量マイグレーション"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(DDL)
        await db.commit()
        # マイグレーション（列が無ければ追加、あれば無視）
        for sql in MIGRATIONS:
            try:
                await db.execute(sql)
            except aiosqlite.OperationalError as exc:
                if "duplicate column name" not in str(exc).lower():
                    raise
        await db.commit()


async def get_db():
    """依存注入用: async generator"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db
