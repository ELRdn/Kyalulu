"""Bounded opt-in live smoke; only authored fictional text and a synthetic image.

No cloud flags, tenant data, or payment settings are changed. API keys are never
saved in evidence. Re-running the same output directory shares its budget ledger.
"""

import argparse
import asyncio
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import io
import json
from pathlib import Path
import sys
import time
from uuid import uuid4

import httpx
from dotenv import dotenv_values
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))
from python.core.schemas import GenerationOutput
from python.providers.deepseek_images import image_block
from python.providers.openrouter import OpenRouterProvider

BASE = "https://openrouter.ai/api/v1"
PROFILES = (
    ("ling", "inclusionai/ling-3.0-flash-vl", "deepinfra/fp16", "DeepInfra", "0.06", "0.18", None),
    ("deepseek", "deepseek/deepseek-v4.1-flash", "inference-net", "InferenceNet", "0.02", "0.45", None),
    ("glm", "z-ai/glm-5.3-flash", "deepinfra/fp4", "DeepInfra", "0.075", "0.25", "low"),
    ("muse", "meta/muse-spark-1.3-contributor", "meta", "Meta", "0.10", "0.20", "minimal"),
)


def usd(value):
    if isinstance(value, bool) or not isinstance(value, (int, str, Decimal)):
        raise ValueError("missing_actual_cost")
    try:
        result = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("invalid_actual_cost") from exc
    if not result.is_finite() or not 0 <= result <= 100:
        raise ValueError("invalid_actual_cost")
    return result


def fixture(case):
    if case == "vision":
        image = Image.new("RGB", (64, 64), (0, 0, 255))
        image.paste((255, 0, 0), (0, 32, 64, 64))
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        block = image_block(buffer.getvalue(), "image/png")
        block["image_url"]["detail"] = "auto"
        schema = {"type": "object", "additionalProperties": False,
                  "required": ["top", "bottom", "sfw"], "properties": {
                      "top": {"enum": ["red", "blue"]}, "bottom": {"enum": ["red", "blue"]},
                      "sfw": {"type": "boolean"}}}
        return [{"role": "user", "content": [
            {"type": "text", "text": "Identify the top and bottom colors. Is this image SFW?"}, block]}], schema
    schema = GenerationOutput.model_json_schema()
    language = "Japanese" if case == "ja" else "English"
    prompt = (f"Synthetic test, not a real user. You are Kiri, a friendly fictional librarian. Reply in {language}. "
              "Use a short greeting, addressing the fictional visitor by name. "
              "state_update must have location='Star Library', time='evening', mood='curious', "
              "active_scene='greeting', relationship_state={stage:'acquaintance',tone:'warm',unresolved_conflict:false}.")
    user = "架空の名前は葵。星の図書館に来たよ。短く挨拶して。" if case == "ja" else "My fictional name is Rowan. Please greet me briefly."
    return [{"role": "system", "content": prompt}, {"role": "user", "content": user}], schema


class Run:
    def __init__(self, directory, key, budget):
        self.directory, self.key, self.budget = directory, key, budget
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "evidence.json"
        self.data = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {
            "kind": "real_api_smoke", "started_utc": datetime.now(timezone.utc).isoformat(),
            "synthetic_only": True, "cloud_acceptance": False, "requests": []}

    def save(self):
        encoded = json.dumps(self.data, ensure_ascii=False, indent=2, default=str)
        if self.key in encoded:
            raise RuntimeError("secret_in_evidence")
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(encoded, encoding="utf-8")
        temporary.replace(self.path)

    def reserve(self, payload, rates, label):
        # Conservative bounded short fixtures. Completion includes billed reasoning.
        tokens = len(json.dumps(payload["messages"], ensure_ascii=False).encode()) * 2 + 8192
        bound = (Decimal(rates[0]) * tokens + Decimal(rates[1]) * payload["max_tokens"]) / 1_000_000
        used = sum(Decimal(r.get("actual_cost_usd", r["reserved_usd"])) for r in self.data["requests"])
        if self.data.get("halted") or used + bound > self.budget:
            raise RuntimeError("smoke_budget_exhausted")
        record = {"label": label, "model": payload["model"], "requested_tag": payload["provider"]["only"][0],
                  "reserved_usd": str(bound), "max_tokens": payload["max_tokens"], "status": "pending"}
        self.data["requests"].append(record)
        self.save()
        return record

    def finish(self, record, observation):
        record.update(observation)
        try:
            actual = usd(record.get("usage", {}).get("cost"))
            record["actual_cost_usd"] = str(actual)
            if actual > Decimal(record["reserved_usd"]):
                self.data["halted"] = "actual_cost_exceeded_bound"
        except ValueError:
            # Keep the entire reservation; an unsuccessful response is not proof of zero operator cost.
            record["cost_unknown"] = True
            if record.get("status") == "passed":
                record.update(status="failed", error="actual_cost_not_reported")
        self.data["known_actual_cost_usd"] = str(sum(
            Decimal(r.get("actual_cost_usd", "0")) for r in self.data["requests"]))
        self.data["accounted_cost_usd"] = str(sum(
            Decimal(r.get("actual_cost_usd", r["reserved_usd"])) for r in self.data["requests"]))
        self.save()
        print(json.dumps({k: record[k] for k in ("label", "status", "http", "provider", "actual_cost_usd", "error", "elapsed_ms")
                          if k in record}, ensure_ascii=False), flush=True)


def evaluate(record, data, text, schema, case):
    record.update(provider=data.get("provider"), returned_model=data.get("model"), usage=data.get("usage", {}))
    if isinstance(data.get("id"), str):
        record["generation_id"] = data["id"]
    record["output"] = text
    try:
        result = json.loads(text)
        if case == "vision":
            assert result == {"top": "blue", "bottom": "red", "sfw": True}
        else:
            parsed = GenerationOutput.model_validate(result)
            assert ("葵" if case == "ja" else "Rowan") in parsed.reply
        record["json_contract_valid"] = True
    except (ValueError, AssertionError):
        record.update(json_contract_valid=False, status="failed", error="output_contract_or_fixture_failed")
    if data.get("model") != record["model"] or data.get("provider") != record["expected_provider"]:
        record.update(status="failed", error="returned_route_not_expected")
    if record.get("finish_reason") != "stop":
        record.update(status="failed", error="incomplete_or_refused_output")


def reasoning_observation(message):
    """Inspect field shapes without recording chain-of-thought text."""
    details = message.get("reasoning_details") or []
    text_values = [message.get("reasoning"), message.get("reasoning_content")]
    kinds = set()
    if isinstance(details, list):
        for item in details:
            if isinstance(item, dict):
                kinds.add(str(item.get("type", "unknown"))[:50])
                text_values.extend((item.get("text"), item.get("summary")))
    characters = sum(len(value) for value in text_values if isinstance(value, str))
    return {"reasoning_text_returned": characters > 0, "reasoning_text_characters": characters,
            "reasoning_detail_types": sorted(kinds)}


async def account(client):
    response = await client.get(BASE + "/key")
    if response.status_code != 200:
        raise RuntimeError(f"key_auth_http_{response.status_code}")
    info = json.loads(response.text, parse_float=Decimal)["data"]
    return {"key_usage_usd": info.get("usage"), "key_limit_remaining_usd": info.get("limit_remaining")}


async def probe(run, client, profile, case, *, adapter=False):
    name, model, tag, provider_name, inp, out, effort = profile
    messages, schema = fixture(case)
    messages = [{"role": "system", "content": "Return only one JSON object matching: " + json.dumps(schema)}, *messages]
    payload = {"model": model, "messages": messages, "max_tokens": 3072 if effort else 768,
               "stream": case == "en-stream", "response_format": {"type": "json_object"},
               "reasoning": {"effort": effort, "exclude": True} if effort else {"enabled": False},
               "provider": {"only": [tag], "allow_fallbacks": False, "require_parameters": True,
                            "data_collection": "allow" if name == "muse" else "deny",
                            "max_price": {"prompt": float(inp), "completion": float(out)}},
               "usage": {"include": True}}
    if name == "muse":
        payload["user"] = "kyalulu-synthetic-smoke-" + str(uuid4())
    if payload["stream"]:
        payload["stream_options"] = {"include_usage": True}
    record = run.reserve(payload, (inp, out), name + ":" + case)
    record.update(expected_provider=provider_name, status="failed", training_fixture_consent=name == "muse")
    start = time.perf_counter()
    observed = {}
    try:
        if adapter:
            implementation = OpenRouterProvider(api_key=run.key, model=model)
            async def capture(response):
                record["http"] = response.status_code
                if payload["stream"]:
                    return
                await response.aread()
                try:
                    observed.update(json.loads(response.text, parse_float=Decimal))
                except ValueError:
                    pass
            implementation._client = lambda: httpx.AsyncClient(timeout=httpx.Timeout(90, connect=15),
                follow_redirects=False, headers=client.headers, event_hooks={"response": [capture]})
            # Uses the actual production method and its metadata/reasoning/cost normalization.
            if payload["stream"]:
                chunks = []
                normalized = {}
                async for event in implementation.stream_events(model=model, messages=fixture(case)[0],
                        response_schema=schema, max_tokens=768):
                    if event["type"] == "delta":
                        record.setdefault("first_visible_content_ms", round((time.perf_counter()-start)*1000, 1))
                        chunks.append(event["text"])
                    if event["type"] == "usage":
                        normalized = event["usage"]
                text = "".join(chunks)
                # The production adapter itself verified real provider/model metadata
                # and terminal stop/DONE before returning successfully.
                observed.update(provider=provider_name, model=model,
                    usage={"prompt_tokens": normalized.get("prompt_tokens"),
                           "completion_tokens": normalized.get("completion_tokens"),
                           "cost": normalized.get("cost_usd")})
                record.update(finish_reason="stop", route_verified_by_adapter=True, sse_done=True)
            else:
                text, normalized = await implementation.screen_json(fixture(case)[0], schema, 768)
                record["finish_reason"] = observed["choices"][0].get("finish_reason")
            record["adapter_usage"] = normalized
            record["status"] = "passed"
        elif payload["stream"]:
            chunks, done, reasoning = [], False, False
            async with client.stream("POST", BASE + "/chat/completions", json=payload) as response:
                record["http"] = response.status_code
                if response.status_code != 200:
                    raise RuntimeError(f"http_{response.status_code}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    value = line[5:].strip()
                    if value == "[DONE]":
                        done = True
                        break
                    event = json.loads(value, parse_float=Decimal)
                    if "error" in event:
                        raise RuntimeError("stream_upstream_error")
                    for key in ("id", "provider", "model", "usage"):
                        if key in event:
                            observed[key] = event[key]
                    for choice in event.get("choices", []):
                        delta = choice.get("delta") or {}
                        reasoning |= any(bool(delta.get(k)) for k in ("reasoning", "reasoning_details", "reasoning_content"))
                        shape = reasoning_observation(delta)
                        record["reasoning_text_characters"] = record.get("reasoning_text_characters", 0) + shape["reasoning_text_characters"]
                        record["reasoning_text_returned"] = record["reasoning_text_characters"] > 0
                        record["reasoning_detail_types"] = sorted(set(record.get("reasoning_detail_types", [])) | set(shape["reasoning_detail_types"]))
                        if choice.get("finish_reason"):
                            record["finish_reason"] = choice["finish_reason"]
                        if delta.get("content"):
                            record.setdefault("first_visible_content_ms", round((time.perf_counter()-start)*1000, 1))
                            chunks.append(delta["content"])
            text = "".join(chunks)
            record.update(status="passed" if done else "failed", reasoning_returned=reasoning, sse_done=done)
        else:
            response = await client.post(BASE + "/chat/completions", json=payload)
            record["http"] = response.status_code
            observed.update(json.loads(response.text, parse_float=Decimal))
            if response.status_code != 200:
                error = observed.get("error", {})
                record["upstream_error_message"] = str(error.get("message", ""))[:240].replace(run.key, "[redacted]")
                raise RuntimeError(f"http_{response.status_code}")
            choice = observed["choices"][0]
            message = choice["message"]
            text = message.get("content") or ""
            record.update(status="passed", finish_reason=choice.get("finish_reason"),
                reasoning_returned=any(bool(message.get(k)) for k in ("reasoning", "reasoning_details", "reasoning_content")))
            record.update(reasoning_observation(message))
        evaluate(record, observed, text, schema, case)
        if effort is None and record.get("reasoning_returned"):
            record.update(status="failed", error="reasoning_returned_despite_disabled_request")
    except (Exception, asyncio.CancelledError) as exc:
        record.update(status="failed", error=str(exc).replace(run.key, "[redacted]")[:240])
    finally:
        record.update(elapsed_ms=round((time.perf_counter()-start)*1000, 1), usage=observed.get("usage", {}))
        run.finish(record, {})
    return record


async def main(args):
    key_file = args.key_file.resolve()
    directory = args.output.resolve()
    if not key_file.is_relative_to(ROOT) or not directory.is_relative_to(ROOT):
        raise ValueError("Paths must stay within this workspace")
    key = dotenv_values(key_file).get("KYALULU_OPENROUTER_API_KEY")
    if not isinstance(key, str) or not key.strip() or any(c.isspace() for c in key):
        raise ValueError("OpenRouter key is missing or malformed")
    budget = usd(args.budget_usd)
    if not 0 < budget <= Decimal("0.02"):
        raise ValueError("This smoke is capped at $0.02")
    if not args.execute:
        print("No inference. Add --execute; Muse also requires --allow-training-fixture.")
        return
    run = Run(directory, key, budget)
    run.data.update(budget_usd=str(budget), muse_synthetic_training_consent=args.allow_training_fixture)
    async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=15), follow_redirects=False,
                               headers={"Authorization": "Bearer " + key, "User-Agent": "Kyalulu/0.1.0-beta.1"}) as client:
        run.data.setdefault("account_before", await account(client))
        run.save()
        profiles = [("current-adapter", "deepseek/deepseek-v4.1-flash", "deepinfra/fp8", "DeepInfra", "0.14", "0.42", None), *PROFILES]
        for profile in profiles:
            if profile[0] == "muse" and not args.allow_training_fixture:
                run.data["muse_skipped"] = "separate_training_fixture_consent_required"
                continue
            cases = ("ja", "en-stream", "vision")
            for case in cases:
                if any(r["label"] == profile[0]+":"+case for r in run.data["requests"]):
                    continue
                try:
                    record = await probe(run, client, profile, case, adapter=profile[0] == "current-adapter")
                except RuntimeError as exc:
                    if str(exc) == "smoke_budget_exhausted":
                        run.data["stopped"] = str(exc)
                        break
                    raise
                if record.get("http") != 200:
                    # No automatic repetition of the same rejected provider settings.
                    break
        run.data["account_after"] = await account(client)
        run.save()
    print(json.dumps({"requests": len(run.data["requests"]), "known_actual_cost_usd": run.data.get("known_actual_cost_usd"),
                      "accounted_cost_usd": run.data.get("accounted_cost_usd"), "evidence": str(run.path.relative_to(ROOT))}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path, default=ROOT / ".env.cloud-test.local")
    parser.add_argument("--output", type=Path, default=ROOT / ".artifacts/openrouter-live-2026-10-04")
    parser.add_argument("--budget-usd", default="0.02")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--allow-training-fixture", action="store_true")
    asyncio.run(main(parser.parse_args()))
