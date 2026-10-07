"""Official vision wire format and deny-on-uncertainty; mock API only."""

import io
import json
import httpx
import pytest
from PIL import Image
from python.providers.deepseek import DeepSeekProvider
from python.providers.deepseek_images import image_block, MAX_IMAGE_BYTES, MAX_IMAGES
from python.cloud.safety import SafetyGuard, POLICY
from python.cloud.meter import CostMeter
from python.cloud.contracts import TARIFF
from python.cloud.store import CloudError


def png():
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, "PNG")
    return output.getvalue()


@pytest.mark.asyncio
async def test_vision_stream_preserves_image_blocks():
    block = image_block(png(), "image/png")
    def respond(request):
        assert request.url.host == "api.deepseek.com"
        payload = json.loads(request.content)
        assert payload["messages"][-1]["content"] == [{"type": "text", "text": "Describe"}, block]
        assert payload["thinking"] == {"type": "disabled"}
        assert payload["response_format"] == {"type": "json_object"}
        parts = [
            {"choices": [{"delta": {"content": '{"description":"blue"}'}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"prompt_tokens": 1024, "completion_tokens": 8}},
        ]
        return httpx.Response(200, text="".join("data: " + json.dumps(p) + "\n\n" for p in parts) + "data: [DONE]\n\n")
    provider = DeepSeekProvider(api_key="sk-test", transport=httpx.MockTransport(respond))
    assert provider.capabilities()["vision"] is True
    events = [e async for e in provider.stream_events(
        messages=[{"role": "user", "content": [{"type": "text", "text": "Describe"}, block]}],
        model="deepseek-flash", response_schema={"type": "object"},
    )]
    assert events[-1]["usage"]["prompt_tokens"] == 1024


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["external", "system", "invalid", "mime", "animated", "size", "count", "model"])
async def test_invalid_image_inputs_never_send(case):
    calls = []
    provider = DeepSeekProvider(transport=httpx.MockTransport(lambda r: calls.append(r)))
    raw, mime = png(), "image/png"
    role = "user"
    block = image_block(raw, mime)
    if case == "external":
        block["image_url"]["url"] = "https://private.test/private-image"
    elif case == "system":
        role = "system"
    elif case == "invalid":
        block["image_url"]["url"] = "data:image/png;base64,INVALID!"
    elif case == "mime":
        block["image_url"]["url"] = block["image_url"]["url"].replace("image/png", "image/jpeg")
    elif case == "size":
        with pytest.raises(ValueError):
            image_block(b"x" * (MAX_IMAGE_BYTES + 1), mime)
        return
    elif case == "animated":
        output = io.BytesIO()
        Image.new("RGB", (8, 8), "red").save(output, "GIF", save_all=True, append_images=[Image.new("RGB", (8, 8), "blue")])
        with pytest.raises(ValueError):
            image_block(output.getvalue(), "image/gif")
        return
    with pytest.raises(ValueError):
        await provider.generate(model="deepseek-v4-pro" if case == "model" else "deepseek-flash", messages=[{"role": role, "content": [block] * (MAX_IMAGES + 1 if case == "count" else 1)}])
    assert calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("decision,finish,usage,error", [
    (True, "stop", True, None), (False, "stop", True, "cloud_sfw_only"),
    ("true", "stop", True, "cloud_sfw_only"), (True, "length", True, "safety_unavailable"),
    (True, None, True, "safety_unavailable"), (True, "stop", False, "provider_usage_unavailable"),
])
async def test_image_safety_gate_and_accounting(decision, finish, usage, error):
    raw = png()
    def respond(request):
        payload = json.loads(request.content)
        assert payload["messages"][1]["content"][1] == image_block(raw, "image/png")
        data = {"choices": [{"message": {"content": json.dumps({"sfw": decision})}, "finish_reason": finish}]}
        if usage:
            data["usage"] = {"prompt_tokens": 1100, "completion_tokens": 10}
        return httpx.Response(200, json=data)
    provider = DeepSeekProvider(transport=httpx.MockTransport(respond))
    with pytest.raises(CloudError, match="cloud_image_screening_not_validated"):
        await SafetyGuard(provider).check({}, images=[(raw, "image/png")])
    bound = (2 + len(POLICY.encode()) + 128 + 1024) * TARIFF.input_miss + 128 * TARIFF.output
    meter = CostMeter(bound)
    guard = SafetyGuard(provider, image_screening_enabled=True)
    if error:
        with pytest.raises(CloudError, match=error):
            await guard.check({}, images=[(raw, "image/png")], meter=meter)
    else:
        await guard.check({}, images=[(raw, "image/png")], meter=meter)
    assert meter.total == (TARIFF.cost({"prompt_tokens": 1100, "completion_tokens": 10}) if usage else bound)


@pytest.mark.asyncio
async def test_image_gate_errors_never_contain_upstream_data():
    marker = "SECRET_IMAGE_AND_KEY"
    provider = DeepSeekProvider(transport=httpx.MockTransport(lambda r: httpx.Response(500, text=marker)))
    with pytest.raises(CloudError) as error:
        await SafetyGuard(provider, image_screening_enabled=True).check({}, images=[(png(), "image/png")])
    assert marker not in str(error.value)
