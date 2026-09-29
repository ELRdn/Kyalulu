"""Local-only Host administration. Remote callers never receive pairing secrets."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from python.api.mobile import local_admin

router = APIRouter(prefix='/remote')


def host(request):
    if not local_admin(request):
        raise HTTPException(403, 'local_admin_required')
    service = getattr(request.app.state, 'remote_host', None)
    if service is None:
        raise HTTPException(409, 'host_not_running')
    return service


@router.get('/status')
async def status(request: Request):
    if not local_admin(request):
        raise HTTPException(403, 'local_admin_required')
    service = getattr(request.app.state, 'remote_host', None)
    return service.status() if service else {'installed': False, 'connected': False}


@router.post('/pair')
async def pair(request: Request):
    return await host(request).pair()


class Approval(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    device_id: str = Field(min_length=36, max_length=36)
    code: str = Field(pattern=r'^[0-9]{6}$')


@router.post('/approve')
async def approve(body: Approval, request: Request):
    await host(request).approve(body.device_id, body.code)
    return {'approved': True}


@router.delete('/devices/{device_id}')
async def revoke(device_id: str, request: Request):
    await host(request).revoke(device_id)
    return {'revoked': True}


@router.post('/stop')
async def stop(request: Request):
    await host(request).stop()
    return {'stopped': True}
