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
    from python.storage import db
    from python.storage.runtime_lock import RuntimeLock

    # Acquire before recovery: a second process must never mark live work interrupted.
    with RuntimeLock(db.DB_PATH.parent):
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

# Security wraps CORS and all routes, including future APIs and static responses.
from python.api.mobile import Config, Devices, MobileSecurity, WebDist, router as mobile_router

app.state.mobile_config = Config.from_env()
app.state.mobile_devices = Devices()
app.include_router(mobile_router, prefix="/api")
from python.remote.management import router as remote_management_router
app.include_router(remote_management_router, prefix="/api")
if app.state.mobile_config.web_dist:
    app.mount("/", WebDist(directory=str(app.state.mobile_config.web_dist), html=True), name="web")
app.add_middleware(MobileSecurity, config=app.state.mobile_config, devices=app.state.mobile_devices)
