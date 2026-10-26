"""Loopback-only UI fixture server. No accounts, payments or provider connections."""
import json
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / '.artifacts/unified-app'
CATALOG = json.loads((ROOT / 'apps/web/src/mobile/app-catalog.generated.json').read_text(encoding='utf-8'))
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware('http')
async def loopback_only(request: Request, call_next):
    if request.client.host not in {'127.0.0.1', '::1'}:
        return JSONResponse({'error': 'loopback_only'}, status_code=403)
    if request.method not in {'GET', 'HEAD'} and request.headers.get('origin') != str(request.base_url).rstrip('/'):
        return JSONResponse({'error': 'same_origin_required'}, status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    if request.url.path.startswith('/device/'):
        response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
        response.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
    return response


@app.post('/api/cloud/app/eligibility')
async def eligibility(request: Request):
    body = await request.json()
    if body.get('country') not in {'JP', 'US'} or type(body.get('age')) is not int or not 18 <= body['age'] <= 120:
        return JSONResponse({'error': 'preview_region_or_age_not_enabled'}, status_code=403)
    return {'country': body['country'], 'age_band': 'adult', 'policy': 'LOCAL-FIXTURE-NOT-LEGAL-APPROVAL',
            'ticket': 'LOCAL-FIXTURE-NOT-AUTHORIZATION'}


@app.get('/api/mobile/status')
async def status():
    return {'cloud_mode': True, 'remote_mode': False, 'authenticated': False, 'administrative': False}


@app.get('/api/characters')
async def characters():
    return {'characters': [{**c, 'portrait_url': '/icons/rei-senpai.png' if c['id'] == 'senior_cool' else
                           '/icons/shion-butler-1.png' if c['id'] == 'butler' else '/icons/mocha-1.png' if c['id'] == 'mocha_sfw' else None}
                           for c in CATALOG['characters'] if not c.get('nsfw')]}


@app.get('/api/worlds')
async def worlds():
    return {'worlds': CATALOG['worlds']}


@app.get('/api/capabilities')
async def capabilities():
    from python.api.capabilities import capabilities as value
    return value(cloud=True, community=False, media=False)


@app.get('/{path:path}')
async def file(path: str):
    if path.startswith('api/'):
        return JSONResponse({'error': 'preview_connector_disabled'}, status_code=503)
    if path in {'device', 'device/'}:
        path = 'device/index.html'
    candidate = (DIST / path).resolve()
    if candidate.is_relative_to(DIST) and candidate.is_file():
        return FileResponse(candidate)
    if path and Path(path).suffix:
        return JSONResponse({'error': 'not_found'}, status_code=404)
    return FileResponse(DIST / 'index.html')


if __name__ == '__main__':
    import sys
    import uvicorn
    sys.path.insert(0, str(ROOT / 'runtime'))
    if not (DIST / 'device/index.html').is_file():
        raise SystemExit('Run pnpm --filter web build:app first')
    uvicorn.run(app, host='127.0.0.1', port=5187)
