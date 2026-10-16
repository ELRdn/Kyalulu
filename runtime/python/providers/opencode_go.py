"""Prepared OpenCode Go transports. Hosting rights are checked by Cloud Runtime.

The client identifies Kyalulu honestly; it never impersonates a coding agent.
Muse Contributor uses Responses, not Chat Completions, and requires consent.
"""

import hashlib
import json
import httpx
from .openai_compat import OpenAICompatibleProvider
from .deepseek_images import vision_messages

GO_URL = "https://opencode.ai/zen/go/v1"
DEEPSEEK = "deepseek-v4.1-flash"
MIMO = "mimo-v2.6-flash"
MUSE = "muse-spark-1.3-contributor"
GO_MODELS = frozenset({DEEPSEEK, MIMO, MUSE})


class OpenCodeGoProvider(OpenAICompatibleProvider):
    BASE_SUPPORTED = frozenset({"model", "temperature", "max_tokens", "response_schema"})

    def __init__(self, *, model, session, api_key=None, transport=None,
                 contributor_consent=False, base_url=None, **kwargs):
        if base_url not in (None, GO_URL) or model not in GO_MODELS:
            raise ValueError("opencode_go_endpoint_or_model_invalid")
        if not isinstance(session, str) or not session:
            raise ValueError("opencode_go_session_required")
        if not isinstance(api_key, str) or not api_key:
            raise ValueError("opencode_go_key_required")
        if model == MUSE and contributor_consent is not True:
            raise ValueError("muse_training_consent_required")
        super().__init__(base_url=GO_URL, api_key=api_key, transport=transport,
                         supports_structured_output=True, **kwargs)
        self.model = model
        self.session = hashlib.sha256(session.encode()).hexdigest()

    def _client(self):
        return httpx.AsyncClient(
            timeout=self._timeout, transport=self._transport, follow_redirects=False,
            headers={"Authorization": f"Bearer {self.api_key}",
                     "User-Agent": "Kyalulu/0.1.0-beta.1",
                     "x-opencode-session": self.session},
        )

    def request_payload(self, messages, *, schema=None, output=1024,
                        temperature=None, stream=False):
        messages = vision_messages("", messages)
        if schema is not None:
            messages = [{"role": "system", "content":
                         "Return only a JSON object matching this schema: "
                         + json.dumps(schema, ensure_ascii=False)}, *messages]
        if self.model == MUSE:
            inputs = []
            for message in messages:
                content = message["content"]
                if isinstance(content, list):
                    content = [
                        {"type": "input_text", "text": b["text"]}
                        if b["type"] == "text" else
                        {"type": "input_image", "image_url": b["image_url"]["url"]}
                        for b in content
                    ]
                inputs.append({"role": message["role"], "content": content})
            payload = {"model": self.model, "input": inputs, "stream": stream,
                       "max_output_tokens": output, "store": False,
                       "reasoning": {"effort": "minimal"}}
            if schema is not None:
                payload["text"] = {"format": {"type": "json_object"}}
        else:
            payload = {"model": self.model, "messages": messages, "stream": stream,
                       "max_tokens": output, "thinking": {"type": "disabled"}}
            if stream:
                payload["stream_options"] = {"include_usage": True}
            if schema is not None:
                payload["response_format"] = {"type": "json_object"}
        if temperature is not None:
            payload["temperature"] = temperature
        return payload

    @property
    def endpoint(self):
        return self.base_url + ("/responses" if self.model == MUSE else "/chat/completions")

    def normalize_usage(self, usage):
        if not isinstance(usage, dict):
            return {}
        result = {}
        for target, source in (("prompt_tokens", "input_tokens"),
                               ("completion_tokens", "output_tokens")):
            value = usage.get(source if self.model == MUSE else target)
            if type(value) is int and value >= 0:
                result[target] = value
        details = usage.get("input_tokens_details" if self.model == MUSE else "prompt_tokens_details")
        hit = usage.get("prompt_cache_hit_tokens")
        if hit is None and isinstance(details, dict):
            hit = details.get("cached_tokens")
        if hit is not None:
            result["prompt_cache_hit_tokens"] = hit
        miss = usage.get("prompt_cache_miss_tokens")
        if miss is not None:
            result["prompt_cache_miss_tokens"] = miss
        # Completion/output tokens already include billed reasoning. Do not add twice.
        return result

    async def screen_json(self, messages, schema, output):
        payload = self.request_payload(messages, schema=schema, output=output)
        async with self._client() as client:
            response = await client.post(self.endpoint, json=payload)
        if response.status_code != 200:
            raise RuntimeError(f"opencode_go_http_{response.status_code}")
        try:
            data = response.json()
            if self.model == MUSE:
                if data.get("status") != "completed":
                    raise ValueError()
                blocks = [b for item in data.get("output", []) if item.get("type") == "message"
                          for b in item.get("content", [])]
                if any(b.get("type") == "refusal" for b in blocks):
                    raise ValueError()
                text = "".join(b["text"] for b in blocks if b.get("type") == "output_text")
            else:
                choices = data["choices"]
                if len(choices) != 1 or choices[0].get("finish_reason") != "stop":
                    raise ValueError()
                message = choices[0]["message"]
                if message.get("refusal") or message.get("reasoning_content"):
                    raise ValueError()
                text = message["content"]
            if not isinstance(text, str) or not text:
                raise ValueError()
            return text, self.normalize_usage(data.get("usage"))
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise RuntimeError("opencode_go_invalid_output") from exc

    async def stream_events(self, prompt="", **kwargs):
        if kwargs.get("model") != self.model:
            raise ValueError("opencode_go_model_is_pinned")
        messages = vision_messages(prompt, kwargs.get("messages"))
        cfg = self.generation_config({k: v for k, v in kwargs.items() if k != "messages"})
        applied = cfg["applied"]
        payload = self.request_payload(messages, schema=applied.get("response_schema"),
                                       output=applied.get("max_tokens", 1024),
                                       temperature=applied.get("temperature"), stream=True)
        usage = None
        finish = None
        done = received = False
        async with self._client() as client:
            async with client.stream("POST", self.endpoint, json=payload) as response:
                if response.status_code != 200:
                    raise RuntimeError(f"opencode_go_http_{response.status_code}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    value = line[5:].strip()
                    if value == "[DONE]":
                        done = True
                        break
                    try:
                        event = json.loads(value)
                        if self.model == MUSE:
                            kind = event.get("type")
                            if kind in {"error", "response.failed", "response.incomplete",
                                        "response.refusal.delta", "response.refusal.done"}:
                                raise RuntimeError("opencode_go_refused_or_incomplete")
                            if kind == "response.completed":
                                completed = event["response"]
                                finish = completed.get("status")
                                usage = self.normalize_usage(completed.get("usage"))
                                done = finish == "completed"
                                if any(b.get("type") == "refusal"
                                       for item in completed.get("output", [])
                                       for b in item.get("content", [])):
                                    raise RuntimeError("opencode_go_refused")
                                break
                            text = event.get("delta") if kind == "response.output_text.delta" else None
                        else:
                            if "error" in event:
                                raise RuntimeError("opencode_go_upstream_error")
                            if isinstance(event.get("usage"), dict):
                                usage = self.normalize_usage(event["usage"])
                            text = None
                            for choice in event.get("choices", []):
                                delta = choice.get("delta") or {}
                                if delta.get("refusal") or choice.get("finish_reason") == "content_filter":
                                    raise RuntimeError("opencode_go_refused")
                                if delta.get("reasoning_content"):
                                    raise RuntimeError("opencode_go_unexpected_reasoning")
                                finish = choice.get("finish_reason") or finish
                                text = delta.get("content")
                                if text:
                                    if not isinstance(text, str):
                                        raise ValueError()
                                    received = True
                                    yield {"type": "delta", "text": text}
                            continue
                        if text is not None and not isinstance(text, str):
                            raise ValueError()
                        if text:
                            received = True
                            yield {"type": "delta", "text": text}
                    except (ValueError, KeyError, TypeError, AttributeError) as exc:
                        raise RuntimeError("opencode_go_invalid_stream") from exc
        if usage is not None:
            yield {"type": "usage", "usage": usage}
        if not done or finish != ("completed" if self.model == MUSE else "stop"):
            raise RuntimeError("opencode_go_incomplete_output")
        if not received:
            raise RuntimeError("opencode_go_empty_output")

    def capabilities(self):
        return {"streaming": True, "vision": True, "tools": False,
                "structured_format": "json_object_candidate", "usage": True,
                "thinking": "minimal" if self.model == MUSE else "disabled_requested",
                "training": self.model == MUSE, "model": self.model,
                "acceptance": "mock_only"}
