"""Hosted Character Core jobs: bounded operator spending and durable validated commit."""

import asyncio
import json
import time
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
from .safety import declared_sfw
from .store import CloudError, fingerprint
from .router import (GO_TARIFFS, select_model, operator_provider, public_route,
                     require_current_consent, OPENROUTER_TARIFFS, or_provider)
from .router import OPENROUTER_ROUTE_TARIFFS
from .model_choices import CHOICES

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
    provider_training_consent: StrictBool = False


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
            "reasoning_summary",
            "reasoning_summary_status",
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
        self.progress = {}

    async def prepare(self, owner, req):
        if not self.store.config.inference_enabled:
            raise CloudError("inference_awaiting_acceptance", 503)
        if req.model_id not in ROUTES:
            raise CloudError("cloud_route_not_available")
        if (
            req.allow_nsfw
            or not req.messages
            or len(req.messages) > 200
            or req.messages[-1].role != "user"
            or any(m.role not in {"user", "assistant"} for m in req.messages)
        ):
            raise CloudError("invalid_cloud_conversation")
        from python.storage import conversation
        messages = [m.model_dump() for m in req.messages]
        if getattr(req, "context_mode", "client") == "stored":
            if not req.history_revision:
                raise CloudError("history_revision_required", 409)
            try:
                messages = await conversation.resolve_messages(req.session_id, messages,
                    req.regenerate_message_id, req.history_revision)
            except generations.Conflict as exc:
                raise CloudError("history_revision_conflict", 409) from exc
            except ValueError as exc:
                raise CloudError("stored_context_budget_exceeded", 413) from exc
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
        if req.regenerate_message_id:
            import aiosqlite
            from python.storage.context import get_db_path
            from python.storage import db as storage
            async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
                tail = await (await db.execute("SELECT id,role FROM chat_history WHERE session_id=? ORDER BY id DESC LIMIT 1", (req.session_id,))).fetchone()
                prior = await (await db.execute("SELECT content FROM chat_history WHERE session_id=? AND role='user' AND id<? ORDER BY id DESC LIMIT 1", (req.session_id, req.regenerate_message_id))).fetchone()
            if not tail or tail[0] != req.regenerate_message_id or tail[1] != "assistant" or not prior or messages[-1]["content"] != prior[0]:
                raise CloudError("regeneration_conflict", 409)
            try:
                state = await generations.state_before(req.session_id, req.regenerate_message_id, settings.model_dump())
            except generations.Conflict as exc:
                raise CloudError('historical_state_unavailable', 409) from exc
        memory_ctx = scope = None
        try:
            pinned_scope = await memories.session_scope(settings.model_dump())
        except generations.Conflict as exc:
            raise CloudError("memory_scope_revision_conflict", 409) from exc
        if await memories.session_enabled(req.session_id):
            scope = pinned_scope
            memory_ctx = await memories.prepare(
                scope, "\n".join(m["content"] for m in messages[-2:]),
                exclude_after=(req.session_id, req.regenerate_message_id) if req.regenerate_message_id else None,
            )
        snapshot = compiled.sections.get("portable_snapshot")
        if snapshot:
            from python.core.portable_prompt import compile_portable

            compiled = compile_portable(snapshot, messages)
        # Retrieval duration is telemetry, not a change to the quoted content.
        screened_memory = {**memory_ctx, "trace": {k: v for k, v in memory_ctx["trace"].items()
                                                  if k != "retrieval_ms"}} if memory_ctx else None
        screening = {
            "compiled": compiled.model_dump(),
            "state": state.model_dump(),
            "memory": screened_memory,
            "messages": messages,
        }
        config = self.store.config
        constraints = CHARACTER_CONSTRAINTS if config.operator_backend == "openrouter" else ""
        screening["character_constraints"] = constraints
        require_current_consent(self.store, owner)
        model = ROUTES[req.model_id].model
        tariff = TARIFF
        billable = ROUTES[req.model_id].payer == "operator"
        if billable:
            if req.model_id in CHOICES and config.operator_backend != "openrouter":
                raise CloudError("cloud_route_not_available", 503)
            if config.operator_backend == "opencode-go":
                model = select_model(req.route_profile,
                    context_bytes=len(json.dumps(screening, ensure_ascii=False).encode()),
                    training_consent=req.contributor_training_consent,
                    region_approved=config.go_muse_region_approved)
                tariff = GO_TARIFFS[model]
            elif config.operator_backend == "openrouter":
                if req.route_profile == "contributor":
                    raise CloudError("cloud_route_profile_not_available")
                model = CHOICES[req.model_id]["model"] if req.model_id in CHOICES else or_provider.DEEPSEEK
                tariff = OPENROUTER_ROUTE_TARIFFS[req.model_id] if req.model_id in CHOICES else OPENROUTER_TARIFFS[model]
            elif req.route_profile != "auto":
                raise CloudError("cloud_route_profile_not_available")
            provider = operator_provider(config, model=model,
                session=owner + ":" + req.session_id, transport=self.transport,
                training_consent=req.contributor_training_consent, route_id=req.model_id)
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
                + json.dumps(screened_memory, ensure_ascii=False)
                + constraints
                + "x" * 1800,
            },
            *messages,
        ]
        if compiled.ordered_messages:
            bound_messages.extend(compiled.ordered_messages)
        model_bound = call_bound(bound_messages, output=getattr(provider, "max_output", MAX_OUTPUT), tariff=tariff)
        cost = 3 * model_bound if billable else 0
        if billable:
            # Bound generation by spendable credits without locking the wallet.
            wallet_budget = self.store.balance(owner) * 100_000 // TARIFF.markup
            input_bound = call_bound(bound_messages, output=0, tariff=tariff)
            affordable_output = (wallet_budget - input_bound) // tariff.output
            if affordable_output < 128:
                raise CloudError("insufficient_credits", 402)
            provider.max_output = min(getattr(provider, "max_output", MAX_OUTPUT), affordable_output)
            cost = min(3 * call_bound(bound_messages, output=provider.max_output, tariff=tariff), wallet_budget)
        body = req.model_dump(exclude={"stream", "generation_id", "quote_id", "max_credits", "provider_training_consent"})
        return {
            "hash": fingerprint({"request": body, "snapshot": screening,
                "provider": config.operator_backend, "model": model,
                "route_choice": CHOICES.get(req.model_id),
                "tariff": tariff.version, "safety_screening": False,
                "cost_limit": cost, "max_output": provider.max_output if billable else MAX_OUTPUT}),
            "body": body,
            "cost": cost,
            "credits": TARIFF.credits(cost) if billable else 0,
            "compiled": compiled,
            "messages": messages,
            "state": state,
            "memory": memory_ctx,
            "scope": scope,
            "screening": screening,
            "provider": provider,
            "model": model,
            "tariff": tariff,
            "temperature": req.temperature if req.temperature is not None else settings.temperature,
            "character_constraints": constraints,
        }

    async def quote(self, owner, req):
        prepared = await self.prepare(owner, req)
        q = self.store.quote(
            owner, prepared["hash"], prepared["credits"], prepared["cost"], req.model_id,
            provider_tariff=prepared["tariff"].version,
        )
        return {
            "quote_id": q,
            "max_credits": prepared["credits"],
            "max_cost_usd": str(Decimal(prepared["cost"]) / 1_000_000_000),
            "expires_in": 120,
            "route": public_route(self.store.config, prepared["model"], route_id=req.model_id)
                if ROUTES[req.model_id].payer == "operator" else {**ROUTES[req.model_id].public(), "safety": {"enabled": False}},
            "tariff": prepared["tariff"].version,
            "credit_tariff": TARIFF.version,
            "credit_reservation": False,
            "safety_screening": False,
            "max_output_tokens": getattr(prepared["provider"], "max_output", MAX_OUTPUT),
            "includes": ["cache_miss", "up_to_three_attempts_within_limit"]
                + (["reasoning_tokens"] if getattr(prepared["provider"], "reasoning_effort", None) else []),
        }

    async def start(self, owner, req):
        from python.storage.context import storage_context, CURRENT_STORAGE

        if CHOICES.get(req.model_id, {}).get("training") and not req.provider_training_consent:
            raise CloudError("provider_training_consent_required", 403)

        async with self.locks.setdefault(owner, asyncio.Lock()):
            with self.store.transaction() as db:
                existing = db.execute(
                    "SELECT * FROM operations WHERE owner=? AND id=?", (owner, req.generation_id)
                ).fetchone()
            if existing:
                # Core fingerprint stays stable even after the successful turn advances state.
                body = req.model_dump(
                    exclude={"stream", "generation_id", "quote_id", "max_credits", "provider_training_consent"}
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
            erasure_revision = await generations.erasure_revision()
            prepared = await self.prepare(owner, req)
            self.store.reserve(
                owner, req.generation_id, prepared["hash"], req.quote_id, req.max_credits,
                provider_tariff=prepared["tariff"].version,
            )
            try:
                await generations.reserve(req.generation_id, req.session_id, prepared["body"],
                                          expected_erasure_revision=erasure_revision)
                if CHOICES.get(req.model_id, {}).get("training"):
                    from .auth import provider_consent_version
                    prepared["provider_consent"] = {
                        "route_id": req.model_id, "quote_id": req.quote_id,
                        "version": provider_consent_version(self.store.config),
                        "training": True, "accepted_at": int(time.time()),
                    }
                    # Persist the explicit agreement before any provider communication.
                    async with generations.transaction() as db:
                        updated = await db.execute(
                            "UPDATE generations SET result_json=? WHERE generation_id=? AND status='pending' AND valid=1",
                            (json.dumps({"provider_consent": prepared["provider_consent"]}), req.generation_id),
                        )
                        if updated.rowcount != 1:
                            raise generations.Conflict("generation cancelled before consent was recorded")
            except generations.Conflict as exc:
                self.store.settle(owner, req.generation_id, 0, success=False)
                raise CloudError("generation_context_changed", 409) from exc
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
        started = previous = time.perf_counter()
        stages = {}
        phase = None
        def advance(stage):
            nonlocal previous, phase
            now = time.perf_counter()
            if phase:
                stages[phase] = round((now - previous) * 1000, 2)
            phase, previous = stage, now
            self.progress[(owner, req.generation_id)] = {"stage": stage, "elapsed_ms": round((now-started)*1000, 2)}
            while len(self.progress) > 128:
                self.progress.pop(next(iter(self.progress)))
        advance("queue")
        result = {"status": "failed", "reply": "", "full": "", "error": "generation_failed"}
        try:
            async with (
                self.queue.slot(self.store.entitlements(owner).queue_weight),
                self.locks[owner],
            ):
                advance("generation")
                provider = MeteredProvider(
                    prepared["provider"], meter, ROUTES[req.model_id].payer == "operator",
                    tariff=prepared["tariff"],
                )
                async for event in generate_events(
                    provider,
                    model=prepared["model"],
                    messages=prepared["messages"],
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
                if meter.provider_error:
                    raise CloudError(meter.provider_error, 503)
                if meter.uncertain:
                    # Stop additional calls after an unverifiable provider bill.
                    raise CloudError("provider_usage_unavailable", 503)
                if result["status"] != "completed":
                    raise CloudError("generation_validation_failed", 422)
                advance("save")
                result["cloud_accounting"] = {"cost": meter.total, "review_required": meter.uncertain}
                if "provider_consent" in prepared:
                    result["provider_consent"] = prepared["provider_consent"]
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
                if req.regenerate_message_id:
                    result["replace_message_id"] = req.regenerate_message_id
                result.setdefault("telemetry", {})["cloud_stages_ms"] = stages
                result = await generations.finish(
                    req.generation_id,
                    result,
                    req.messages[-1].model_dump(),
                    req.model_id,
                    memory_scope=prepared["scope"],
                    memory_turn=prepared["state"].turn + 1,
                    evidence_text=req.messages[-1].content,
                    cloud_revision=(self.store.path, owner),
                )
                stages["save"] = round((time.perf_counter()-previous)*1000, 2)
                result.setdefault("telemetry", {})["cloud_stages_ms"] = stages
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
                "cloud_accounting": {"cost": meter.total, "review_required": meter.uncertain,
                    "review_reason": meter.review_reason, "provider_error": meter.provider_error},
            }
            # Preserve a terminal failure for durable replay. A prior
            # explicit cancellation wins inside finish; no conversation is saved.
            if "provider_consent" in prepared:
                result["provider_consent"] = prepared["provider_consent"]
            result = await generations.finish(req.generation_id, result, None, req.model_id)
        success = result.get("status") == "completed"
        settlement = self.store.settle(owner, req.generation_id, meter.total, success=success,
            review_required=meter.uncertain, review_reason=meter.review_reason)
        result["charged_credits"] = settlement["charged_credits"]
        return public_result(result)

    async def shutdown(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
