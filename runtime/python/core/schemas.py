"""M3 共通スキーマ (Pydantic) — Character / Persona / World / State"""

from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict

RelationshipLevel = Literal["stranger", "acquaintance", "friend", "intimate", "partner"]
Difficulty = Literal["easy", "medium", "hard"]

# Character
class CharacterCard(BaseModel):
    id: str = Field(description="character_id, e.g. mocha")
    version: str = Field(default="0.1.0", pattern=r"^\d+\.\d+\.\d+$")
    display_name: str
    description: str = ""
    species: str = ""  # 例: 猫の獣人
    age: str = ""  # 例: 22歳（文字列で自由）
    personality: str = ""  # 箇条書きや自由記述
    speaking_style: str = ""  # 口調
    intro: str = ""  # 初回挨拶 / 導入（空なら無し）
    tags: list[str] = Field(default_factory=list)
    difficulty: Difficulty = "easy"
    recommended_generation: dict = Field(default_factory=dict)  # {temperature, top_p}
    notes: str = ""
    nsfw: bool = False
    official: bool = False

# Persona (ユーザー側)
class PersonaCard(BaseModel):
    id: str
    version: str = Field(default="0.1.0", pattern=r"^\d+\.\d+\.\d+$")
    display_name: str
    description: str = ""
    # 例: "一般男性、優しい"
    traits: str = ""

# World
class WorldCard(BaseModel):
    id: str
    version: str = Field(default="0.1.0", pattern=r"^\d+\.\d+\.\d+$")
    display_name: str
    description: str = ""
    rules: str = ""  # 世界ルール

class RelationshipState(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    stage: RelationshipLevel
    tone: str
    unresolved_conflict: bool


class StateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    location: str
    time: str
    mood: str
    active_scene: str
    relationship_state: RelationshipState


class GenerationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    reply: str = Field(min_length=1)
    state_update: StateUpdate


# Server-owned identity/version fields are never supplied by the model.
class RuntimeState(BaseModel):
    session_id: str = "default"
    turn: int = 0
    relationship: RelationshipLevel = "stranger"
    last_summary: str = ""  # 要約（将来 Memory Labで拡張）
    character_id: str | None = None
    persona_id: str | None = None
    world_id: str | None = None
    prompt_version: str = "prompt:character-runtime@0.1.0"
    state_version: str = "0.1.0"
    location: str = ""
    time: str = ""
    mood: str = ""
    active_scene: str = ""
    relationship_state: RelationshipState = Field(default_factory=lambda: RelationshipState(
        stage="stranger", tone="neutral", unresolved_conflict=False))

# Prompt Compiler 出力
class CompiledPrompt(BaseModel):
    system_prompt: str
    ordered_messages: list[dict] = Field(default_factory=list)
    prompt_version: str = "prompt:character-runtime@0.1.0"
    character_version: str | None = None
    persona_version: str | None = None
    world_version: str | None = None
    token_estimate: int = 0
    sections: dict = Field(default_factory=dict)  # デバッグ用に各セクションを保持

# Scenario (M4)
ScenarioEventType = Literal[
    "normal",
    "preference_injection",
    "fact_injection",
    "promise_creation",
    "emotional_shift",
    "relationship_shift",
    "contradiction_challenge",
    "canon_challenge",
    "callback_opportunity",
    "story_progression",
    "user_agency_test",
]

class ScenarioTurn(BaseModel):
    turn: int = Field(ge=1, description="1-indexed")
    type: ScenarioEventType = "normal"
    user: str = Field(description="ユーザー発話")

class ScenarioCard(BaseModel):
    id: str
    version: str = Field(default="0.1.0", pattern=r"^\d+\.\d+\.\d+$")
    character: str | None = None  # 推奨キャラ
    difficulty: Difficulty = "easy"
    persona: str | None = None
    world: str | None = None
    description: str = ""
    turns: list[ScenarioTurn] = Field(min_length=1)
    nsfw: bool = False
    nsfw_level: Literal["innuendo", "explicit"] | None = None

# Experiment (M4/M6)
class ExperimentMeta(BaseModel):
    experiment_id: str
    runtime_version: str = "0.1.0"
    model_id: str
    model_version: str | None = None
    quantization: str | None = None
    provider: str | None = None
    generation_config: dict = Field(default_factory=dict)
    character_id: str | None = None
    character_version: str | None = None
    world_id: str | None = None
    world_version: str | None = None
    persona_id: str | None = None
    persona_version: str | None = None
    prompt_id: str | None = None
    prompt_version: str = "prompt:character-runtime@0.1.0"
    scenario_id: str
    scenario_version: str = "0.1.0"
    run_number: int = Field(ge=1)
    seed: int | None = None
    hardware_metadata: dict = Field(default_factory=dict)
    timestamp: str
    turns: int = 20
    status: str = "completed"
    nsfw: bool = False
    nsfw_level: str | None = None
    metrics: dict | None = None
    model_config_snapshot: dict = Field(default_factory=dict)
    scenario_snapshot: dict = Field(default_factory=dict)
    extra_system_prompt: str | None = None
    official: bool = False


class GenerationSettings(BaseModel):
    requested: dict
    applied: dict
    unsupported: list[str]


class GenerationValidation(BaseModel):
    ok: bool
    retries: int = Field(ge=0, le=2)
    errors: list[str]


class GenerationRecord(BaseModel):
    """Normal/invalid/failed result; cancellation is a separate diagnostic record."""
    generation_id: str
    status: Literal['completed', 'invalid', 'failed']
    reply: str
    full: str
    state_before: RuntimeState
    state: RuntimeState
    validation: GenerationValidation
    generation_config: GenerationSettings
    telemetry: dict
    elapsed_ms: float
    token_budget: dict
    attempts: list[dict]
    compiled: CompiledPrompt
    raw_prompt: str
    error: str | None
    mode: Literal['immersion', 'research']
