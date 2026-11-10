"""35: declaration only where policy allows it; Yoti results are read server-to-server."""
from dataclasses import replace
import json
import time
from uuid import uuid4

import httpx
import pytest
from python.cloud.age_check import AgeCheck
from python.cloud.config import CloudConfig
from python.cloud.store import CloudStore, CloudError
from python.cloud.unified import UnifiedService

POLICIES = {"JP": {"accepted": True, "adult_accepted": True, "adult_method": "self", "version": "jp-1"},
            "GB": {"accepted": True, "adult_accepted": True, "adult_method": "yoti", "version": "gb-1"}}


def make(tmp_path, **cfg):
    config = CloudConfig(root=tmp_path, origin="https://app.test", secret="s" * 32, unified_enabled=True, **cfg)
    service = UnifiedService(CloudStore(config), region_policies=POLICIES)

    def enroll(country, age=20):
        owner = str(uuid4())
        service.store.account(owner, consent="fixture")
        service.store.secret(owner, "app-eligibility", json.dumps(service.general_eligibility(country, age, guardian=True)))
        return owner
    return service, enroll


def test_declaration_unlocks_only_declaration_regions(tmp_path):
    service, enroll = make(tmp_path)
    jp, gb, teen = enroll("JP"), enroll("GB"), enroll("JP", 17)
    assert service.age.status(jp) == {"method": "self", "verified": False, "adult_band": True}
    with pytest.raises(CloudError, match="age_declaration_required"):
        service.age.declare(jp, False)
    assert service.age.declare(jp, True)["verified"] is True
    service.publications.consent(jp, True)
    # Yoti without keys is unavailable, and a UK user can never self-declare.
    assert service.age.status(gb)["method"] is None
    with pytest.raises(CloudError, match="age_method_unavailable"):
        service.age.declare(gb, True)
    with pytest.raises(CloudError, match="adult_verification_required"):
        service.age.declare(teen, True)


@pytest.mark.asyncio
async def test_yoti_result_is_fetched_and_bound_to_the_session_owner(tmp_path):
    service, enroll = make(tmp_path, yoti_sdk_id="sdk", yoti_api_key="key")
    state = {"status": "COMPLETE"}

    def provider(request):
        assert request.headers["authorization"] == "Bearer key" and request.headers["yoti-sdk-id"] == "sdk"
        if request.method == "POST":
            body = json.loads(request.content)
            assert body["type"] == "OVER" and body["callback"]["url"] == "https://app.test/profile/age"
            state["reference"] = body["reference_id"]
            return httpx.Response(200, json={"id": "sess-1", "status": "PENDING"})
        assert request.url.path == "/api/v1/sessions/sess-1/result"
        return httpx.Response(200, json={"id": "sess-1", "type": "OVER", "status": state["status"],
                                         "reference_id": state["reference"]})
    service.age = AgeCheck(service, httpx.AsyncClient(transport=httpx.MockTransport(provider)))
    gb, other, jp = enroll("GB"), enroll("GB"), enroll("JP")
    with pytest.raises(CloudError, match="age_method_unavailable"):
        await service.age.start(jp)
    assert (await service.age.start(gb))["url"] == "https://age.yoti.com?sessionId=sess-1&sdkId=sdk"
    with pytest.raises(CloudError, match="age_session_not_found"):
        await service.age.finish(other, "sess-1")
    state["status"] = "IN_PROGRESS"
    assert (await service.age.finish(gb, "sess-1"))["result"] == "pending"
    state["status"] = "COMPLETE"
    result = await service.age.finish(gb, "sess-1")
    assert result["result"] == "complete" and result["verified"] is True
    with pytest.raises(CloudError, match="age_session_not_found"):
        await service.age.finish(gb, "sess-1")

    await service.age.start(other)
    state["status"] = "FAIL"
    assert (await service.age.finish(other, "sess-1"))["verified"] is False
    with pytest.raises(CloudError, match="adult_verification_required"):
        service.require_adult(other)


def test_unknown_adult_method_is_rejected(tmp_path):
    with pytest.raises(ValueError):
        CloudConfig(root=tmp_path, origin="https://app.test", secret="s" * 32,
                    region_policies=(("JP", {"version": "1", "adult_method": "selfie"}),))
