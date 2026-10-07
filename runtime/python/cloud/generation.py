"""Hosted Character Core jobs: durable reservations, private previews, screened commit."""

import asyncio
import json
from decimal import Decimal
from typing import Literal
from pydantic import Field, StrictBool
from python.api.chat import ChatRequest, _load_settings
from python.core.generation import generate_events
from python.core.prompt_compiler import compile_prompt
from python.core.schemas import GenerationOutputWithMemory, GenerationOutput
from python.storage import generations, memories
from python.providers.deepseek import DeepSeekProvider
from .contracts import ROUTES, TARIFF
from .meter import CostMeter, MeteredProvider, call_bound, MAX_OUTPUT
from .safety import SafetyGuard, POLICY, declared_sfw
from .store import CloudError, fingerprint
from .router import (GO_TARIFFS, select_model, operator_provider, public_route,
                     require_current_consent, safety_tariff, OPENROUTER_TARIFFS, or_provider)

CHARACTER_CONSTRAINTS = (
    "\nKeep the character's established voice, familiarity and speech style. "
    "Do not invent the user's past, work, feelings, expressions or actions. "
    "Only treat user facts stated in this conversation or saved memory as known. "
    "Roleplay your own character's actions; let the user choose theirs. "
    "If a user fact is missing, ask naturally or leave it open."
)


class CloudChat(ChatRequest):
    quote_id: str | None = Field(default=None, max_length=128)
    max_credits: int | None = Field(default=None, ge=0)
    session_id: str = Field(default="default", min_length=1, max_length=200)
    route_profile: Literal["auto", "structured", "contributor"] = "auto"
    contributor_training_consent: StrictBool = False


def public_result(result):
    return {
        k: v
        for k, v in result.items()
        if k
        in {
            "generation_id",
            "session_id",
            "status",
            "reply",
            "full",
            "state",
            "telemetry",
            "validation",
            "generation_config",
            "user_id",
            "assistant_id",
            "charged_credits",
            "error",
        }
    }


class CloudGenerations:
    def __init__(self, store, queue, sync, locks, transport=None):
        self.store, self.queue, self.sync, self.locks, self.transport = (
            store,
            queue,
            sync,
            locks,
            transport,
        )
        self.tasks = {}

    async def prepare(self, owner, req):
        if not self.store.config.inference_enabled:
            raise CloudError("inference_awaiting_acceptance", 503)
        if req.model_id not in ROUTES:
            raise CloudError("cloud_route_not_available")
        if (
            req.allow_nsfw
            or req.regenerate_message_id
            or not req.messages
            or len(req.messages) > 200
            or req.messages[-1].role != "user"
            or any(m.role not in {"user", "assistant"} for m in req.messages)
        ):
            raise CloudError("invalid_cloud_conversation")
        settings = await _load_settings(req.session_id)
        compiled = compile_prompt(
            character_id=settings.character_id,
            persona_id=settings.persona_id,
            world_id=settings.world_id,
            extra_system_prompt=req.system_prompt or settings.system_prompt,
            library_binding=settings.library_binding.model_dump()
            if settings.library_binding
            else None,
        )
        declared_sfw(compiled.model_dump())
        state = await generations.load_state(req.session_id, settings.model_dump())
        memory_ctx = scope = None
        if await memories.session_enabled(req.session_id):
            scope = memories.chat_scope(settings.character_id, settings.persona_id, req.session_id)
            memory_ctx = await memories.prepare(
                scope, "\n".join(m.content for m in req.messages[-2:])
            )
        snapshot = compiled.sections.get("portable_snapshot")
        if snapshot:
            from python.core.portable_prompt import compile_portable

            compiled = compile_portable(snapshot, [m.model_dump() for m in req.messages])
        screening = {
            "compiled": compiled.model_dump(),
            "state": state.model_dump(),
            "memory": memory_ctx,
            "messages": [m.model_dump() for m in req.messages],
        }
        config = self.store.config
        constraints = CHARACTER_CONSTRAINTS if config.operator_backend == "openrouter" else ""
        screening["character_constraints"] = constraints
        require_current_consent(self.store, owner)
        safety_provider = operator_provider(config, session=owner + ":" + req.session_id,
                                            transport=self.transport)
        screening_tariff = safety_tariff(config)
        model = ROUTES[req.model_id].model
        tariff = TARIFF
        if req.model_id == "cloud-standard":
            if config.operator_backend == "opencode-go":
                model = select_model(req.route_profile,
                    context_bytes=len(json.dumps(screening, ensure_ascii=False).encode()),
                    training_consent=req.contributor_training_consent,
                    region_approved=config.go_muse_region_approved)
                tariff = GO_TARIFFS[model]
            elif config.operator_backend == "openrouter":
                if req.route_profile == "contributor":
                    raise CloudError("cloud_route_profile_not_available")
                model = or_provider.DEEPSEEK
                tariff = OPENROUTER_TARIFFS[model]
            elif req.route_profile != "auto":
                raise CloudError("cloud_route_profile_not_available")
            provider = operator_provider(config, model=model,
                session=owner + ":" + req.session_id, transport=self.transport,
                training_consent=req.contributor_training_consent)
        else:
            if req.route_profile != "auto":
                raise CloudError("cloud_route_profile_not_available")
            key = self.store.secret(owner, "deepseek")
            if not key:
                raise CloudError("provider_key_not_configured", 503)
            provider = DeepSeekProvider(api_key=key, transport=self.transport)
        schema = (
            GenerationOutputWithMemory if memory_ctx is not None else GenerationOutput
        ).model_json_schema()
        bound_messages = [
            {
                "role": "system",
                "content": compiled.system_prompt
                + json.dumps(schema, ensure_ascii=False)
                + state.model_dump_json()
                + json.dumps(memory_ctx, ensure_ascii=False)
                + constraints
                + "x" * 1800,
            },
            *[m.model_dump() for m in req.messages],
        ]
        if compiled.ordered_messages:
            bound_messages.extend(compiled.ordered_messages)
        model_bound = call_bound(bound_messages, tariff=tariff)
        safety_size = (
            len(json.dumps(screening, ensure_ascii=False).encode()) + len(POLICY.encode()) + 128
        )
        if safety_size > 60_000:
            raise CloudError("cloud_context_too_large", 413)
        input_check = safety_size * screening_tariff.input_miss + 128 * screening_tariff.output
        # Output/state/proposed memories are screened together. Enforce this bound
        # before sending the safety request; reject oversized output without another call.
        output_check = 20_000 * screening_tariff.input_miss + 128 * screening_tariff.output
        cost = (
            input_check
            + output_check
            + (3 * model_bound if req.model_id == "cloud-standard" else 0)
        )
        body = req.model_dump(exclude={"stream", "generation_id", "quote_id", "max_credits"})
        return {
            "hash": fingerprint({"request": body, "snapshot": screening,
                "provider": config.operator_backend, "model": model,
                "tariff": tariff.version, "safety_tariff": screening_tariff.version}),
            "body": body,
            "cost": cost,
            "credits": TARIFF.credits(cost) if req.model_id == "cloud-standard" else 0,
            "compiled": compiled,
            "state": state,
            "memory": memory_ctx,
            "scope": scope,
            "screening": screening,
            "provider": provider,
            "model": model,
            "tariff": tariff,
            "safety_provider": safety_provider,
            "safety_tariff": screening_tariff,
            "temperature": req.temperature if req.temperature is not None else settings.temperature,
            "character_constraints": constraints,
        }

    async def quote(self, owner, req):
        prepared = await self.prepare(owner, req)
        q = self.store.quote(
            owner, prepared["hash"], prepared["credits"], prepared["cost"], req.model_id
        )
        return {
            "quote_id": q,
            "max_credits": prepared["credits"],
            "max_cost_usd": str(Decimal(prepared["cost"]) / 1_000_000_000),
            "expires_in": 120,
            "route": public_route(self.store.config, prepared["model"])
                if req.model_id == "cloud-standard" else ROUTES[req.model_id].public(),
            "tariff": prepared["tariff"].version,
            "includes": ["cache_miss", "three_attempts", "input_safety", "output_safety"],
        }

    async def start(self, owner, req):
        from python.storage.context import storage_context, CURRENT_STORAGE

        async with self.locks.setdefault(owner, asyncio.Lock()):
            with self.store.transaction() as db:
                existing = db.execute(
                    "SELECT * FROM operations WHERE owner=? AND id=?", (owner, req.generation_id)
                ).fetchone()
            if existing:
                # Core fingerprint stays stable even after the successful turn advances state.
                body = req.model_dump(
                    exclude={"stream", "generation_id", "quote_id", "max_credits"}
                )
                status = await generations.status(req.generation_id, req.session_id)
                import aiosqlite
                from python.storage import db as storage
                from python.storage.context import get_db_path

                async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as con:
                    row = await (
                        await con.execute(
                            "SELECT fingerprint,result_json FROM generations WHERE generation_id=?",
                            (req.generation_id,),
                        )
                    ).fetchone()
                if not row or row[0] != generations.fingerprint(body):
                    raise CloudError("generation_conflict", 409)
                if status["status"] == "pending":
                    task = self.tasks.get((owner, req.generation_id))
                    if task:
                        return task
                    raise CloudError("generation_pending", 409)
                future = asyncio.get_running_loop().create_future()
                recovered = public_result(json.loads(row[1] or "{}"))
                recovered["charged_credits"] = existing["charged_credits"]
                future.set_result(recovered)
                return future
            prepared = await self.prepare(owner, req)
            self.store.reserve(
                owner, req.generation_id, prepared["hash"], req.quote_id, req.max_credits
            )
            try:
                await generations.reserve(req.generation_id, req.session_id, prepared["body"])
            except BaseException:
                self.store.settle(owner, req.generation_id, 0, success=False)
                raise
            context = CURRENT_STORAGE.get()

            async def job():
                with storage_context(context):
                    return await self.run(owner, req, prepared)

            task = asyncio.create_task(job())
            self.tasks[(owner, req.generation_id)] = task
            task.add_done_callback(lambda t: self.tasks.pop((owner, req.generation_id), None))
            return task

    async def run(self, owner, req, prepared):
        meter = CostMeter(prepared["cost"])
        result = {"status": "failed", "reply": "", "full": "", "error": "generation_failed"}
        try:
            async with (
                self.queue.slot(self.store.entitlements(owner).queue_weight),
                self.locks[owner],
            ):
                guard = SafetyGuard(prepared["safety_provider"], tariff=prepared["safety_tariff"])
                await guard.check(prepared["screening"], meter=meter)
                provider = MeteredProvider(
                    prepared["provider"], meter, req.model_id == "cloud-standard",
                    tariff=prepared["tariff"],
                )
                async for event in generate_events(
                    provider,
                    model=prepared["model"],
                    messages=[m.model_dump() for m in req.messages],
                    compiled=prepared["compiled"],
                    state=prepared["state"],
                    requested={"temperature": prepared["temperature"], "max_tokens": MAX_OUTPUT},
                    generation_id=req.generation_id,
                    memory=prepared["memory"],
                    validation_error_budget=1024,
                    character_constraints=prepared["character_constraints"],
                ):
                    if event["type"] == "result":
                        result = event["result"]
                meter.close_pending()
                if meter.uncertain:
                    # Stop repairs/output screening after an unverifiable provider bill.
                    raise CloudError("provider_usage_unavailable", 503)
                if result["status"] != "completed":
                    raise CloudError("generation_validation_failed", 422)
                value = {
                    "reply": result["reply"],
                    "state": result["state"],
                    "memory": result.get("memory"),
                }
                if (
                    len(json.dumps(value, ensure_ascii=False).encode()) + len(POLICY.encode()) + 128
                    > 20_000
                ):
                    raise CloudError("safety_output_too_large", 413)
                await guard.check(value, meter=meter)
                meter.close_pending()
                result["cloud_accounting"] = {"cost": meter.total}
                # No raw attempts/prompts retained in hosted operations or debug responses.
                result = {
                    k: v
                    for k, v in result.items()
                    if k not in {"attempts", "raw_prompt", "compiled"}
                }
                from .backups import storage_usage
                from python.storage.context import get_db_path
                from python.storage import db as storage

                growth = (
                    len(json.dumps(result, ensure_ascii=False).encode()) * 4
                    + len(req.messages[-1].content.encode())
                    + 32_768
                )
                if (
                    storage_usage(get_db_path(storage.DB_PATH).parent) + growth
                    > self.store.entitlements(owner).storage_bytes
                ):
                    raise CloudError("cloud_storage_full", 413)
                result = await generations.finish(
                    req.generation_id,
                    result,
                    req.messages[-1].model_dump(),
                    req.model_id,
                    memory_scope=prepared["scope"],
                    memory_turn=prepared["state"].turn + 1,
                    evidence_text=req.messages[-1].content + "\n" + result["reply"],
                    cloud_revision=(self.store.path, owner),
                )
        except (Exception, asyncio.CancelledError) as exc:
            meter.close_pending()
            result = {
                "generation_id": req.generation_id,
                "session_id": req.session_id,
                "status": "cancelled" if isinstance(exc, asyncio.CancelledError) else "failed",
                "reply": "",
                "full": "",
                "error": exc.code if isinstance(exc, CloudError) else "generation_failed",
                "charged_credits": 0,
            }
            # Preserve a screened terminal failure for durable replay. A prior
            # explicit cancellation wins inside finish; no conversation is saved.
            result = await generations.finish(req.generation_id, result, None, req.model_id)
        success = result.get("status") == "completed"
        settlement = self.store.settle(owner, req.generation_id, meter.total, success=success,
            review_required=meter.uncertain)
        result["charged_credits"] = settlement["charged_credits"]
        return public_result(result)

    async def shutdown(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
