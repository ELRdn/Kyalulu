"""M4 Experiment Runner — 20turn × 3runs を逐次生成して experiments/ に保存"""

from __future__ import annotations
import json
import platform
import pathlib
import os
import yaml
from datetime import datetime, timezone

from .schemas import ScenarioCard, ExperimentMeta, RuntimeState
from .prompt_compiler import compile_prompt, CHAR_DIR
from python.core.registry import load_yaml_registry
from python.providers.factory import get_provider_for_model
from .metrics import compute_metrics

ROOT = pathlib.Path(__file__).resolve().parents[3]
SCENARIOS_DIR = ROOT / "scenarios"
EXPERIMENTS_DIR = pathlib.Path(os.environ.get("KYALULU_EXPERIMENTS_DIR", str(ROOT / "experiments")))

def load_scenario(scenario_id_or_path: str) -> ScenarioCard:
    """id またはパスから ScenarioCard を読み込む"""
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
    models = load_yaml_registry()
    cfg = next((m for m in models if m.get("id") == model_id), None)
    if not cfg:
        raise ValueError(f"model {model_id} not found in models/*.yaml")
    return cfg

OFFICIAL_SCENARIOS = {"mocha_daily_001": "mocha_sfw", "senior_daily_001": "senior_cool", "butler_daily_001": "butler"}


async def run_single(scenario: ScenarioCard, model_id: str, run_number: int = 1,
                     seed: int | None = None, temperature: float | None = None,
                     extra_system_prompt: str | None = None, replay_config: dict | None = None,
                     compiled_snapshot: dict | None = None) -> tuple[ExperimentMeta, list[dict], str]:
    from uuid import uuid4
    from .generation import generate_events, public_config
    from .schemas import CompiledPrompt
    from .telemetry import hardware_metadata
    cfg = _resolve_model_cfg(model_id)
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
        official=(not scenario.nsfw and not extra_system_prompt and OFFICIAL_SCENARIOS.get(scenario.id) == scenario.character
                  and scenario == load_scenario(scenario.id)))
    save_experiment(meta, turns_out, compiled.system_prompt)
    for turn in sorted(scenario.turns, key=lambda t: t.turn):
        history.append({"role": "user", "content": turn.user})
        journal = []
        result = None
        try:
            async for event in generate_events(provider, model=provider_cfg["model"], messages=history,
                    compiled=compiled, state=state, requested=gen_cfg, mode="research", journal=journal):
                if event["type"] == "result":
                    result = event["result"]
        except BaseException:
            meta.status = "cancelled"
            turns_out.append({"turn": turn.turn, "type": turn.type, "user": turn.user,
                              "assistant": "", "status": "cancelled", "attempts": journal})
            meta.metrics = compute_metrics(turns_out)
            save_experiment(meta, turns_out, compiled.system_prompt)
            raise
        turns_out.append({**result, "turn": turn.turn, "type": turn.type, "user": turn.user, "assistant": result["reply"]})
        if result["status"] != "completed":
            meta.status = "invalid" if result["status"] == "invalid" else "failed"
            break
        state = RuntimeState.model_validate(result["state"])
        history.append({"role": "assistant", "content": result["reply"]})
        meta.metrics = compute_metrics(turns_out)
        save_experiment(meta, turns_out, compiled.system_prompt)
    if meta.status == "running":
        meta.status = "completed"
    meta.metrics = compute_metrics(turns_out)
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
    dirs = sorted([d for d in EXPERIMENTS_DIR.iterdir() if d.is_dir()], key=lambda p: p.name, reverse=True)
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
