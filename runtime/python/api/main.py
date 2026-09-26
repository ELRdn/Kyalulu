"""
FastAPI エントリポイント
Runtime Core は FastAPI に依存しない設計 (PROJECT_SPEC.md 8章)
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from python.storage.db import init_db
from python.core.registry import load_yaml_registry, sync_to_db
from python.api.origins import trusted_origins


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 起動時にDB初期化 + YAML→DB同期
    await init_db()
    from python.storage.generations import recover_interrupted
    await recover_interrupted()
    try:
        models = load_yaml_registry()
        await sync_to_db(models)
    except Exception as e:
        print(f"[lifespan] registry sync failed: {e}")
    from python.core.benchmark import recover_jobs
    recover_jobs()
    try:
        yield
    finally:
        from python.api.benchmarks import shutdown
        await shutdown()


app = FastAPI(
    title="Kyalulu Runtime API",
    version="0.1.0",
    description="Local-first Character AI Runtime API",
    lifespan=lifespan,
)


@app.exception_handler(ValueError)
async def invalid_input(_request, exc):
    from python.storage.library import LibraryConflict
    return JSONResponse({'error': str(exc)}, status_code=409 if isinstance(exc, LibraryConflict) else 400)

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(trusted_origins()),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_trusted_browser(request, call_next):
    origin = request.headers.get("origin")
    if request.url.path.startswith("/api/") and (
        (origin is not None and origin not in trusted_origins()) or
        (origin is None and request.headers.get("sec-fetch-site") == "cross-site")
    ):
        return JSONResponse({"error": "この画面からのAPIアクセスは許可されていません。", "code": "untrusted_origin"}, status_code=403)
    return await call_next(request)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0", "runtime": "0.1.0-m7"}


# ルーター登録
from python.api.chat import router as chat_router
from python.api.providers import router as providers_router
from python.api.presets import router as presets_router
from python.api.catalog import router as catalog_router
from python.api.experiments import router as experiments_router
from python.api.library import router as library_router
from python.api.hubs import router as hubs_router
from python.api.le import router as le_router
from python.api.commands import router as commands_router
from python.api.diagnostics import router as diagnostics_router
from python.api.memory import router as memory_router
from python.api.creator import router as creator_router
from python.api.benchmarks import router as benchmarks_router

app.include_router(chat_router, prefix="/api")
app.include_router(providers_router, prefix="/api")
app.include_router(presets_router, prefix="/api")
app.include_router(catalog_router, prefix="/api")
app.include_router(experiments_router, prefix="/api")
app.include_router(library_router, prefix="/api")
app.include_router(hubs_router, prefix="/api")
app.include_router(le_router, prefix="/api")
app.include_router(commands_router, prefix="/api")
app.include_router(diagnostics_router, prefix="/api")
app.include_router(memory_router, prefix="/api")
app.include_router(creator_router, prefix="/api")
app.include_router(benchmarks_router, prefix="/api")
