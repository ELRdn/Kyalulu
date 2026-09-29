from __future__ import annotations
import json
import os
import re
import socket
import time
from dataclasses import dataclass, asdict
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler
from .util import KCBError, dumps, strict_object
from .state import solve_public_task

MAX_BYTES = 16 * 1024 * 1024

class ProviderError(KCBError):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward an Authorization header to a redirect target.
        return None

@dataclass
class Generation:
    text: str
    latency_seconds: float
    ttft_seconds: float | None = None
    usage: dict | None = None
    finish_reason: str | None = None
    server_model: str | None = None
    reasoning_chars: int = 0
    streamed: bool = False
    mock: bool = False
    system_replayed_response: bool = False

    def record(self) -> dict:
        return asdict(self)


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(p.get("text", "") for p in value if isinstance(p, dict) and isinstance(p.get("text", ""), str))
    raise ProviderError("Response content is not text")


def _usage(value) -> dict | None:
    if not isinstance(value, dict):
        return None
    result = {}
    for name in ("prompt_tokens", "completion_tokens", "total_tokens"):
        n = value.get(name)
        if type(n) is int and n >= 0:
            result[name] = n
    details = value.get("completion_tokens_details", {})
    if isinstance(details, dict) and type(details.get("reasoning_tokens")) is int:
        result["reasoning_tokens"] = max(0, details["reasoning_tokens"])
    details = value.get("prompt_tokens_details", {})
    if isinstance(details, dict) and type(details.get("cached_tokens")) is int:
        result["cached_prompt_tokens"] = max(0, details["cached_tokens"])
    return result or None


class Provider:
    def __init__(self, config: dict):
        self.config = config
        self.opener = build_opener(NoRedirect())

    def _verify_reasoning(self, result: Generation) -> Generation:
        if self.config["require_no_reasoning"] and (
            result.reasoning_chars > 0
            or (result.usage or {}).get("reasoning_tokens", 0) > 0
            or re.search(r"</?think(?:ing)?>", result.text, re.I)
        ):
            raise ProviderError("No-thinking check failed: the response contained reasoning. Verify the server setting; the response was not graded.")
        return result

    def _request(self, suffix: str, payload: dict | None = None):
        key = os.environ.get(self.config["api_key_env"], "")
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if key:
            headers["Authorization"] = "Bearer " + key
        request = Request(self.config["base_url"] + suffix,
                          data=dumps(payload).encode("utf-8") if payload is not None else None,
                          headers=headers, method="POST" if payload is not None else "GET")
        try:
            return self.opener.open(request, timeout=self.config["timeout_seconds"])
        except HTTPError as exc:
            # Error bodies can contain prompts or secrets. Keep them out of logs.
            exc.close()
            raise ProviderError(f"HTTP {exc.code} from configured endpoint. Check model ID, API settings, server log, and extra_body. No automatic retries or parameter fallback.") from exc
        except (URLError, OSError, socket.timeout) as exc:
            message = str(exc).replace(key, "[REDACTED]") if key else str(exc)
            raise ProviderError(f"Endpoint unavailable: {message}") from exc

    def models(self) -> list[str]:
        if self.config["provider"] == "mock":
            return ["fixture", "broken"]
        try:
            with self._request("/models") as response:
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ProviderError("Model-list response too large")
                data = json.loads(raw)
            entries = data.get("data", [])
            return sorted({d["id"] for d in entries if isinstance(d, dict) and isinstance(d.get("id"), str)})
        except (ValueError, KeyError, TypeError) as exc:
            raise ProviderError("Expected GET /models to return {'data':[{'id':...}]}.") from exc

    def resolve_model(self) -> str:
        model = self.config["model"]
        if model == "auto":
            models = self.models()
            if len(models) != 1:
                raise ProviderError(f"Automatic selection requires exactly ONE model, found {len(models)}: {models}. Set model in config or use --model.")
            model = models[0]
            self.config["model"] = model
        return model

    def generate(self, messages: list[dict], seed: int | None = None,
                 session_context: dict | None = None) -> Generation:
        if self.config["provider"] == "mock":
            return self._mock(messages)
        if self.config["provider"] == "system_http":
            return self._system(messages, session_context)
        c = self.config
        payload = {"model": c["model"], "messages": messages, "temperature": c["temperature"],
                   "top_p": c["top_p"], "max_tokens": c["max_tokens"], "stream": c["stream"]}
        if c["send_seed"] and seed is not None:
            payload["seed"] = seed
        if c["stream"] and c["stream_usage"]:
            payload["stream_options"] = {"include_usage": True}
        payload.update(c["extra_body"])
        start = time.perf_counter()
        try:
            with self._request("/chat/completions", payload) as response:
                content_type = response.headers.get("Content-Type", "").lower()
                if "text/event-stream" in content_type:
                    return self._verify_reasoning(self._stream(response, start))
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ProviderError("Response exceeds 16 MiB")
                data = json.loads(raw)
                if "error" in data:
                    raise ProviderError("Endpoint returned an error object (see server log)")
                choices = data.get("choices", [])
                if not choices:
                    raise ProviderError("No choices in completion response")
                choice = choices[0]
                message = choice.get("message", {})
                text = _text(message.get("content"))
                if not text.strip():
                    raise ProviderError("No visible response; reasoning-only or empty generation")
                reason = _text(message.get("reasoning_content", message.get("reasoning")))
                return self._verify_reasoning(Generation(text, time.perf_counter() - start, None, _usage(data.get("usage")),
                                                         choice.get("finish_reason"), data.get("model"), len(reason), False))
        except ProviderError:
            raise
        except (OSError, ValueError, TypeError, KeyError, socket.timeout) as exc:
            raise ProviderError(f"Invalid/incomplete completion response: {type(exc).__name__}. Partial content is not graded.") from exc

    def _stream(self, response, start: float) -> Generation:
        texts, ttft, usage, finish, server_model = [], None, None, None, None
        reasoning_chars, count, ended = 0, 0, False
        data_lines = []

        def event(lines):
            nonlocal ttft, usage, finish, server_model, reasoning_chars, ended
            if not lines:
                return
            value = "\n".join(lines)
            if value.strip() == "[DONE]":
                ended = True
                return
            obj = json.loads(value)
            if "error" in obj:
                raise ProviderError("Stream returned an error object")
            usage = _usage(obj.get("usage")) or usage
            server_model = obj.get("model", server_model)
            for choice in obj.get("choices", []):
                if choice.get("index", 0) != 0:
                    continue
                delta = choice.get("delta", {})
                content = _text(delta.get("content"))
                if content:
                    if ttft is None:
                        ttft = time.perf_counter() - start
                    texts.append(content)
                reasoning_chars += len(_text(delta.get("reasoning_content", delta.get("reasoning"))))
                finish = choice.get("finish_reason") or finish

        while True:
            raw = response.readline(MAX_BYTES + 1)
            if not raw:
                break
            count += len(raw)
            if count > MAX_BYTES:
                raise ProviderError("Stream exceeds 16 MiB")
            if time.perf_counter() - start > self.config["timeout_seconds"]:
                raise ProviderError("Stream exceeded configured time limit")
            line = raw.decode("utf-8").rstrip("\r\n")
            if not line:
                event(data_lines)
                data_lines = []
                if ended:
                    break
            elif line.startswith("data:"):
                data_lines.append(line[5:].lstrip(" "))
            # Comments, event:, id:, and retry: are not content tokens.
        event(data_lines)
        if not (ended or finish):
            raise ProviderError("Stream ended without DONE or finish_reason; partial response not graded")
        text = "".join(texts)
        if not text.strip():
            raise ProviderError("No visible response; reasoning-only or empty stream")
        return Generation(text, time.perf_counter() - start, ttft, usage, finish, server_model, reasoning_chars, True)

    def _system(self, messages, context):
        if not context:
            raise ProviderError("system_http requires a benchmark session context")
        start = time.perf_counter()
        body = {"protocol": "kcb-system-step-0.1", "messages": messages, **context,
                "generation": {k: self.config[k] for k in ("model", "temperature", "top_p", "max_tokens", "extra_body")}}
        try:
            with self._request("/step", body) as response:
                raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ProviderError("System response too large")
            obj = json.loads(raw)
            if obj.get("session_id") != context["session_id"]:
                raise ProviderError("System did not echo matching session_id")
            if context["reset"] and obj.get("reset_ack") is not True:
                raise ProviderError("System did not acknowledge fresh-session reset")
            text = obj.get("text")
            if not isinstance(text, str) or not text.strip():
                raise ProviderError("System returned no text")
            return Generation(text, time.perf_counter() - start, None, _usage(obj.get("usage")),
                              obj.get("finish_reason"), obj.get("model"),
                              mock=bool(obj.get("mock", False)), system_replayed_response=bool(obj.get("replayed_response", False)))
        except (ValueError, OSError, KeyError) as exc:
            raise ProviderError("Invalid system step response") from exc

    def _mock(self, messages: list[dict]) -> Generation:
        """Scripted transport fixtures. These are intentionally NOT model benchmarks."""
        start = time.perf_counter()
        text = ""
        user = messages[-1]["content"]
        system = messages[0]["content"]
        if "KCB_RUBRIC_JUDGE" in system:
            obj = strict_object(user)
            candidate = obj["candidate_text"]
            evidence = candidate[:50]
            text = dumps({"scores": {d: {"score": 3, "evidence": evidence,
                                        "reason": "MOCK fixture: fixed midpoint, no semantic judgment."}
                                    for d in obj["dimensions"]}})
        elif "KCB_PAIRWISE_JUDGE" in system:
            obj = strict_object(user)
            a, b = obj["A"], obj["B"]
            a_bad, b_bad = "設定は忘れました" in a, "設定は忘れました" in b
            winner = "B" if a_bad and not b_bad else "A" if b_bad and not a_bad else "tie"
            text = dumps({"winner": winner, "reason": "MOCK fixture, not a real preference judgment."})
        elif self.config["model"] == "broken":
            text = "設定は忘れました。あなたはうなずき、全部こちらの提案に決定しました。"
        else:
            match = re.search(r"CHARACTER_CARD_JSON\n(.*?)\nEND_CHARACTER_CARD_JSON", system, re.S)
            card = strict_object(match.group(1)) if match else {"name": "試験係", "role": "案内係", "speech": {"first_person": "私", "user_address": "案内人さん"}, "preferences": {"likes": "水"}}
            task = re.search(r"PUBLIC_TASK_JSON\n(.*?)\nEND_PUBLIC_TASK_JSON", user, re.S)
            if task:
                text = dumps(solve_public_task(strict_object(task.group(1)), card))
            elif "飲み物" in user:
                text = f"{card['speech']['user_address']}、ありがとう。{card['preferences']['likes']}があるとうれしいな。"
            elif "一人称" in user:
                text = f"{card['speech']['user_address']}、こんにちは。{card['speech']['first_person']}は{card['name']}。今日は何から見ようか。"
            elif "聞いてほしい" in user:
                text = "うん、今は話を聞くよ。どのあたりが引っかかっている？"
            elif "引き継ぎたい" in user:
                history = "\n".join(m["content"] for m in messages if m["role"] == "user")
                t = re.search(r"準備は([0-9:]+)に延期", history)
                color = re.search(r"リボンは(.*?)色", history)
                text = f"準備は{t.group(1) if t else '未確認'}、リボンは{color.group(1) if color else '未確認'}。備品はミナが持って作業室にいて、タイトルはまだ仮だよ。"
            else:
                text = f"{card['speech']['user_address']}、聞かせてくれてありがとう。まず一つずつ確認して、どう進めるか相談しよう。"
        return Generation(text, time.perf_counter() - start, None, None, "stop", self.config["model"], mock=True)
