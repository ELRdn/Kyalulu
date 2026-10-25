"""PC-only enrollment; neither LAN clients nor Relay principals receive credentials."""
import asyncio
import json
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Request, Query
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from python.api.mobile import local_admin
from python.storage import db as storage
from python.storage.context import CURRENT_STORAGE
from python.storage.native_sync import NativeSync
from python.cloud.store import CloudError

lock=asyncio.Lock()
active=None
last={'phase':'off','error':''}
suspended=None


class LocalRoute(APIRoute):
    def get_route_handler(self):
        handler=super().get_route_handler()
        async def run(request):
            if not local_admin(request) or CURRENT_STORAGE.get() is not None:
                return JSONResponse({'error':'configure_sync_on_the_pc'},status_code=403)
            try:return await handler(request)
            except CloudError as exc:return JSONResponse({'error':exc.code},status_code=exc.status)
            except httpx.HTTPError:return JSONResponse({'error':'sync_connection_failed'},status_code=503)
            except sqlite3.Error:return JSONResponse({'error':'sync_device_storage_failed'},status_code=507)
            except (ValueError,TypeError,KeyError):return JSONResponse({'error':'invalid_sync_settings'},status_code=400)
        return run


router=APIRouter(prefix='/local/app-sync',route_class=LocalRoute)


def origin():
    value=os.environ.get('KYALULU_UNIFIED_CLOUD_ORIGIN','https://app.kyalulu.com');parsed=urlsplit(value)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or value!='https://'+parsed.netloc:raise ValueError('Invalid unified Cloud origin')
    return value


def path():return storage.DB_PATH.parent/'app-sync.json'


def config():
    try:value=json.loads(path().read_text(encoding='utf-8'))
    except (FileNotFoundError,ValueError):return None
    if not isinstance(value,dict) or value.get('origin')!=origin():return None
    try:
        check=NativeSync(storage.DB_PATH,origin(),value.get('owner'),value['token'])
        if not check.owner:return None
    except (ValueError,TypeError,KeyError):return None
    return value


def save(value):
    path().parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=path().parent,prefix='.app-sync-',delete=False) as file:
        temporary=Path(file.name)
        json.dump(value,file)
    try:temporary.replace(path())
    finally:temporary.unlink(missing_ok=True)


def service(app,value=None):
    value=config() if value is None else value
    if not value:return None
    return NativeSync(storage.DB_PATH,origin(),value.get('owner'),value['token'],transport=getattr(app.state,'native_sync_transport',None))


def choices(namespace):
    with closing(sqlite3.connect(storage.DB_PATH)) as db:
        claims=dict(db.execute('SELECT session_id,namespace FROM unified_native_owners')) if db.execute("SELECT 1 FROM sqlite_master WHERE name='unified_native_owners'").fetchone() else {}
        rows=db.execute("SELECT h.session_id,COUNT(*),MAX(h.created_at),(SELECT SUBSTR(content,1,100) FROM chat_history tail WHERE tail.session_id=h.session_id ORDER BY id DESC LIMIT 1) FROM chat_history h WHERE SUBSTR(h.session_id,1,2)!='__' AND h.session_id NOT IN(SELECT session_id FROM session_deletions) GROUP BY h.session_id ORDER BY MAX(h.created_at) DESC LIMIT 1000").fetchall()
    return [{'id':r[0],'count':r[1],'updated':r[2],'preview':r[3]} for r in rows if r[0] and not r[0].startswith('__') and (r[0] not in claims or claims[r[0]]==namespace)]


@router.get('')
async def settings(request:Request):
    value=config();sync=service(request.app,value) if value else None
    status=sync.status() if sync else {'enabled':False,'selected':[],'pending':False,'cursor':0}
    return {**status,'connected':sync is not None,'origin':origin(),'owner':sync.owner if sync else '',
            'device_id':value.get('device_id','') if value else '', 'sessions':choices(sync.namespace if sync else None),
            'phase':last['phase'] if sync else 'off','error':last['error'] if sync else ''}


async def body(request):
    raw=bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw)>256_000:raise CloudError('sync_settings_too_large',413)
    value=json.loads(raw)
    if not isinstance(value,dict):raise CloudError('invalid_sync_settings')
    return value


async def stop_active():
    task=active
    if task and not task.done():
        task.cancel();await asyncio.gather(task,return_exceptions=True)


@router.put('')
async def configure(request:Request):
    global last,suspended
    value=await body(request)
    if set(value)-{'enabled','selected','consent','token','replace_account','expected_owner','restore_confirmations'}:raise CloudError('invalid_sync_settings')
    await stop_active()
    async with lock:
        before=config();old=service(request.app,before) if before else None
        if value.get('expected_owner')!=(old.owner if old else ''):raise CloudError('sync_account_changed',403)
        if value.get('token'):
            candidate={'origin':origin(),'owner':None,'token':value['token']}
            sync=service(request.app,candidate);identity=await sync.verify()
            candidate.update(owner=sync.owner,device_id=identity['device_id'])
        elif old:sync=old;candidate=before
        else:raise CloudError('entity_sync_token_required',403)
        if old and old.owner!=sync.owner:
            if value.get('replace_account') is not True:raise CloudError('sync_account_switch_confirmation_required',409)
            old.configure(old.status()['selected'],False)
        if value.get('enabled') is True and not value.get('token'):await sync.verify()
        if value.get('restore_confirmations'):
            with sync.transaction(allow_generation=True) as db:
                expected={sid:token for sid,token in sync.restores(db).items() if sid in value.get('selected',[])}
                if expected and value['restore_confirmations']!=expected:raise CloudError('sync_restored_session_confirmation_required',409)
            if expected:await sync.settle_withdrawn()
        sync.configure(value.get('selected',[]),value.get('enabled'),consent=value.get('consent') is True,restore_confirmations=value.get('restore_confirmations'))
        save(candidate);suspended=None;last={'phase':'idle' if value['enabled'] else 'off','error':''}
        if not value['enabled']:
            try:await sync.settle_withdrawn()
            except (CloudError,httpx.HTTPError):last={'phase':'off','error':'sync_pending_receipt_retained'}
    return await settings(request)


@router.delete('')
async def disconnect(request:Request):
    global last,suspended
    value=await body(request)
    await stop_active()
    async with lock:
        sync=service(request.app)
        if value.get('expected_owner')!=(sync.owner if sync else ''):raise CloudError('sync_account_changed',403)
        if sync:
            sync.configure(sync.status()['selected'],False)
            try:await sync.settle_withdrawn()
            except (CloudError,httpx.HTTPError):pass
        path().unlink(missing_ok=True);suspended=None;last={'phase':'off','error':''}
    return {'connected':False,'enabled':False}


async def run_once(app,*,expected_owner=None):
    global active,last,suspended
    if lock.locked():return {'phase':'busy'}
    async def work():
        global last,suspended
        async with lock:
            sync=service(app)
            if expected_owner is not None and expected_owner!=(sync.owner if sync else ''):raise CloudError('sync_account_changed',403)
            if not sync:return {'phase':'off'}
            if suspended==sync.token:return last
            try:
                result=await sync.run();last={'phase':result['phase'],'error':''};return result
            except CloudError as exc:
                if exc.status in (401,403):suspended=sync.token
                last={'phase':'waiting' if exc.code=='stop_generation_before_sync' else 'error','error':exc.code}
                raise
            except httpx.HTTPError:
                last={'phase':'error','error':'sync_connection_failed'};raise
            except (sqlite3.Error,ValueError,KeyError):
                last={'phase':'error','error':'sync_device_storage_failed'};raise
    task=asyncio.create_task(work());active=task
    try:return await task
    finally:
        if active is task:active=None


@router.post('/run')
async def run(request:Request):
    value=await body(request)
    if not isinstance(value.get('expected_owner'),str):raise CloudError('sync_account_changed',403)
    return await run_once(request.app,expected_owner=value['expected_owner'])


@router.get('/status')
async def session_status(request:Request,session_id:str=Query(min_length=1,max_length=200)):
    sync=service(request.app)
    if not sync:return {'session_id':session_id,'selected':False,'enabled':False,'pending':False,'error':''}
    with sync.transaction(allow_generation=True) as db:
        pending=db.execute('SELECT 1 FROM runtime.native_sync_outbox_sources WHERE namespace=? AND session_id=?',(sync.namespace,session_id)).fetchone()
        return {'session_id':session_id,'selected':session_id in sync.meta(db,'selected',[]),
                'enabled':sync.meta(db,'enabled',False),
                'pending':bool(pending),
                'error':last['error']}


@router.get('/deletions')
async def deletions(request:Request):
    sync=service(request.app)
    if not sync:return {'owner':'','items':[]}
    return {'owner':sync.owner,'items':await sync.deletion_reviews()}


@router.post('/deletions')
async def confirm_deletion(request:Request):
    value=await body(request);await stop_active()
    async with lock:
        sync=service(request.app)
        if not sync:raise CloudError('entity_sync_token_required',403)
        if value.get('expected_owner')!=sync.owner:raise CloudError('sync_account_changed',403)
        if value.get('confirmed') is not True:raise CloudError('sync_delete_confirmation_required',409)
        await sync.confirm_deletion(value.get('id'),value.get('revision'))
    return {'ok':True}


async def background(app):
    while True:
        try:await run_once(app)
        except (CloudError,httpx.HTTPError,sqlite3.Error,ValueError,KeyError):pass
        await asyncio.sleep(15)
