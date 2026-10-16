"""DeepSeek chat adapter: explicit non-thinking mode and JSON object output."""

from __future__ import annotations
import json
from .deepseek_images import vision_messages
from .openai_compat import OpenAICompatibleProvider


class DeepSeekProvider(OpenAICompatibleProvider):
    BASE_SUPPORTED = frozenset({"model", "temperature", "max_tokens", "response_schema"})

    def __init__(self, *, api_key=None, transport=None, base_url=None, **kwargs):
        if base_url not in (None, "https://api.deepseek.com/v1", "https://api.deepseek.com"):
            raise ValueError("DeepSeek endpoint must be the official HTTPS endpoint")
        kwargs.pop("supports_structured_output", None)
        super().__init__(
            base_url="https://api.deepseek.com/v1",
            api_key=api_key,
            transport=transport,
            supports_structured_output=True,
            **kwargs,
        )

    def _build_payload(self, messages, applied):
        if any(isinstance(m.get("content"), list) for m in messages) and applied.get("model") not in {
            "deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
        }:
            raise ValueError("deepseek_vision_model_not_supported")
        payload = super()._build_payload(
            messages, {k: v for k, v in applied.items() if k != "response_schema"}
        )
        payload["thinking"] = {"type": "disabled"}
        if "response_schema" in applied:
            payload["response_format"] = {"type": "json_object"}
            # DeepSeek requires an explicit JSON instruction, including standalone calls.
            payload["messages"] = [
                {
                    "role": "system",
                    "content": "Return a JSON object matching the requested schema.",
                },
                *messages,
            ]
        return payload

    async def stream_events(self, prompt="", **kwargs):
        messages = vision_messages(prompt, kwargs.get("messages"))
        cfg = self.generation_config({k: v for k, v in kwargs.items() if k != "messages"})
        payload = self._build_payload(messages, cfg["applied"])
        usage = None
        finish = None
        done = False
        received = False
        async with self._client() as client:
            async with client.stream(
                "POST", f"{self.base_url}/chat/completions", json=payload
            ) as response:
                if response.status_code >= 400:
                    # Never include upstream bodies, prompts or credentials in errors.
                    raise RuntimeError(f"deepseek_http_{response.status_code}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    value = line[5:].strip()
                    if value == "[DONE]":
                        done = True
                        break
                    try:
                        event = json.loads(value)
                        if not isinstance(event, dict):
                            raise ValueError()
                        if isinstance(event.get("usage"), dict):
                            usage = event["usage"]
                        for choice in event.get("choices", []):
                            delta = choice.get("delta") or {}
                            if (
                                delta.get("refusal")
                                or choice.get("finish_reason") == "content_filter"
                            ):
                                raise RuntimeError("deepseek_refused")
                            if delta.get("reasoning_content"):
                                raise RuntimeError("deepseek_unexpected_reasoning")
                            if choice.get("finish_reason") is not None:
                                finish = choice["finish_reason"]
                            text = delta.get("content")
                            if text is not None and not isinstance(text, str):
                                raise ValueError()
                            if text:
                                received = True
                                yield {"type": "delta", "text": text}
                    except (ValueError, TypeError, AttributeError) as exc:
                        raise RuntimeError("deepseek_invalid_stream") from exc
                # Report known usage even when the final output failed.
                if usage is not None:
                    keys = {
                        "prompt_tokens",
                        "completion_tokens",
                        "prompt_cache_hit_tokens",
                        "prompt_cache_miss_tokens",
                    }
                    clean = {
                        k: v for k, v in usage.items() if k in keys and type(v) is int and v >= 0
                    }
                    yield {"type": "usage", "usage": {**clean, "thinking_tokens": 0}}
                if not done or finish != "stop":
                    raise RuntimeError("deepseek_incomplete_output")
                if not received:
                    raise RuntimeError("deepseek_empty_output")

    def capabilities(self):
        return {
            "streaming": True,
            "tools": False,
            "vision": True,
            "vision_model": "deepseek-flash",
            "vision_inputs": "validated_inline_static_images",
            "structured_format": "json_object",
            "thinking": "disabled",
            "usage": True,
        }
