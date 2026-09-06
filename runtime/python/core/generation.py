"""One generation pipeline for chat, SSE and experiments; no API/storage dependency."""
from __future__ import annotations

import asyncio
import json
import time
from copy import deepcopy
from uuid import uuid4

from .schemas import GenerationOutput, GenerationRecord, RuntimeState
from .telemetry import MemorySampler
from .prompt_compiler import _estimate_tokens


def reply_prefix(raw: str) -> str:
    """Decode only a top-level reply string, including incomplete escaped chunks."""
    decoder = json.JSONDecoder()
    pos = 0
    raw = raw.lstrip()
    if not raw.startswith("{"):
        return ""
    pos = 1
    try:
        while pos < len(raw):
            while pos < len(raw) and raw[pos] in " \r\n\t,":
                pos += 1
            key, pos = decoder.raw_decode(raw, pos)
            while pos < len(raw) and raw[pos].isspace():
                pos += 1
            if pos >= len(raw) or raw[pos] != ":":
                return ""
            pos += 1
            while pos < len(raw) and raw[pos].isspace():
                pos += 1
            if key != "reply":
                _, pos = decoder.raw_decode(raw, pos)
                continue
            if pos >= len(raw) or raw[pos] != '"':
                return ""
            start = pos + 1
            end = start
            while end < len(raw):
                c = raw[end]
                if c == '"':
                    break
                if c == "\\":
                    length = 6 if raw[end:end + 2] == "\\u" else 2
                    if end + length > len(raw):
                        break
                    end += length
                else:
                    end += 1
            value = json.loads('"' + raw[start:end] + '"')
            if value and 0xD800 <= ord(value[-1]) <= 0xDBFF:
                value = value[:-1]
            return value
    except (ValueError, IndexError):
        return ""
    return ""


def public_config(cfg: dict) -> dict:
    """Configuration snapshots never contain credentials or request headers."""
    allowed = {"id", "display_name", "quantization", "context_length", "parameters",
               "version", "recommended_generation", "reasoning", "provider"}
    result = {k: deepcopy(v) for k, v in cfg.items() if k in allowed}
    provider = result.get("provider")
    if isinstance(provider, dict):
        result["provider"] = {k: v for k, v in provider.items()
                              if k in {"type", "model", "structured_output", "supported_parameters"}}
    return result


async def generate_events(provider, *, model: str, messages: list[dict], compiled,
                          state: RuntimeState, requested: dict, mode: str = "immersion",
                          generation_id: str | None = None, journal: list | None = None):
    """Yield token/reset/result events. A result is NOT persisted until the caller commits."""
    generation_id = generation_id or str(uuid4())
    if compiled.sections.get('portable_snapshot'):
        from .portable_prompt import compile_portable
        compiled = compile_portable(compiled.sections['portable_snapshot'], messages)
    attempts = journal if journal is not None else []
    schema = GenerationOutput.model_json_schema()
    config = provider.generation_config({**requested, "model": model, "response_schema": schema})
    instruction = (
        '\nReturn exactly one JSON object with "reply" first and "state_update" second. '
        'reply is the user-facing response, never JSON or internal instructions. '
        'Update the current state conservatively from this conversation. Schema:\n'
        + json.dumps(schema, ensure_ascii=False)
        + '\nCurrent state:\n' + state.model_dump_json()
    )
    system = compiled.system_prompt + instruction
    from .portable_prompt import assemble_messages
    base = assemble_messages(compiled, messages, instruction)
    start = time.perf_counter()
    status, reply, error = "invalid", "", None
    next_state = state.model_copy(deep=True)
    first_chunk = first_reply = None
    try:
        async with asyncio.timeout(300), MemorySampler() as memory:
            for attempt_index in range(3):
                if attempt_index:
                    yield {"type": "reset", "full": "", "attempt": attempt_index + 1}
                prompt = deepcopy(base)
                if attempts:
                    prompt[0]["content"] += '\nPrevious output failed validation: ' + json.dumps(attempts[-1]["errors"], ensure_ascii=False) + '\nCorrect the output; keep reply first.'
                attempt = {"number": attempt_index + 1, "raw": "", "errors": [],
                           "elapsed_ms": 0, "usage": {}, "messages": prompt}
                attempts.append(attempt)
                attempt_start = time.perf_counter()
                displayed = ""
                received_complete_stream = False
                try:
                    async for event in provider.stream_events(
                            "", messages=prompt, **config["applied"]):
                        if event["type"] == "chunk" and first_chunk is None:
                            first_chunk = round((time.perf_counter() - start) * 1000, 2)
                        if event["type"] == "usage":
                            attempt["usage"].update(event["usage"])
                        elif event["type"] == "delta":
                            chunk = event["text"]
                            if chunk and first_chunk is None:
                                first_chunk = round((time.perf_counter() - start) * 1000, 2)
                            attempt["raw"] += chunk
                            preview = reply_prefix(attempt["raw"])
                            if preview and first_reply is None:
                                first_reply = round((time.perf_counter() - start) * 1000, 2)
                            if preview.startswith(displayed) and len(preview) > len(displayed):
                                yield {"type": "token", "token": preview[len(displayed):]}
                                displayed = preview
                    received_complete_stream = True
                    output = GenerationOutput.model_validate_json(attempt["raw"])
                    if not output.reply.strip():
                        raise ValueError("reply must not be blank")
                    reply = output.reply
                    next_state = state.model_copy(update={**output.state_update.model_dump(),
                        "relationship_state": output.state_update.relationship_state,
                        "relationship": output.state_update.relationship_state.stage,
                        "turn": state.turn + 1, "prompt_version": compiled.prompt_version,
                        "state_version": "0.2.0"})
                    status = "completed"
                    break
                except (ValueError, json.JSONDecodeError) as exc:
                    if not received_complete_stream:
                        raise
                    attempt["errors"] = [str(exc)]
                    reply = displayed or reply
                finally:
                    attempt["elapsed_ms"] = round((time.perf_counter() - attempt_start) * 1000, 2)
    except (asyncio.CancelledError, GeneratorExit):
        if attempts:
            attempts[-1]["errors"].append("cancelled")
        raise
    except Exception as exc:
        # Connection/auth/timeouts must not trigger another billable generation.
        status, reply, error = "failed", "", type(exc).__name__
        if attempts:
            attempts[-1]["errors"].append(error)
    elapsed = round((time.perf_counter() - start) * 1000, 2)
    usage = attempts[-1]["usage"] if attempts else {}
    output_tokens = usage.get("completion_tokens")
    duration = attempts[-1]["elapsed_ms"] if attempts else 0
    telemetry = {"ttft_ms": first_chunk, "first_reply_ms": first_reply, "elapsed_ms": elapsed,
        "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": output_tokens,
        "thinking_tokens": usage.get("thinking_tokens"),
        "tokens_per_second": round(output_tokens / (duration / 1000), 2) if output_tokens is not None and duration > 0 else None,
        "token_source": "provider" if output_tokens is not None else None,
        "unavailable_reason": None if output_tokens is not None else "provider did not report token usage",
        "speed_scope": "last_attempt_total_time_including_prefill",
        "peak_vram_bytes": None, "peak_ram_bytes": memory.peak,
        "memory_scope": "RAM: Python runtime process RSS; VRAM unavailable; not inference-server memory"}
    telemetry["unavailable"] = {key: "provider did not report this value" for key in
        ("prompt_tokens", "completion_tokens", "thinking_tokens") if telemetry[key] is None}
    telemetry["unavailable"]["peak_vram_bytes"] = "inference server VRAM sampler unavailable"
    result = {"generation_id": generation_id, "status": status, "reply": reply,
        "full": reply, "state_before": state.model_dump(), "state": next_state.model_dump(),
        "validation": {"ok": status == "completed", "retries": max(0, len(attempts) - 1),
                       "errors": [e for a in attempts for e in a["errors"]]},
        "attempts": attempts, "telemetry": telemetry, "elapsed_ms": elapsed,
        "generation_config": config, "compiled": compiled.model_dump(), "raw_prompt": json.dumps(base, ensure_ascii=False) if compiled.ordered_messages else system,
        "error": error, "mode": mode}
    result["token_budget"] = {"estimated": True, "method": "character-based approximation",
        "compiler_tokens": compiled.token_estimate, "runtime_contract_tokens": _estimate_tokens(instruction),
        "history_tokens": _estimate_tokens(json.dumps(messages, ensure_ascii=False)),
        "total_prompt_tokens": _estimate_tokens(json.dumps(base, ensure_ascii=False))}
    yield {"type": "result", "result": GenerationRecord.model_validate(result).model_dump()}
