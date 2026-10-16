"""Prepared hosted OpenRouter transport with pinned upstreams and actual cost.

DeepSeek V4.1 Flash is the selected hosted model. No
model or upstream fallback, arbitrary endpoints, tools, or media downloads.
"""

import asyncio
import json
from decimal import Decimal, InvalidOperation, ROUND_CEILING
import httpx
from .deepseek_images import vision_messages
from .openai_compat import OpenAICompatibleProvider

DEEPSEEK = "deepseek/deepseek-v4.1-flash"
GLM = "z-ai/glm-5.3-flash"
HAIKU = "anthropic/claude-haiku-5.5"
LUNA = "openai/gpt-6-luna"
MIMO = "xiaomi/mimo-v2.6-flash"
UPSTREAM = "InferenceNet"
UPSTREAM_TAG = "inference-net"
# USD per million ceilings; DeepSeek refreshed on 2026-10-12, other models on 2026-10-11.
PRICE_CAPS = {DEEPSEEK: ("0.077", "0.66"), GLM: ("0.07", "0.05"),
              HAIKU: ("0.1", "0.5"), LUNA: ("0.05", "0.25")}


def billed_nano(usage):
    """Never substitute token reference prices for a missing billed cost."""
    try:
        value = usage["cost_usd"]
        if not isinstance(value, str) or len(value) > 64:
            raise ValueError()
        cost = Decimal(value)
        if not cost.is_finite() or cost < 0 or cost > 100:
            raise ValueError()
        return int((cost * 1_000_000_000).to_integral_value(rounding=ROUND_CEILING))
    except (KeyError, TypeError, ValueError, InvalidOperation) as exc:
        raise ValueError("provider_billed_cost_missing") from exc


def billing_failure(exc, usage, minimum_cost=0):
    """Carry only normalized billing data, preserving transport/cancellation semantics."""
    exc.openrouter_usage = usage or {}
    exc.openrouter_minimum_cost = minimum_cost
    return exc


class OpenRouterProvider(OpenAICompatibleProvider):
    BASE_SUPPORTED = frozenset({"model", "temperature", "max_tokens", "response_schema"})

    def __init__(self, *, api_key, model=DEEPSEEK, transport=None, upstream=UPSTREAM,
                 upstream_tag=UPSTREAM_TAG, price_caps=None, reasoning_effort=None,
                 reasoning_summary_supported=False, data_collection="deny"):
        if model not in PRICE_CAPS:
            raise ValueError("openrouter_model_not_allowed")
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("openrouter_key_required")
        super().__init__(base_url="https://openrouter.ai/api/v1", api_key=api_key,
                         transport=transport, supports_structured_output=True)
        self.model = model
        self.upstream, self.upstream_tag = upstream, upstream_tag
        self.price_caps = price_caps or PRICE_CAPS[model]
        self.reasoning_effort = reasoning_effort
        if data_collection not in {"deny", "allow"}:
            raise ValueError("invalid_openrouter_data_collection")
        self.data_collection = data_collection
        self.reasoning_summary_supported = reasoning_summary_supported
        self.max_output = 4096 if reasoning_effort else 1024

    @property
    def _supported(self):
        return self.BASE_SUPPORTED - {"temperature"} if self.model in {LUNA, HAIKU} else self.BASE_SUPPORTED

    def _client(self):
        return httpx.AsyncClient(timeout=self._timeout, transport=self._transport,
                                 follow_redirects=False, headers={
            "Authorization": f"Bearer {self.api_key}", "User-Agent": "Kyalulu/0.1.0-beta.1"})

    def request_payload(self, messages, *, schema=None, output=1024,
                        temperature=None, stream=False):
        messages = vision_messages("", messages)
        if schema is not None:
            messages = [{"role": "system", "content": "Return only a JSON object matching "
                         + json.dumps(schema, ensure_ascii=False)}, *messages]
        prompt, completion = self.price_caps
        payload = {"model": self.model, "messages": messages, "stream": stream,
                   "max_tokens": output, "reasoning": {"enabled": False},
                   "provider": {"only": [self.upstream_tag], "allow_fallbacks": False,
                                "require_parameters": True, "data_collection": self.data_collection,
                                "max_price": {"prompt": float(prompt), "completion": float(completion)}},
                   "usage": {"include": True}}
        if self.model == HAIKU:
            payload["provider"]["zdr"] = True
        if self.reasoning_effort:
            payload["reasoning"] = {"effort": self.reasoning_effort, "exclude": False}
            if self.reasoning_summary_supported and self.model == LUNA:
                payload["reasoning"]["summary"] = "auto"
        if stream:
            payload["stream_options"] = {"include_usage": True}
        if schema is not None:
            payload["response_format"] = {"type": "json_object"}
        if temperature is not None and self.model not in {LUNA, HAIKU}:
            payload["temperature"] = temperature
        return payload

    def normalize_usage(self, usage):
        if not isinstance(usage, dict):
            return {}
        result = {k: usage[k] if type(usage[k]) is int and usage[k] >= 0 else None
                  for k in ("prompt_tokens", "completion_tokens") if k in usage}
        details = usage.get("prompt_tokens_details")
        if isinstance(details, dict) and "cached_tokens" in details:
            cached = details["cached_tokens"]
            result["prompt_cache_hit_tokens"] = cached if type(cached) is int and cached >= 0 else None
        completion = usage.get("completion_tokens_details")
        if isinstance(completion, dict):
            thinking = completion.get("reasoning_tokens")
            if type(thinking) is int and type(result.get("completion_tokens")) is int and 0 <= thinking <= result["completion_tokens"]:
                result["thinking_tokens"] = thinking
        # Preserve decimal digits from the upstream JSON before nanodollar rounding.
        value = usage.get("cost")
        if isinstance(value, (int, Decimal)) and not isinstance(value, bool):
            result["cost_usd"] = str(value)
        elif "cost" in usage:
            result["cost_usd"] = None
        return result

    def verify_route(self, data):
        if data.get("provider") != self.upstream or data.get("model") != self.model:
            raise RuntimeError("openrouter_unaccepted_upstream")

    async def screen_json(self, messages, schema, output):
        usage = {}
        try:
            async with self._client() as client:
                response = await client.post(self.base_url + "/chat/completions",
                    json=self.request_payload(messages, schema=schema, output=output))
                # Capture received billing before client cleanup can fail or be cancelled.
                try:
                    data = json.loads(response.text, parse_float=Decimal)
                    usage = self.normalize_usage(data.get("usage"))
                    if response.status_code != 200:
                        raise RuntimeError(f"openrouter_http_{response.status_code}")
                    self.verify_route(data)
                    choices = data["choices"]
                    if len(choices) != 1 or choices[0].get("finish_reason") != "stop":
                        raise ValueError()
                    message = choices[0]["message"]
                    if any(message.get(k) for k in ("refusal", "reasoning", "reasoning_content", "reasoning_details", "tool_calls")):
                        raise ValueError()
                    text = message["content"]
                    if not isinstance(text, str) or not text:
                        raise ValueError()
                    return text, usage
                except (ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
                    code = (f"openrouter_http_{response.status_code}" if response.status_code != 200
                            else "openrouter_invalid_output")
                    raise RuntimeError(code) from exc
        except (asyncio.CancelledError, httpx.HTTPError, RuntimeError) as exc:
            raise billing_failure(exc, usage)

    async def stream_events(self, prompt="", **kwargs):
        if kwargs.get("model") != self.model:
            raise ValueError("openrouter_model_is_pinned")
        messages = vision_messages(prompt, kwargs.get("messages"))
        cfg = self.generation_config({k: v for k, v in kwargs.items() if k != "messages"})["applied"]
        payload = self.request_payload(messages, schema=cfg.get("response_schema"),
            output=cfg.get("max_tokens", 1024), temperature=cfg.get("temperature"), stream=True)
        usage = None
        finish = None
        done = received = route_verified = False
        minimum_cost = 0
        try:
            async with self._client() as client:
                async with client.stream("POST", self.base_url + "/chat/completions", json=payload) as response:
                    if response.status_code != 200:
                        await response.aread()
                        try:
                            data = json.loads(response.text, parse_float=Decimal)
                            usage = self.normalize_usage(data.get("usage"))
                        except (ValueError, TypeError, AttributeError):
                            pass
                        raise RuntimeError(f"openrouter_http_{response.status_code}")
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        value = line[5:].strip()
                        if value == "[DONE]":
                            done = True
                            break
                        try:
                            event = json.loads(value, parse_float=Decimal)
                            # A bill belongs to the operator even when route/output is rejected.
                            if "usage" in event:
                                usage = self.normalize_usage(event["usage"])
                                try:
                                    minimum_cost = max(minimum_cost, billed_nano(usage))
                                except ValueError:
                                    pass
                            if "error" in event:
                                raise RuntimeError("openrouter_upstream_error")
                            if "provider" in event:
                                self.verify_route(event)
                                route_verified = True
                            elif "model" in event and event["model"] != self.model:
                                raise RuntimeError("openrouter_unaccepted_upstream")
                            choices = event.get("choices", [])
                            if len(choices) > 1:
                                raise ValueError()
                            for choice in choices:
                                delta = choice.get("delta") or {}
                                if choice.get("finish_reason") == "content_filter" or any(delta.get(k) for k in (
                                        "refusal", "tool_calls")):
                                    raise RuntimeError("openrouter_refused_or_unexpected_output")
                                if not self.reasoning_effort and any(delta.get(k) for k in (
                                        "reasoning", "reasoning_content", "reasoning_details")):
                                    raise RuntimeError("openrouter_refused_or_unexpected_output")
                                details = delta.get("reasoning_details") or []
                                if not isinstance(details, list):
                                    raise ValueError()
                                for detail in details:
                                    if not isinstance(detail, dict):
                                        raise ValueError()
                                    # Only the provider's explicit summary type may leave this transport.
                                    if self.reasoning_summary_supported and detail.get("type") == "reasoning.summary":
                                        summary = detail.get("summary")
                                        if not isinstance(summary, str) or len(summary) > 8000:
                                            raise ValueError()
                                        if not route_verified:
                                            raise RuntimeError("openrouter_unaccepted_upstream")
                                        if summary:
                                            yield {"type": "reasoning_summary", "text": summary}
                                finish = choice.get("finish_reason") or finish
                                text = delta.get("content")
                                if text is not None and not isinstance(text, str):
                                    raise ValueError()
                                if text:
                                    if not route_verified:
                                        raise RuntimeError("openrouter_unaccepted_upstream")
                                    received = True
                                    yield {"type": "delta", "text": text}
                        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
                            raise RuntimeError("openrouter_invalid_stream") from exc
            if usage is not None:
                # Reports are cumulative for one call. Never add repeated usage packets.
                yield {"type": "usage", "usage": usage, "minimum_cost": minimum_cost}
            if not done or finish != "stop" or not route_verified:
                raise RuntimeError("openrouter_incomplete_output")
            if not received:
                raise RuntimeError("openrouter_empty_output")
        except (asyncio.CancelledError, httpx.HTTPError, RuntimeError) as exc:
            raise billing_failure(exc, usage, minimum_cost)

    def capabilities(self):
        return {"streaming": True, "vision": True, "tools": False,
                "structured_format": "json_object_candidate", "thinking": self.reasoning_effort or "disabled_requested",
                "reasoning_summary_supported": self.reasoning_summary_supported,
                "usage": True, "model": self.model, "upstream": self.upstream,
                "acceptance": "quality_verified_transport_requires_acceptance"}
