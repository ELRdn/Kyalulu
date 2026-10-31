"""Local general-use confirmation; no Cloud account, adult grant or external request."""
import secrets

from fastapi import APIRouter, Request
from python.api.mobile import error, local_admin
from python.cloud.store import CloudError
from python.cloud.unified import general_eligibility

router = APIRouter(prefix='/local')


@router.post('/eligibility')
async def eligibility(request: Request):
    if not local_admin(request):
        return error('local_administration_required', 403)
    if request.headers.get('origin') != str(request.base_url).rstrip('/'):
        return error('same_origin_required', 403)
    try:
        body = await request.json()
    except ValueError:
        return error('invalid_eligibility', 400)
    if not isinstance(body, dict) or set(body) != {'country', 'age'}:
        return error('invalid_eligibility', 400)
    try:
        result = general_eligibility(dict(request.app.state.mobile_config.region_policies), body['country'], body['age'])
    except CloudError as exc:
        return error(exc.code, exc.status)
    # This receipt only completes local onboarding; it cannot authenticate to Cloud.
    return {**result, 'ticket': 'native:' + secrets.token_urlsafe(32)}
