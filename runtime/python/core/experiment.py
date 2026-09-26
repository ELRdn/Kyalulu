"""M4 Experiment Runner — 20turn × 3runs を逐次生成して experiments/ に保存"""

from __future__ import annotations
import json
import platform
import pathlib
import os
import yaml
from datetime import datetime, timezone
import asyncio

from .schemas import ScenarioCard, ExperimentMeta, RuntimeState
from .prompt_compiler import compile_prompt, CHAR_DIR
from python.core.registry import find_model
from python.providers.factory import get_provider_for_model
from .metrics import compute_metrics

ROOT = pathlib.Path(__file__).resolve().parents[3]
SCENARIOS_DIR = ROOT / "scenarios"
EXPERIMENTS_DIR = pathlib.Path(os.environ.get("KYALULU_EXPERIMENTS_DIR", str(ROOT / "experiments")))

def load_scenario(scenario_id_or_path: str) -> ScenarioCard:
    """id またはパスから ScenarioCard を読み込む"""
    if scenario_id_or_path.startswith("advanced_"):
        from .benchmark import advanced_scenario
        return advanced_scenario(scenario_id_or_path)
    p = pathlib.Path(scenario_id_or_path)
    if p.exists():
        data = yaml.safe_load(p.read_text(encoding="utf-8"))
    else:
        # id として探索
        cand = SCENARIOS_DIR / f"{scenario_id_or_path}.yaml"
        if not cand.exists():
            # scenarios/**/*.yaml を走査
            found = None
            for f in SCENARIOS_DIR.glob("*.yaml"):
                try:
                    d = yaml.safe_load(f.read_text(encoding="utf-8"))
                    if d.get("id") == scenario_id_or_path:
                        found = f
                        break
                except Exception:
                    continue
            if not found:
                raise FileNotFoundError(f"scenario {scenario_id_or_path} not found")
            cand = found
        data = yaml.safe_load(cand.read_text(encoding="utf-8"))
    from .prompt_compiler import _load_yaml
    character = _load_yaml(CHAR_DIR, data.get("character")) or {}
    data["nsfw"] = bool(data.get("nsfw") or character.get("nsfw"))
    return ScenarioCard.model_validate(data)

def _hardware_meta() -> dict:
    return {
        "platform": platform.platform(),
        "python": platform.python_version(),
    }

def _resolve_model_cfg(model_id: str) -> dict:
    cfg = find_model(model_id)
    if not cfg:
        raise ValueError(f"model {model_id} not found in models/*.yaml or LE")
    return cfg

OFFICIAL_SCENARIOS = {"mocha_daily_001": "mocha_sfw", "senior_daily_001": "senior_cool", "butler_daily_001": "butler"}


async def run_single(scenario: ScenarioCard, model_id: str, run_number: int = 1,
                     seed: int | None = None, temperature: float | None = None,
                     extra_system_prompt: str | None = None, replay_config: dict | None = None,
                     compiled_snapshot: dict | None = None,
                     memory: bool = False, memory_options: dict | None = None,
                     history_turn_limit: int | None = None,
                     progress=None) -> tuple[ExperimentMeta, list[dict], str]:
    """One run. With ``memory`` the run gets its own memory scope (``exp:<experiment_id>``),
    so runs never share memories; ``new_session`` turns reset history and state but keep memory."""
    from uuid import uuid4
    from python.storage import memories as memory_store
    from . import memory as memory_logic
    from .generation import generate_events, public_config
    from .schemas import CompiledPrompt, MemoryOptions
    from .telemetry import hardware_metadata
    cfg = _resolve_model_cfg(model_id)
    memory_options = MemoryOptions.model_validate(memory_options or {}).model_dump()
    if history_turn_limit is not None and not 1 <= history_turn_limit <= 100:
        raise ValueError("history_turn_limit must be 1..100")
    if replay_config:
        # Current connection/auth remains local; replay only non-secret recorded config.
        original_provider = cfg.get("provider", {})
        cfg = {**cfg, **replay_config, "provider": {**original_provider, **replay_config.get("provider", {})}}
    provider = get_provider_for_model(cfg)
    provider_cfg = cfg["provider"]
    compiled = CompiledPrompt.model_validate(compiled_snapshot) if compiled_snapshot else compile_prompt(
        character_id=scenario.character, persona_id=scenario.persona, world_id=scenario.world,
        extra_system_prompt=extra_system_prompt)
    gen_cfg = dict(cfg.get("recommended_generation") or {})
    gen_cfg.update(compiled.sections.get('generation_settings', {}))
    if temperature is not None:
        gen_cfg["temperature"] = temperature
    gen_cfg.setdefault("temperature", 0.8)
    if seed is not None:
        gen_cfg["seed"] = seed
    history, turns_out = [], []
    state = RuntimeState(session_id=str(uuid4()), character_id=scenario.character,
        persona_id=scenario.persona, world_id=scenario.world, prompt_version=compiled.prompt_version)
    meta = ExperimentMeta(experiment_id=str(uuid4()), model_id=model_id,
        model_version=provider_cfg.get("model"), quantization=cfg.get("quantization"), provider=provider_cfg.get("type"),
        generation_config=provider.generation_config(gen_cfg), character_id=scenario.character,
        character_version=compiled.character_version, persona_id=scenario.persona, persona_version=compiled.persona_version,
        world_id=scenario.world, world_version=compiled.world_version, prompt_version=compiled.prompt_version,
        scenario_id=scenario.id, scenario_version=scenario.version, run_number=run_number, seed=seed,
        hardware_metadata={**hardware_metadata(), "provider_backend": provider_cfg.get("type")},
        timestamp=datetime.now(timezone.utc).isoformat(), turns=len(scenario.turns), status="running",
        nsfw=scenario.nsfw, nsfw_level=scenario.nsfw_level,
        model_config_snapshot=public_config(cfg), scenario_snapshot=scenario.model_dump(), extra_system_prompt=extra_system_prompt,
        official=(not scenario.nsfw and not extra_system_prompt and not memory and history_turn_limit is None
                  and OFFICIAL_SCENARIOS.get(scenario.id) == scenario.character
                  and scenario == load_scenario(scenario.id)),
        memory_enabled=memory, memory_options=memory_options, history_turn_limit=history_turn_limit)
    scope = f"exp:{meta.experiment_id}"
    has_probes = memory or any(t.expect_recall or t.forbid_recall for t in scenario.turns)

    def metrics():
        m = compute_metrics(turns_out)
        if has_probes:
            m["memory"] = memory_logic.summarize(turns_out)
        return m

    save_experiment(meta, turns_out, compiled.system_prompt)
    if progress:
        await progress(meta, turns_out)
    for turn in sorted(scenario.turns, key=lambda t: t.turn):
        if turn.new_session:
            history = []
            state = RuntimeState(session_id=str(uuid4()), character_id=scenario.character,
                persona_id=scenario.persona, world_id=scenario.world, prompt_version=compiled.prompt_version)
        if history_turn_limit is not None:
            history = history[-history_turn_limit * 2:]
        context = "\n".join(m["content"] for m in history)
        history.append({"role": "user", "content": turn.user})
        journal = []
        result = None
        memory_ctx = stored_before = None
        try:
            if memory:
                stored_before = await memory_store.list_memories(scope)
                recent = [m["content"] for m in history][-2:]
                memory_ctx = await memory_store.prepare(scope, "\n".join(recent), **memory_options)
            async for event in generate_events(provider, model=provider_cfg["model"], messages=history,
                    compiled=compiled, state=state, requested=gen_cfg, mode="research", journal=journal,
                    memory=memory_ctx):
                if event["type"] == "result":
                    result = event["result"]
            if memory_ctx is not None:
                await memory_store.commit(scope, result, session_id=state.session_id, turn=turn.turn,
                                          evidence_text="\n".join(m["content"] for m in history) + "\n" + result["reply"])
        except BaseException as exc:
            meta.status = "cancelled" if isinstance(exc, (asyncio.CancelledError, GeneratorExit)) else "failed"
            turns_out.append({"turn": turn.turn, "type": turn.type, "user": turn.user,
                              "assistant": "", "status": meta.status, "attempts": journal,
                              "error": type(exc).__name__})
            meta.metrics = metrics()
            save_experiment(meta, turns_out, compiled.system_prompt)
            raise
        record = {**result, "turn": turn.turn, "type": turn.type, "user": turn.user, "assistant": result["reply"],
                  "new_session": turn.new_session}
        if turn.expect_recall or turn.forbid_recall:
            record["probe"] = memory_logic.probe(expect=turn.expect_recall, forbid=turn.forbid_recall,
                reply=result["reply"], context=context, stored=stored_before or [], trace=result.get("memory"))
        turns_out.append(record)
        compiled = CompiledPrompt.model_validate(result['compiled'])
        if result["status"] != "completed":
            meta.status = "invalid" if result["status"] == "invalid" else "failed"
            break
        state = RuntimeState.model_validate(result["state"])
        history.append({"role": "assistant", "content": result["reply"]})
        meta.metrics = metrics()
        save_experiment(meta, turns_out, compiled.system_prompt)
        if progress:
            await progress(meta, turns_out)
    if meta.status == "running":
        meta.status = "completed"
    meta.metrics = metrics()
    save_experiment(meta, turns_out, compiled.system_prompt)
    return meta, turns_out, compiled.system_prompt


def save_experiment(meta: ExperimentMeta, turns: list[dict], raw_prompt: str) -> pathlib.Path:
    """experiments/<experiment_id>/ に保存"""
    out_dir = EXPERIMENTS_DIR / meta.experiment_id
    out_dir.mkdir(parents=True, exist_ok=True)
    def write(name, content):
        temporary = out_dir / (name + '.tmp')
        temporary.write_text(content, encoding='utf-8')
        temporary.replace(out_dir / name)
    write('metrics.json', json.dumps(meta.metrics or compute_metrics(turns), ensure_ascii=False, indent=2))
    write('turns.jsonl', ''.join(json.dumps(t, ensure_ascii=False) + '\n' for t in turns))
    write('raw_prompt.txt', raw_prompt)
    write('turns.json', json.dumps(turns, ensure_ascii=False, indent=2))
    # Publish completion only once every result file has been written.
    write('meta.json', json.dumps(meta.model_dump(), ensure_ascii=False, indent=2))
    return out_dir

def list_experiments(limit: int = 50, include_nsfw: bool = False) -> list[dict]:
    if not EXPERIMENTS_DIR.exists():
        return []
    dirs = sorted([d for d in EXPERIMENTS_DIR.iterdir() if d.is_dir() and not d.name.startswith("_")], key=lambda p: p.name, reverse=True)
    out = []
    for d in dirs:  # nsfwフィルタ分多めに読む
        meta_path = d / "meta.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if not include_nsfw and meta.get("nsfw"):
                    continue
                out.append(meta)
            except Exception:
                out.append({"experiment_id": d.name, "error": "meta parse failed"})
        else:
            out.append({"experiment_id": d.name})
    return sorted(out, key=lambda m: m.get("timestamp", ""), reverse=True)[:max(0, limit)]
