"""Responses transport. Message roles and provider usage remain intact."""
import json
from .openai_compat import OpenAICompatibleProvider
from . import resolve_messages, usage_event


def _messages_to_input(messages, prompt):
    return resolve_messages(prompt, messages)


class ResponsesProvider(OpenAICompatibleProvider):
    BASE_SUPPORTED = frozenset({"messages", "model", "max_tokens", "reasoning"})

    def __init__(self, base_url=None, api_key=None, supported_parameters=None, **kwargs):
        super().__init__(base_url=base_url, api_key=api_key, **kwargs)
        self.base_url = self.base_url.removesuffix("/responses")
        self.BASE_SUPPORTED = self.BASE_SUPPORTED | frozenset(supported_parameters or [])

    async def stream_events(self, prompt="", **kwargs):
        config = self.generation_config({k: v for k, v in kwargs.items() if k != "messages"})["applied"]
        model = kwargs.get("model")
        if not model:
            raise ValueError("explicit model required")
        payload = {"model": model, "input": _messages_to_input(kwargs.get("messages"), prompt), "stream": True}
        for key, value in config.items():
            if key == "max_tokens": payload["max_output_tokens"] = value
            elif key == "reasoning": payload["reasoning"] = value if isinstance(value, dict) else {"effort": value}
            elif key == "response_schema":
                payload["text"] = {"format": {"type": "json_schema", "name": "reply_state", "strict": True, "schema": value}}
            elif key not in {"messages", "model"}: payload[key] = value
        async with self._client() as client:
            async with client.stream("POST", f"{self.base_url}/responses", json=payload) as response:
                response.raise_for_status()
                completed = False
                async for line in response.aiter_lines():
                    if not line.startswith("data:"): continue
                    data = line[5:].strip()
                    if data == "[DONE]": break
                    obj = json.loads(data)
                    yield {"type": "chunk"}
                    kind = obj.get("type")
                    if kind == "response.output_text.delta":
                        yield {"type": "delta", "text": obj.get("delta", "")}
                    elif kind == "response.completed":
                        completed = True
                        usage = obj.get("response", {}).get("usage", {})
                        yield usage_event(usage.get("input_tokens"), usage.get("output_tokens"),
                                          (usage.get("output_tokens_details") or {}).get("reasoning_tokens"))
                    elif kind in {"error", "response.failed", "response.incomplete"}:
                        raise RuntimeError("Responses generation failed or incomplete")
                if not completed:
                    raise RuntimeError("Responses stream ended without response.completed")

    async def health_check(self):
        return {"status": "ok" if await self.connect() else "offline", "provider": "responses"}
