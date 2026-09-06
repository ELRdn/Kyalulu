"""Two-phase local imports and versioned library editing/export."""
from urllib.parse import quote
from fastapi import APIRouter, UploadFile, File
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from python.core.portable_schema import PortableDocument, ImportCommit
from python.storage import library
from python.storage.db import init_db


class LibraryRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()
        async def route(request):
            await init_db()
            try:
                return await handler(request)
            except library.LibraryConflict as exc:
                return JSONResponse({'error': str(exc)}, status_code=409)
            except ValueError as exc:
                return JSONResponse({'error': str(exc)}, status_code=400)
        return route


router = APIRouter(route_class=LibraryRoute)


@router.post('/imports/preview')
async def preview_file(file: UploadFile = File(...)):
    from python.core.portable_formats import parse_import
    raw = await file.read(32 * 1024 * 1024 + 1)
    if len(raw) > 32 * 1024 * 1024:
        raise ValueError('File exceeds 32 MiB')
    docs, assets = parse_import(file.filename or 'import', raw)
    return library.preview(file.filename or 'import', raw, docs, assets)


class TextImport(BaseModel):
    text: str = Field(max_length=2_000_000)
    filename: str = 'character.txt'


@router.post('/imports/text/preview')
async def preview_text(body: TextImport):
    from python.core.portable_formats import parse_import
    raw = body.text.encode('utf-8')
    docs, assets = parse_import(body.filename, raw)
    return library.preview(body.filename, raw, docs, assets)


@router.post('/imports/{preview_id}/commit')
async def commit_import(preview_id: str, body: ImportCommit):
    return library.commit(preview_id, body)


@router.get('/library')
async def list_library(include_nsfw: bool = False):
    return {'items': [i.model_dump() for i in library.list_items() if include_nsfw or not i.document.nsfw]}


@router.post('/library')
async def create_document(body: PortableDocument):
    return library.save_item(body).model_dump()


def require_item(item_id, revision=None):
    item = library.get_item(item_id, revision)
    if not item:
        raise ValueError('library item or revision not found')
    return item


@router.get('/library/assets/{asset_id}')
async def asset(asset_id: str):
    raw, mime = library.read_asset(asset_id)
    # Import adapters accept only inert image types; never serve HTML/SVG/scripts inline.
    if mime not in {'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/apng'}:
        mime = 'application/octet-stream'
    return Response(raw, media_type=mime, headers={'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable'})


@router.post('/library/assets')
async def upload_asset(file: UploadFile = File(...)):
    from python.core.portable_assets import accept_image
    raw = await file.read(16 * 1024 * 1024 + 1)
    asset_id, mime = accept_image(raw)
    library.store_assets({asset_id: (raw, mime)})
    return {'asset_id': asset_id, 'media_type': mime, 'uri': '', 'name': file.filename or 'image', 'type': 'icon'}


@router.get('/library/{item_id}')
async def get_document(item_id: str, revision: int | None = None):
    return require_item(item_id, revision).model_dump()


class EditDocument(BaseModel):
    expected_revision: int = Field(ge=1)
    document: PortableDocument


@router.put('/library/{item_id}')
async def edit_document(item_id: str, body: EditDocument):
    return library.save_item(body.document, item_id, body.expected_revision).model_dump()


@router.get('/library/{item_id}/export')
async def export_document(item_id: str, format: str = 'ccv3-json', revision: int | None = None, download: bool = False):
    from python.core.portable_export import export_document
    item = require_item(item_id, revision)
    if format == 'original':
        name, raw = library.original(item.original_id)
        mime, notices = 'application/octet-stream', []
    else:
        raw, mime, name, notices = export_document(item.document, format, library.document_assets(item.document))
    if not download:
        return {'filename': name, 'media_type': mime, 'bytes': len(raw), 'notices': notices}
    return Response(raw, media_type=mime, headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote(name, safe=''), 'X-Content-Type-Options': 'nosniff'})
