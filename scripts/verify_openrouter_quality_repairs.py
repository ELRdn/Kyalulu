"""Exercise the runtime's bounded JSON-repair pattern on the same fixed routes.

Keep every failed raw output and cost. Only validated repaired responses enter
history/Memory Lab. This continues interrupted conversations; it doesn't restart
successful turns. The ledger still includes the earlier $0.05 cumulative cap.
"""

import argparse
import asyncio
from decimal import Decimal
import hashlib
import json
from pathlib import Path

import httpx
from dotenv import dotenv_values

import verify_openrouter_quality as quality
from python.storage import db, memories
from python.storage.context import CloudStorageContext, storage_context


def validation_errors(record):
    try:
        quality.GenerationOutputWithMemory.model_validate_json(record.get("output", ""))
    except ValueError as exc:
        if hasattr(exc, "errors"):
            return [{"location": list(e["loc"]), "message": e["msg"]} for e in exc.errors(include_input=False, include_url=False)]
        return [{"message": "invalid JSON"}]
    return []


async def repair_dialogue(run, client, profile, language, repetition):
    scope = f"strict:{profile[0]}:{language}:{repetition}"
    history = []
    def initial_state():
        return {"location": "Star Library", "time": "evening", "mood": "calm", "active_scene": "greeting",
                "relationship_state": {"stage": "acquaintance", "tone": "warm", "unresolved_conflict": False}}
    state = initial_state()
    for case in quality.conversation(language, repetition):
        base = f"strict-dialogue:{profile[0]}:{language}:r{repetition}:t{case['turn']:02d}"
        if case["new_session"]:
            history, state = [], initial_state()
        attempts = [r for r in run.data["requests"] if r["label"] == base or r.get("retry_of") == base]
        record = next((r for r in attempts if r["status"] == "passed"), None)
        if record is None:
            # HTTP/stream/cost failures remain non-retryable; repair only
            # completed final content that failed schema validation.
            if attempts and (attempts[-1].get("error") != "ValidationError" or attempts[-1].get("finish_reason") != "stop"):
                return
            memory = await memories.prepare(scope, case["user"])
            system = quality.persona(language) + "\nCurrent state: " + json.dumps(state, ensure_ascii=False) + memory["block"]
            system += "\nReturn the complete response object matching this schema, NOT the state object alone:\n"
            system += json.dumps(quality.GenerationOutputWithMemory.model_json_schema(), ensure_ascii=False)
            while len(attempts) < 3:
                number = len(attempts) + 1
                prompt = system
                if attempts:
                    prompt += "\nPrevious output failed validation: " + json.dumps(validation_errors(attempts[-1]), ensure_ascii=False)
                    prompt += "\nCorrect the output; keep reply first."
                label = base if number == 1 else base + f":repair-{number}"
                record = await quality.request(run, client, profile, label,
                    [{"role": "system", "content": prompt}, *history, {"role": "user", "content": case["user"]}],
                    {"phase": "conversation", "contract": "full-schema-v2", "candidate": profile[0], "language": language,
                     "repetition": repetition, **case, "state_before": state, "memory_block": memory["block"],
                     "memory_trace": memory["trace"], "attempt": number,
                     **({"retry_of": base} if number > 1 else {})})
                if record["status"] == "skipped":
                    return
                attempts.append(record)
                if record["status"] == "passed":
                    break
                if record.get("error") != "ValidationError" or record.get("finish_reason") != "stop":
                    return
            if record is None or record["status"] != "passed":
                return
        if not record.get("memory_committed"):
            result = {"generation_id": base, "status": "completed", "reply": record["reply"],
                      "memory": {**record["memory_trace"], "enabled": True,
                                 "proposals": record["parsed_output"]["memory_proposals"]}}
            await memories.commit(scope, result, session_id=scope + (":new" if case["turn"] >= 16 else ":old"),
                                  turn=case["turn"], evidence_text=case["user"])
            record.update(memory_trace=result["memory"], memory_committed=True)
            run.save()
        history.extend([{"role": "user", "content": case["user"]}, {"role": "assistant", "content": record["reply"]}])
        state = record["parsed_output"]["state_update"]


async def main(args):
    root = quality.ROOT
    if not args.execute:
        print("No inference. Reuse validated turns; repair only complete schema failures, at most three total attempts.")
        return
    key = dotenv_values(root / ".env.cloud-test.local").get("KYALULU_OPENROUTER_API_KEY")
    if not isinstance(key, str) or not key.strip():
        raise ValueError("OpenRouter key missing")
    run = quality.QualityRun(root / ".artifacts/openrouter-quality-2026-10-04", key, Decimal("0.05"),
                             root / ".artifacts/openrouter-live-2026-10-04/evidence.json")
    if not run.data.get("controls_completed"):
        raise RuntimeError("finish_controls_and_confirm_single_writer_first")
    fingerprint = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if run.data.get("repairs_fingerprint", fingerprint) != fingerprint:
        raise RuntimeError("repair_driver_changed")
    run.data["repairs_fingerprint"] = fingerprint
    context = CloudStorageContext.for_owner(run.directory / "strict-memory-fixture", run.data["controls_owner"])
    profiles = [p for p in quality.PROFILES if p[0] in ("ling", "deepseek", "glm")]
    async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=15), follow_redirects=False,
                               headers={"Authorization": "Bearer " + key, "User-Agent": "Kyalulu/0.1.0-beta.1"}) as client:
        with storage_context(context):
            await db.init_db()
            try:
                for repetition in (1, 2, 3):
                    for profile in profiles:
                        for language in ("ja", "en"):
                            await repair_dialogue(run, client, profile, language, repetition)
            except RuntimeError as exc:
                if str(exc) != "smoke_budget_exhausted":
                    raise
                run.data["stopped"] = "repairs_budget_exhausted"
            finally:
                run.data["account_after"] = await quality.account(client)
                run.save()
                print(json.dumps(quality.write_reviews(run), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    asyncio.run(main(parser.parse_args()))
