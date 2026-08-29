"""
FastAPI エントリポイント
Runtime Core は FastAPI に依存しない設計 (PROJECT_SPEC.md 8章)
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from python.storage.db import init_db
from python.core.registry import load_yaml_registry, sync_to_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 起動時にDB初期化 + YAML→DB同期
    await init_db()
    try:
        models = load_yaml_registry()
        await sync_to_db(models)
    except Exception as e:
        print(f"[lifespan] registry sync failed: {e}")
    yield


app = FastAPI(
    title="My Zeta Runtime API",
    version="0.1.0",
    description="Local-first Character AI Runtime API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0", "runtime": "0.1.0-milestone2"}


# ルーター登録
from python.api.chat import router as chat_router
from python.api.providers import router as providers_router

app.include_router(chat_router, prefix="/api")
app.include_router(providers_router, prefix="/api")
