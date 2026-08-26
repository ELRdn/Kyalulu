"""
FastAPI エントリポイント - 軽量ヘルスチェックのみ
Runtime Core は FastAPI に依存しない設計 (PROJECT_SPEC.md 8章)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="My Zeta Runtime API",
    version="0.1.0",
    description="Local-first Character AI Runtime API (Skeleton)",
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
    """ヘルスチェック - Provider接続前の疎通確認用"""
    return {"status": "ok", "version": "0.1.0", "runtime": "skeleton"}


@app.get("/api/providers")
async def list_providers():
    """Provider一覧 (スタブ)"""
    return {
        "providers": [
            {"id": "ollama", "type": "ollama", "status": "not_configured"},
            {"id": "lm_studio", "type": "lm_studio", "status": "not_configured"},
            {"id": "openai_compatible", "type": "openai_compatible", "status": "not_configured"},
        ]
    }
