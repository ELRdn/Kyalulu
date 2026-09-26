"""Local Hub gateway; browser-only providers are never proxied."""
import asyncio
from urllib.parse import urlsplit
from fastapi import APIRouter, Request, Query
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from python.core.hubs import Hubs, SOURCES, provenance
from python.core.hub_schema import HubError, UrlImport, HubResults, HubItem, RemoteSource
from python.core.portable_formats import parse_import
from python.storage import library
from python.storage.db import init_db
from python.api.origins import trusted_origins

service = Hubs()
semaphore = asyncio.Semaphore(2)


def trusted_origin(request: Request):
    origins = trusted_origins()
    origin = request.headers.get('origin')
    if origin is not None and origin not in origins:
        raise HubError('untrusted_origin', 'この画面からのHubアクセスは許可されていません。', 403)
    if origin is None and (request.headers.get('sec-fetch-site') == 'cross-site' or
            urlsplit('http://' + request.headers.get('host', '')).hostname not in ('localhost', '127.0.0.1', '::1', 'testserver')):
        raise HubError('untrusted_origin', 'ローカルのKyaluluからアクセスしてください。', 403)


def failure(exc):
    headers = {'Retry-After': exc.retry_after} if exc.retry_after else {}
    return JSONResponse({'error': str(exc), 'code': exc.code}, status_code=exc.status, headers=headers)


class HubRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()
        async def route(request):
            try:
                trusted_origin(request)
                await init_db()
                async with asyncio.timeout(90), semaphore:
                    task = asyncio.create_task(handler(request))
                    try:
                        while not task.done():
                            await asyncio.wait({task}, timeout=.2)
                            # Do not consume ASGI request bodies while the handler reads them.
                            if (request.method == 'GET' or getattr(request, '_body', None) is not None) and await request.is_disconnected():
                                raise asyncio.CancelledError()
                        return await task
                    finally:
                        if not task.done():
                            task.cancel()
                            await asyncio.gather(task, return_exceptions=True)
            except HubError as exc:
                return failure(exc)
            except TimeoutError:
                return failure(HubError('timeout', '取得がタイムアウトしました。', 504))
            except ValueError as exc:
                return JSONResponse({'error': str(exc), 'code': 'invalid_input'}, status_code=400)
        return route


router = APIRouter(route_class=HubRoute)


def imported(item):
    item.imported_ids = [i.id for i in library.list_items() if
        i.document.source.get('remote', {}).get('source') == item.source and
        i.document.source.get('remote', {}).get('source_id') == item.id]
    return item


@router.get('/hubs/sources')
async def sources():
    return {'sources': SOURCES}


@router.get('/hubs/{source}/items', response_model=HubResults)
async def items(source: str, q: str = Query('', max_length=200), page: int = Query(1, ge=1, le=10000)):
    result = await service.items(source, q, page)
    result.items = [imported(item) for item in result.items]
    return result


@router.get('/hubs/{source}/items/{item_id}', response_model=HubItem)
async def detail(source: str, item_id: str):
    return imported(await service.detail(source, item_id))


@router.post('/imports/url/resolve', response_model=RemoteSource)
async def resolve(body: UrlImport):
    return await service.resolve(body)


def remote_preview(resolved, raw):
    documents, assets = parse_import(resolved.filename, raw)
    for index, doc in enumerate(documents):
        info = provenance(resolved, raw)
        info['document_index'] = index
        if not info['author']:
            creator = doc.data.get('creator')
            info['author'] = creator if isinstance(creator, str) else None
        if not info['license']:
            extensions = doc.data.get('extensions') or {}
            risu = extensions.get('risuai') or {} if isinstance(extensions, dict) else {}
            license_text = doc.data.get('license') or (risu.get('license') if isinstance(risu, dict) else None)
            info['license'] = license_text if isinstance(license_text, str) else None
        if doc.nsfw:
            info['content_rating'] = 'nsfw'
        doc.source['remote'] = info
        if info['content_rating'] == 'nsfw':
            doc.nsfw = True
    return library.preview(resolved.filename, raw, documents, assets)


@router.post('/imports/url/preview')
async def preview(body: UrlImport):
    resolved = await service.resolve(body)
    raw = await service.download(resolved)
    return remote_preview(resolved, raw)


@router.get('/imports/{preview_id}')
async def get_preview(preview_id: str):
    return library.get_preview(preview_id)
