"""npm's local-only server, with an authenticated owned-process shutdown."""

import hmac
import os
from fastapi import Request
from fastapi.responses import JSONResponse
import uvicorn
from python.api.main import app

server = None
token = os.environ.get("KYALULU_OWNER_TOKEN", "")


def authorized(request):
    return bool(token) and hmac.compare_digest(request.headers.get("x-kyalulu-owner", ""), token)


@app.get("/api/local/owner")
async def owner(request: Request):
    if not authorized(request):
        return JSONResponse({"error": "ownership_required"}, status_code=403)
    return {"pid": os.getpid(), "owned": True}


@app.post("/api/local/shutdown")
async def shutdown(request: Request):
    if not authorized(request):
        return JSONResponse({"error": "ownership_required"}, status_code=403)
    server.should_exit = True
    return {"ok": True}


# api.main mounts the static Web UI last. Keep lifecycle APIs before that mount.
paths = {"/api/local/owner", "/api/local/shutdown"}
app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", "") in paths] + [
    r for r in app.router.routes if getattr(r, "path", "") not in paths
]


def main():
    global server
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=int(os.environ.get("KYALULU_PORT", "8000")),
            access_log=False,
            log_level="warning",
        )
    )
    server.run()


if __name__ == "__main__":
    main()
