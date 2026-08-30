"""M4 Experiment Runner — 20turn × 3runs を逐次生成して experiments/ に保存"""

from __future__ import annotations
import json
import time
import platform
import pathlib
import yaml
from datetime import datetime, timezone

from .schemas import ScenarioCard, ExperimentMeta, RuntimeState
from .prompt_compiler import compile_prompt, CHAR_DIR, PERSONA_DIR, WORLD_DIR
from .state import infer_relationship
from python.core.registry import load_yaml_registry
from python.providers.factory import get_provider_for_model
from .metrics import compute_metrics

ROOT = pathlib.Path(__file__).resolve().parents[3]
SCENARIOS_DIR = ROOT / "scenarios"
EXPERIMENTS_DIR = ROOT / "experiments"

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

async def run_single(
    scenario: ScenarioCard,
    model_id: str,
    run_number: int = 1,
    seed: int | None = None,
    temperature: float | None = None,
    extra_system_prompt: str | None = None,
) -> tuple[ExperimentMeta, list[dict], str]:
    """
    1 run を実行。returns (meta, turns, raw_prompt)
    """
    cfg = _resolve_model_cfg(model_id)
    provider = get_provider_for_model(cfg)
    provider_cfg = cfg.get("provider", {}) if isinstance(cfg.get("provider"), dict) else {}

    # Character/Persona/World は scenario の指定を優先し、なければデフォルトなし
    character_id = scenario.character
    persona_id = scenario.persona
    world_id = scenario.world

    compiled = compile_prompt(
        character_id=character_id,
        persona_id=persona_id,
        world_id=world_id,
        extra_system_prompt=extra_system_prompt,
    )
    raw_prompt = compiled.system_prompt

    # generation config
    gen_cfg = {}
    if temperature is not None:
        gen_cfg["temperature"] = temperature
    elif cfg.get("recommended_generation"):
        gen_cfg.update(cfg.get("recommended_generation", {}))
    # fallback
    temp = float(gen_cfg.get("temperature", 0.8))

    # history は system + 会話を蓄積
    history: list[dict] = [{"role": "system", "content": raw_prompt}]
    turns_out: list[dict] = []
    state = RuntimeState(
        session_id=f"exp_{scenario.id}_{model_id}_run{run_number}",
        turn=0,
        relationship="stranger",
        character_id=character_id,
        persona_id=persona_id,
        world_id=world_id,
        prompt_version=compiled.prompt_version,
    )

    for t in sorted(scenario.turns, key=lambda x: x.turn):
        user_text = t.user
        history.append({"role": "user", "content": user_text})
        state.turn = t.turn
        state.relationship = infer_relationship(t.turn)

        start = time.time()
        # provider.generate は (prompt, messages, model, temperature) を取る
        try:
            assistant_text = await provider.generate(
                "", messages=history, model=provider_cfg.get("model"), temperature=temp
            )
        except Exception as e:
            assistant_text = f"[error: {e}]"
        elapsed_ms = int((time.time() - start) * 1000)

        history.append({"role": "assistant", "content": assistant_text})
        turns_out.append(
            {
                "turn": t.turn,
                "type": t.type,
                "user": user_text,
                "assistant": assistant_text,
                "elapsed_ms": elapsed_ms,
                "state": state.model_dump(),
                "prompt_version": compiled.prompt_version,
            }
        )

    # metrics
    metrics = compute_metrics(turns_out)

    # meta
    now = datetime.now(timezone.utc).isoformat()
    ts_file = datetime.now().strftime("%Y%m%d_%H%M%S")
    experiment_id = f"{scenario.id}__{model_id}__run{run_number}__{ts_file}"
    # model_version 等は yaml から取れる範囲で
    meta = ExperimentMeta(
        experiment_id=experiment_id,
        runtime_version="0.1.0",
        model_id=model_id,
        model_version=provider_cfg.get("model"),
        quantization=cfg.get("quantization"),
        provider=provider_cfg.get("type"),
        generation_config=gen_cfg,
        character_id=character_id,
        character_version=compiled.character_version,
        world_id=world_id,
        world_version=compiled.world_version,
        persona_id=persona_id,
        persona_version=compiled.persona_version,
        prompt_version=compiled.prompt_version,
        scenario_id=scenario.id,
        scenario_version=scenario.version,
        run_number=run_number,
        seed=seed,
        hardware_metadata=_hardware_meta(),
        timestamp=now,
        turns=len(scenario.turns),
        status="completed",
        nsfw=scenario.nsfw,
        nsfw_level=scenario.nsfw_level,
        metrics=metrics,
    )
    return meta, turns_out, raw_prompt

def save_experiment(meta: ExperimentMeta, turns: list[dict], raw_prompt: str) -> pathlib.Path:
    """experiments/<experiment_id>/ に保存"""
    out_dir = EXPERIMENTS_DIR / meta.experiment_id
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "meta.json").write_text(json.dumps(meta.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")
    # metrics.json（再計算用にも独立保存）
    metrics = meta.metrics or compute_metrics(turns)
    (out_dir / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    # jsonl
    with open(out_dir / "turns.jsonl", "w", encoding="utf-8") as f:
        for t in turns:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    (out_dir / "raw_prompt.txt").write_text(raw_prompt, encoding="utf-8")
    # also turns.json for convenience
    (out_dir / "turns.json").write_text(json.dumps(turns, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_dir

def list_experiments(limit: int = 50, include_nsfw: bool = False) -> list[dict]:
    if not EXPERIMENTS_DIR.exists():
        return []
    dirs = sorted([d for d in EXPERIMENTS_DIR.iterdir() if d.is_dir()], key=lambda p: p.name, reverse=True)
    out = []
    for d in dirs[:limit*2]:  # nsfwフィルタ分多めに読む
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
        if len(out) >= limit:
            break
    return out
