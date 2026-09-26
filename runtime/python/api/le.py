"""Relay of LE's management API (/le/v1/*).

The renderer never holds the LE token: it talks to Kyalulu, and Kyalulu
forwards a fixed set of LE routes with the token attached. LE's own status
codes and structured errors are passed through unchanged.
"""
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from python.providers.le import LEProvider

router = APIRouter(prefix="/le")
FORWARD_HEADERS = ("idempotency-key", "last-event-id", "content-type")


def _unavailable(msg: str) -> JSONResponse:
    return JSONResponse({"error": {"code": "le_unavailable", "message": msg}}, status_code=503)


def _headers(request: Request) -> dict:
    return {k: v for k in FORWARD_HEADERS if (v := request.headers.get(k))}


def _check_id(value: str) -> str | None:
    return None if not value or ".." in value.split("/") else value


async def _relay(request: Request, method: str, path: str) -> Response:
    le = LEProvider()
    if not le.api_key:
        return _unavailable("LE token not found")
    body = await request.body() if method in ("POST", "PUT") else None
    try:
        async with le._client() as c:
            r = await c.request(method, f"{le.root_url}/le/v1/{path}", params=request.query_params,
                                content=body, headers=_headers(request))
    except httpx.HTTPError as e:
        return _unavailable(f"LE unavailable: {type(e).__name__}")
    return Response(r.content, status_code=r.status_code, media_type=r.headers.get("content-type"))


@router.get("/hardware")
async def hardware(request: Request):
    return await _relay(request, "GET", "hardware")


@router.get("/hardware/gpus")
async def hardware_gpus(request: Request):
    return await _relay(request, "GET", "hardware/gpus")


@router.get("/resources")
async def resources(request: Request):
    return await _relay(request, "GET", "resources")


@router.get("/engine/devices")
async def engine_devices(request: Request):
    return await _relay(request, "GET", "engine/devices")


@router.post("/models/plan")
async def plan(request: Request):
    return await _relay(request, "POST", "models/plan")


@router.get("/models")
async def models(request: Request):
    return await _relay(request, "GET", "models")


@router.post("/models/download")
async def download(request: Request):
    return await _relay(request, "POST", "models/download")


@router.post("/models/load")
async def load(request: Request):
    return await _relay(request, "POST", "models/load")


@router.post("/models/unload")
async def unload(request: Request):
    return await _relay(request, "POST", "models/unload")


@router.api_route("/models/{model_id:path}", methods=["GET", "DELETE"])
async def model(model_id: str, request: Request):
    if not _check_id(model_id):
        return JSONResponse({"error": {"code": "invalid_request", "message": "invalid model id"}}, status_code=400)
    return await _relay(request, request.method, f"models/{model_id}")


@router.get("/jobs")
async def jobs(request: Request):
    return await _relay(request, "GET", "jobs")


@router.api_route("/jobs/{job_id}", methods=["GET", "DELETE"])
async def job(job_id: str, request: Request):
    return await _relay(request, request.method, f"jobs/{job_id}")


@router.get("/events")
async def events(request: Request):
    """SSE passthrough; supports ?since= and Last-Event-ID replay."""
    le = LEProvider(timeout=httpx.Timeout(10.0, read=None))
    if not le.api_key:
        return _unavailable("LE token not found")
    client = le._client()
    try:
        req = client.build_request("GET", f"{le.root_url}/le/v1/events", params=request.query_params,
                                   headers=_headers(request))
        resp = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        return _unavailable(f"LE unavailable: {type(e).__name__}")
    if resp.status_code != 200:
        content = await resp.aread()
        await resp.aclose()
        await client.aclose()
        return Response(content, status_code=resp.status_code, media_type=resp.headers.get("content-type"))

    async def stream():
        try:
            async for chunk in resp.aiter_bytes():
                yield chunk
        except httpx.HTTPError:
            pass
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"cache-control": "no-cache"})
