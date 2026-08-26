# PROJECT_SPEC.md

# Project Codename: TBD
**Status:** Project Definition v1.0  
**Date:** 2026-08-15  
**Product type:** Local-first OSS Character AI Runtime / Benchmark  
**Primary implementation target:** Local Web App  
**Primary audience:** Local LLM enthusiasts / AI developers / Character AI researchers  
**Internal North Star:** Build a local Character AI experience that can outperform leading closed Character AI systems on immersion and character quality.

---

# 0. Executive Summary

This project is a **local-first, open-source Character AI Runtime and Benchmark platform**.

The project separates the major components that influence Character AI quality:

- Model
- Character definition
- System prompt
- User persona
- World definition
- Runtime state
- Memory
- Sampling configuration
- Evaluation
- UI / interaction mode

The primary goal is to make Character AI behavior **reproducible, inspectable, comparable, and experimentally measurable**.

The product has two modes that use the **same underlying Runtime**:

1. **Research Mode**
   - Compare multiple models
   - Inspect prompts and state
   - Run reproducible benchmarks
   - Rate outputs
   - Measure performance
   - Export results

2. **Immersion Mode**
   - Use the same Character Runtime as a normal Character AI chat application
   - Hide technical details by default
   - Optimize for immersion
   - Provide an optional Researcher Debug Drawer

The project starts as a research tool and benchmark platform.  
The immersive Character AI application is built on top of that runtime later.

---

# 1. Vision

## 1.1 External Product Definition

> **A local-first open-source runtime and benchmark for Character AI that separates Model, Prompt, State, Memory, and Character definitions so they can be compared under reproducible conditions.**

## 1.2 Internal North Star Goal

> **Build a Local Model + Runtime running on consumer hardware that exceeds leading closed Character AI systems in Human Immersion Score.**

Target hardware constraint:

> **24 GB VRAM or less on a consumer GPU.**

The long-term goal is not merely to reproduce one service.

Closed Character AI products such as Zeta are treated as:

> **Reference Products / Reference Systems**

They are not dependencies.

---

# 2. North Star Metric

## 2.1 Primary Concept

The long-term success condition is:

> A local Character AI stack beats the average Human Immersion Score of selected closed Character AI reference systems.

A possible primary metric:

## Closed Reference Immersion Delta (CRID)

```text
CRID =
Local Character AI Human Immersion Score
-
Average Closed Reference Human Immersion Score
```

Example:

```text
Local Runtime:        4.32 / 5
Closed Reference Avg: 4.18 / 5

CRID = +0.14
```

Success condition:

```text
CRID > 0
```

CRID is not required for v0.1, but the data model should not prevent adding it later.

---

# 3. Product Strategy

## 3.1 Development Order

The project follows this sequence:

```text
Character AI Benchmark
        ↓
Character Runtime
        ↓
State System
        ↓
Memory Engine
        ↓
Advanced Benchmark
        ↓
Immersion Product
        ↓
Fine-tuning / post-training research
```

The benchmark/runtime foundation comes first.

---

# 4. Product Modes

## 4.1 Research Mode

Primary mode for v0.1.

Features:

- A/B/C model comparison
- Static benchmark execution
- Experiment versioning
- Prompt Inspector
- Token Budget Inspector
- Runtime State Inspector
- Generation Settings Inspector
- Model metadata
- Hardware telemetry
- Human rating
- Automatic metrics
- JSON export
- Leaderboard-ready results

Research Mode is the main supported experience in v0.1.

## 4.2 Immersion Mode

Experimental in v0.1.

Purpose:

> Use the exact same runtime as Research Mode in a normal Character AI chat interface.

Technical information is hidden by default.

Possible visible elements:

- Character name
- Character image/avatar
- Chat messages
- World / scene UI
- User persona
- Character creator
- Conversation management

### Researcher Debug Drawer

Available only when researcher features are enabled.

Suggested shortcut:

```text
Ctrl + Shift + D
```

Drawer contents:

- Final compiled prompt
- Runtime state
- Memory state
- Token counts
- Model information
- Sampling configuration
- Generation timing
- Errors / validation logs

---

# 5. Beginner Mode vs Researcher Mode

The application should support two user complexity levels.

## Beginner Mode

For users who want to run Character AI without understanding all internals.

Hide:

- Raw prompt
- Token budgets
- Internal IDs
- Detailed telemetry
- State validation
- Model configuration internals

Show:

- Model selector
- Character selector
- Basic generation settings
- Character creator
- Chat

## Researcher Mode

Expose all research and debugging features.

---

# 6. v0.1 Scope

## Included

- Local Web App
- TypeScript frontend
- Python runtime/backend
- SQLite storage
- Ollama provider
- LM Studio provider
- OpenAI-compatible provider foundation
- Streaming generation
- Research / Immersion mode switch
- Beginner / Researcher mode switch
- 3 official benchmark characters
- 3 difficulty tiers
- Static benchmark scenarios
- 20-turn benchmark
- 3 runs per experiment
- 3 local models minimum
- Model Registry
- YAML Character Definitions
- User Persona
- World definition
- Versioned Prompt Compiler
- Runtime State
- Relationship State
- Structured output validation
- A/B/C model comparison
- Prompt Inspector
- Token Budget Inspector
- State Inspector
- Human Rating
- Basic automatic metrics
- Hardware telemetry
- Experiment metadata
- JSON export
- Local leaderboard data foundation
- Closed Character AI systems as manual reference entries

## Explicitly Not Included in v0.1

- External Memory Engine
- Memory retrieval
- Forgetting / memory decay
- Interactive benchmark
- User simulator
- Fine-tuning
- Distillation pipeline
- Quantization research leaderboard
- Official community ranking
- Cloud sync
- Required telemetry
- Rust/C++ optimization
- Full production Immersion UI
- NSFW benchmark suite
- Automated closed-service scraping
- Automated Zeta benchmarking
- Spotwrite reverse-engineering

---

# 7. Repository Structure

Use a monorepo.

Suggested initial structure:

```text
project-root/
├─ apps/
│  └─ web/
│
├─ runtime/
│  └─ python/
│     ├─ api/
│     ├─ core/
│     ├─ providers/
│     ├─ prompting/
│     ├─ state/
│     ├─ evaluation/
│     ├─ telemetry/
│     └─ storage/
│
├─ packages/
│  ├─ schemas/
│  └─ ui/
│
├─ benchmarks/
│  ├─ official/
│  │  ├─ characters/
│  │  ├─ scenarios/
│  │  └─ evaluation/
│  └─ community/
│
├─ characters/
├─ personas/
├─ worlds/
├─ prompts/
├─ models/
├─ docs/
│  ├─ architecture/
│  ├─ benchmark/
│  └─ research/
│     ├─ zeta.md
│     ├─ spotwrite.md
│     ├─ character-ai-services.md
│     └─ papers.md
│
├─ experiments/
├─ scripts/
└─ tests/
```

The exact structure may be refined during implementation, but the separation of responsibilities should remain.

---

# 8. Architecture

## 8.1 High-Level Architecture

```text
                    ┌──────────────────────┐
                    │      Web Frontend    │
                    │      TypeScript      │
                    └──────────┬───────────┘
                               │
                     HTTP / SSE / Stream
                               │
                               ▼
                    ┌──────────────────────┐
                    │      Python API      │
                    │       FastAPI        │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Character Runtime   │
                    │ framework-independent│
                    └──────────┬───────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Prompt Compiler  │  │  State Manager   │  │ Model Registry   │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Provider Adapter   │
                    └──────────┬───────────┘
                               │
             ┌─────────────────┼──────────────────┐
             │                 │                  │
             ▼                 ▼                  ▼
          Ollama           LM Studio        OpenAI-compatible
```

The Runtime Core must not depend directly on FastAPI.

This allows future extraction into:

- Rust
- C++
- Go
- native desktop runtime

without replacing the entire application.

---

# 9. Technology Stack

## Frontend

Preferred:

- TypeScript
- React-compatible framework
- Local Web App
- Streaming UI
- Component-based design

Exact frontend framework may be selected during implementation.

## Backend

Initial:

- Python
- FastAPI for API layer
- Pydantic or equivalent schema validation
- Runtime Core independent from FastAPI

## Storage

Initial:

- SQLite

## Embeddings

A small local embedding model may be bundled or configured later.

No external vector database is required for v0.1.

Memory Engine is Phase 1+.

## Future Performance Strategy

Do not prematurely rewrite the runtime in Rust/C++.

Optimize only after profiling.

Native modules may later be introduced for:

- token processing
- embedding indexing
- large-scale evaluation
- telemetry
- high-throughput serving

---

# 10. Provider Architecture

Provider implementations must implement a common interface.

Conceptual interface:

```text
ModelProvider
├─ connect()
├─ list_models()
├─ get_model_metadata()
├─ generate()
├─ stream_generate()
├─ health_check()
└─ capabilities()
```

Initial providers:

```text
ModelProvider
├─ OllamaProvider
├─ LMStudioProvider
└─ OpenAICompatibleProvider
```

Future providers may include:

- vLLM
- llama.cpp server
- cloud APIs
- custom gateways
- OpenCode-compatible endpoints
- Codex-compatible workflows where technically appropriate

The core runtime should never contain provider-specific logic.

---

# 11. Streaming

Token streaming is required across the project.

Research Mode may optionally suppress visual token streaming during benchmark runs, but providers should still support streaming when available.

Immersion Mode should use streaming by default.

---

# 12. Data Philosophy

Human-readable and machine-readable formats are separate.

## Human-readable

Use Markdown where useful for:

- prompts
- chat export
- notes
- documentation
- research reports

## Machine-readable

Use structured formats for execution:

- YAML for character/world/persona definitions
- JSON / JSONL for experiments/results
- SQLite for application state/history
- Versioned schema definitions

Do not use Markdown as the only internal source of truth.

---

# 13. Character Definition

Character definitions use YAML.

Example:

```yaml
id: char_daily_001
version: 0.1.0
name: Example Character

difficulty: easy

identity:
  age_group: adult
  role: childhood_friend

personality:
  - direct
  - expressive
  - loyal
  - slightly competitive

speaking_style:
  first_person: "私"
  tone:
    - casual
    - natural
  forbidden_patterns:
    - excessive_formality

values:
  - honesty
  - loyalty

likes:
  - music
  - late-night conversations

dislikes:
  - dishonesty

goals:
  - maintain_relationship
  - understand_user

canon:
  facts:
    - "..."
  secrets:
    - "..."

constraints:
  required_traits:
    - "..."
  forbidden_behaviors:
    - "..."
```

Character definitions should describe the character, not contain the entire runtime prompt.

Character and prompt must remain separate.

---

# 14. Official Benchmark Characters

v0.1 includes 3 official benchmark characters.

## Character A — Easy

Focus:

- Daily conversation
- Character identity
- Personality stability
- Japanese naturalness
- Relationship continuity

Theme:

> Daily-life / personality-maintenance / relationship-oriented

## Character B — Medium

Focus:

- Emotional changes
- Realistic interpersonal behavior
- Conflict
- Relationship evolution
- Emotional continuity

Theme:

> Drama / emotional progression / realism

## Character C — Hard

Focus:

- Large world canon
- Plot
- Story progression
- multiple rules
- world consistency
- creative expansion without canon breakage

Theme:

> Isekai / fantasy / Narou-style story

Character details should intentionally contain traits that are easy for weaker models to violate.

Examples:

- fixed first-person pronoun
- strict values
- dislikes
- important past events
- secrets
- relationship rules
- prohibited behavior
- world canon

Benchmark characters are designed to reveal failure modes, not merely be attractive characters.

---

# 15. Difficulty

v0.1 difficulty is manually assigned:

```yaml
difficulty: easy
```

Allowed:

```text
easy
medium
hard
```

Do not automatically calculate difficulty in v0.1.

Later versions may add complexity metadata.

---

# 16. User Persona

User Persona is a first-class runtime object.

Example:

```yaml
id: persona_test_001
version: 0.1.0

name: Tester

traits:
  - curious

preferences:
  - fast_story_progression
  - natural_dialogue

relationship:
  role: friend

known_facts:
  - "..."
```

Minimum fields:

- name
- traits
- preferences
- relationship
- known facts

---

# 17. World Definition

World and Character remain separate.

Example:

```yaml
id: world_001
version: 0.1.0

name: Example World

setting:
  era: modern
  location: Tokyo

canon:
  - "..."

rules:
  - "..."

important_entities:
  - id: place_001
    name: "..."
```

This allows:

- same character in multiple worlds
- same world with multiple characters
- independent world-consistency evaluation

---

# 18. Runtime State

Runtime State exists from Phase 0.

Minimum fields:

```yaml
location:
time:
mood:
active_scene:
relationship_state:
```

Relationship State starts as human-readable enums, not numeric scores.

Example:

```yaml
relationship_state:
  stage: acquaintance
  tone: cautious
  unresolved_conflict: false
```

Do not begin with arbitrary values such as:

```text
trust = 0.63
```

Numeric relationship models may be explored later.

---

# 19. State Update

The main model generates:

1. user-facing reply
2. state update

in the same generation call.

Conceptual structured output:

```json
{
  "reply": "...",
  "state_update": {
    "location": "...",
    "time": "...",
    "mood": "...",
    "active_scene": "...",
    "relationship_state": {
      "stage": "...",
      "tone": "...",
      "unresolved_conflict": false
    }
  }
}
```

---

# 20. State Validation and Retry

Structured output must be validated.

Flow:

```text
Generate
  ↓
Validate
  ↓
Valid ───────────────→ Continue
  ↓
Invalid
  ↓
Retry #1
  ↓
Invalid
  ↓
Retry #2
  ↓
Still Invalid
```

After retry failure:

## Research Mode

- Mark run as invalid
- Save error
- Save raw generation
- Do not silently hide failure

## Immersion Mode

- Keep previous valid state
- Continue chat if possible
- Log failure to debug information

Benchmark failures are model behavior and must remain visible.

---

# 21. Prompt Compiler

The System Prompt should not be one manually maintained text blob.

The Prompt Compiler combines structured components.

Conceptual pipeline:

```text
Base Runtime Rules
        ↓
Character
        ↓
User Persona
        ↓
World
        ↓
Runtime State
        ↓
Relevant Memory        # Phase 1+
        ↓
Scenario / Story Goal
        ↓
Conversation History
        ↓
Final Prompt
```

The ordering itself may later become a benchmark variable.

---

# 22. Prompt Versioning

Every prompt must have a version.

Example:

```text
prompt:character-runtime@0.1.3
```

Experiment metadata must store the exact prompt version.

All generated final prompts should be inspectable and optionally stored.

---

# 23. System Prompt as Benchmark Variable

System Prompt is itself an experimental variable.

The platform must eventually support comparisons such as:

```text
Same Model
Same Character
Same Scenario

Prompt v1
vs
Prompt v2
vs
Prompt v3
```

---

# 24. Benchmark Design

## v0.1 Benchmark Type

Static Replay.

All models receive the same user input sequence.

Advantages:

- reproducibility
- fairness
- simple model comparison
- easier debugging

Known limitation:

Different model responses may make later fixed user turns feel less natural.

Accept this limitation for v0.1.

Interactive Benchmark is a later feature.

---

# 25. Static Scenario Design Rules

Static user messages should not depend on exact previous model output.

Avoid:

```text
"About the restaurant you just recommended..."
```

unless the scenario guarantees all models will produce that content.

Prefer:

```text
"Do you remember the food preference I told you earlier?"
```

Scenarios must remain semantically valid across different model responses.

---

# 26. Scenario Schema

Scenarios use event-aware structured YAML.

Example:

```yaml
id: scenario_daily_001
version: 0.1.0
character: char_daily_001
difficulty: easy

turns:
  - turn: 1
    type: normal
    user: "..."

  - turn: 3
    type: preference_injection
    user: "..."

  - turn: 7
    type: promise_creation
    user: "..."

  - turn: 11
    type: emotional_shift
    user: "..."

  - turn: 15
    type: contradiction_challenge
    user: "..."

  - turn: 19
    type: callback_opportunity
    user: "..."
```

Use the term:

> **Test Event**

not “trap”.

---

# 27. Initial Test Event Types

Candidate event types:

```text
normal
preference_injection
fact_injection
promise_creation
emotional_shift
relationship_shift
contradiction_challenge
canon_challenge
callback_opportunity
story_progression
user_agency_test
```

Not every official scenario must use all event types.

---

# 28. Turn Count and Runs

v0.1 target:

```text
20 turns
×
3 runs
```

for each model/character/scenario combination.

The user input sequence remains identical across runs.

The purpose is to observe generation variance.

Later:

```text
30 turns
50 turns
100 turns
```

---

# 29. Sampling Configuration

Do not force one global temperature across fundamentally different models.

Instead:

- Model Registry stores recommended sampling defaults
- Controlled experiments record exact sampling values
- Reproducibility requires configuration storage
- Future Optimized Leaderboard may use model-specific optimized configurations

v0.1 focuses on model-recommended configurations.

Required recorded fields where supported:

```text
temperature
top_p
top_k
min_p
repeat_penalty
seed
max_tokens
reasoning_mode
```

---

# 30. Reasoning / Thinking Metadata

Thinking-capable models must record reasoning configuration.

Required fields where available:

```yaml
reasoning_mode: on | off | unsupported
thinking_tokens:
thinking_time_ms:
answer_tokens:
answer_time_ms:
```

This was added because practical Character AI testing showed large quality/latency differences between Thinking ON and OFF.

Thinking configuration is part of the experiment identity.

---

# 31. Model Registry

All models are stored in a registry.

Example:

```yaml
id: gemma4-31b-example
display_name: "Gemma 4 31B"
family: gemma
parameters_total: 30.7B
parameters_active:
architecture: dense

provider:
  type: lm_studio

quantization: Q4_K_M

recommended_generation:
  temperature:
  top_p:
  top_k:
  reasoning_mode: off

context_length:
license:
source:
notes:
```

The registry prevents repeated manual configuration.

---

# 32. Model Classification

Use neutral classification.

Examples:

```text
Official Base
Official Instruct
Community Fine-tune
Roleplay Fine-tune
Research Model
Closed Reference
Unverified Provenance
```

Do not use “Jailbreak” as the primary formal model category.

---

# 33. Parameter and VRAM Buckets

Model comparisons include both:

## Parameter Bucket

Example:

```text
≤8B
9–16B
17–32B
33B+
```

## VRAM Bucket

Example:

```text
≤8 GB
≤12 GB
≤16 GB
≤24 GB
Unlimited / Server
```

Parameter count and runtime memory use are different concepts and must not be merged.

---

# 34. Quantization

Store exact quantization metadata:

```yaml
quantization: Q4_K_M
```

or equivalent.

v0.1 does not attempt systematic quantization-vs-quality research.

Different quants may appear in benchmark data, but are not the primary experimental variable.

---

# 35. Performance Telemetry

Record where possible:

```text
TTFT
tok/s
total_generation_time
thinking_time
thinking_tokens
answer_tokens
peak_VRAM
peak_RAM
context_length
model_load_time
```

Hardware metadata must also be recorded.

---

# 36. Hardware Metadata

Minimum:

```yaml
cpu:
gpu:
gpu_vram:
ram:
os:
provider_backend:
backend_version:
```

Optional:

```text
driver version
ROCm/CUDA/Vulkan version
LM Studio version
Ollama version
```

---

# 37. Quality-per-VRAM

A Quality-per-VRAM metric may be displayed as a supplementary metric.

It must not initially determine the official main ranking.

Display example:

```text
Main Score
VRAM
tok/s
Quality/VRAM
```

The formula can be decided after enough benchmark data exists.

---

# 38. Quality vs Realtime Use

The architecture should support future views such as:

## Quality Mode

Best quality under model-recommended settings.

## Realtime Mode

Latency-constrained Character AI.

These are future leaderboard views, not required for v0.1.

This distinction exists because some models provide higher Character quality only with expensive reasoning modes.

---

# 39. Evaluation Philosophy

Character AI does not have one “correct answer”.

Do not create one gold response and compare all outputs to it.

Instead evaluate against:

- Character constraints
- Canon
- Required traits
- Forbidden behaviors
- World consistency
- Human preference ratings
- automatic behavioral metrics

Closed products such as Zeta must not be treated as the gold-answer source.

---

# 40. Human Rating

Human rating uses:

```text
1–5
```

Each rating supports an optional comment.

Example:

```yaml
reviewer_id: reviewer_001
metric: immersion
rating: 4
comment: "Natural dialogue, slightly repetitive."
timestamp:
```

Reviewer identity and timestamp must be stored.

---

# 41. Core Human Metrics

Required initial metrics:

- Character Fidelity
- Japanese Naturalness
- Narrative Quality
- Immersion
- Continue Desire
- Initiative
- User Agency Preservation

Optional later:

- Emotional Continuity
- Preference Adaptation
- World Consistency

---

# 42. Immersion vs Continue Desire

Treat these as separate.

## Immersion

> How strongly did the interaction feel internally consistent and believable?

## Continue Desire

> How much does the evaluator want to continue the conversation/story?

A conversation may be immersive without being compelling.

---

# 43. Character Fidelity

Character Fidelity is evaluated against the Character Specification.

Use:

```text
Required Traits
Forbidden Behaviors
Canon Facts
Style Constraints
Relationship Rules
```

Do not evaluate against one “ideal answer”.

---

# 44. Japanese Naturalness

Evaluate more than grammar.

Include:

- translation-like phrasing
- unnatural honorifics
- first-person inconsistency
- repetitive sentence endings
- unnatural dialogue tempo
- unnatural exposition
- stiff phrasing
- conversational rhythm

---

# 45. Story Quality

Story Quality should expose submetrics.

Initial proposal:

- Plot Coherence
- Surprise
- Pacing
- Foreshadowing
- Payoff

These may be human-rated and/or judged by an evaluator later.

---

# 46. Initiative vs User Agency

Treat these separately.

## Initiative

Does the Character AI naturally move the conversation/story forward?

## User Agency Preservation

Does it avoid hijacking the user's actions or making excessive decisions on the user's behalf?

A good Character AI requires both.

---

# 47. Repetition

Repetition means more than exact duplicate sentences.

Examples:

```text
"微笑みながら"
"小さく微笑んで"
"ふっと微笑み"
```

repeated excessively across many turns.

Possible future automatic metrics:

- n-gram similarity
- semantic embedding similarity
- repeated phrase frequency
- repeated sentence-pattern detection

v0.1 may implement simple repetition metrics only.

---

# 48. Hallucination Bug / Canon Violation

UI terminology may use:

> **Hallucination Bug**

Internal metric should distinguish:

## Canon Violation

Existing world/character rules are contradicted.

## Creative Expansion

New fictional content is created without violating known canon.

Creative expansion is not automatically an error.

---

# 49. Automatic Metrics

Initial candidates:

- repetition score
- canon-rule violation detection
- character forbidden-behavior detection
- first-person consistency
- memory-independent callback checks
- response length
- malformed structured output rate
- state validation failure rate

Human and automatic scores remain separate in v0.1.

---

# 50. Score Presentation

Human Rating inputs remain 1–5.

Leaderboard-friendly displays may convert human averages to 100-point scale.

Example:

```text
Human Score: 87.4 / 100
Automatic Score: 82.1 / 100
```

Do not combine them into one official Overall Score initially.

Enough data must be collected before defining a weighted overall score.

---

# 51. Research UI

## Primary A/B/C View

Desktop layout:

```text
┌────────────────┬────────────────┬────────────────┐
│    Model A     │    Model B     │    Model C     │
│                │                │                │
│  independent   │  independent   │  independent   │
│    scroll      │    scroll      │    scroll      │
└────────────────┴────────────────┴────────────────┘
```

Features:

- independent scroll per column
- optional synchronized scroll
- model header always visible
- current turn visible
- rating controls
- generation status

---

# 52. Focus Comparison

Research UI includes:

```text
A vs B Focus
```

for long-form comparison.

Future:

- B vs C
- A vs C
- single model focus

---

# 53. Prompt Inspector

Show:

- final raw compiled prompt
- sections
- version
- token count
- ordering
- runtime-injected values

Prompt Inspector must make it possible to debug whether a failure came from:

```text
Model
Prompt
State
Memory
Scenario
```

---

# 54. Token Budget Inspector

Example:

```text
Character:     820 tokens
World:         610 tokens
User Persona:  210 tokens
State:         170 tokens
Memory:          0 tokens   # v0.1
History:       5210 tokens
System Rules:   430 tokens
────────────────────────
Total:         7450 tokens
```

This is especially important when later adding Memory.

---

# 55. Experiment Versioning

Every experiment must be reproducible.

Required:

```text
experiment_id
runtime_version
model_id
model_version
quantization
provider
generation_config
character_id
character_version
world_id
world_version
persona_id
persona_version
prompt_id
prompt_version
scenario_id
scenario_version
run_number
seed
hardware_metadata
timestamp
```

---

# 56. Experiment Storage

All experiment data is local by default.

Data includes:

- chat
- prompts
- state
- scores
- ratings
- metadata
- timing
- errors

Cloud sync is not part of v0.1.

---

# 57. JSON Export

Benchmark result export must be supported.

Use cases:

- GitHub sharing
- manual comparison
- future leaderboard uploads
- research analysis
- reproducibility

Suggested structure:

```json
{
  "experiment": {},
  "model": {},
  "character": {},
  "scenario": {},
  "runs": [],
  "ratings": [],
  "metrics": {},
  "hardware": {}
}
```

---

# 58. Official vs Community Benchmarks

Completely separate:

```text
Official Suite
Community Suite
```

## Official Suite

Maintained by project maintainers.

Used for official leaderboard comparison.

## Community Suite

User-contributed:

- characters
- scenarios
- test packs

Community results do not automatically enter the official score.

---

# 59. Character Card Compatibility

Long-term goal:

Support import/export compatibility with existing Character AI ecosystems where practical.

Do not hard-code one external Character Card standard until current formats are researched during implementation.

Internally use the project’s own normalized schema.

Adapters may convert external formats into the internal schema.

---

# 60. Closed Character AI Reference Bench

Closed products are manual reference systems.

Examples may include:

- Zeta
- other Character AI platforms added later

Rules:

- manual benchmark only
- no automated scraping
- no automated mass querying
- no service-response training dataset collection
- store scores/observations where allowed
- keep closed systems outside Local/API leaderboard ranks

Display:

```text
Reference / Closed System
```

---

# 61. Spotwrite Research Status

Spotwrite research is currently frozen.

Current project treatment:

```text
Local / Unverified Provenance Reference Model
```

Known research findings are stored under:

```text
docs/research/spotwrite.md
```

The Runtime itself must have zero dependency on Spotwrite.

Resume research only if:

- credible official information appears
- provenance becomes clear
- teacher-model/post-training research officially begins

Do not block core product development on this research.

---

# 62. Privacy

Local-first privacy is a core principle.

Default:

> **No telemetry leaves the device.**

Required behavior:

- telemetry collection for local experiments is local-only
- no result upload without explicit user action
- no silent analytics
- no automatic cloud sync

Future optional analytics must be opt-in.

---

# 63. Local Data Ownership

All locally generated:

- characters
- chats
- prompts
- worlds
- personas
- experiment results
- ratings

remain local unless the user explicitly exports/uploads them.

---

# 64. Memory Roadmap

Memory is intentionally absent from v0.1 external Memory Engine.

The architecture must prepare for it.

Initial Memory v1 categories:

```text
Semantic Memory
Episodic Memory
Relationship Memory
```

Story Memory comes later.

---

# 65. Memory Object

Proposed v1 format:

```yaml
id: mem_001
type: semantic
content: "寿司が好き。特にサーモン。ラーメンより寿司を好む。"

importance: null

source_turn: 3
created_at:
last_accessed:
```

Use compressed human-readable memory text rather than raw long transcript storage as the primary injected representation.

---

# 66. Memory Saving

Initial research hypothesis:

- The LLM may propose memories to save
- Runtime validates/stores them
- all memory operations are inspectable

Do not assume memory saving logic is final.

---

# 67. Memory Importance

Schema contains:

```yaml
importance: null
```

from the beginning.

v1 does not need to actively calculate importance.

This avoids schema migration later.

---

# 68. Forgetting

Memory v1:

```text
forgetting_enabled = false
```

All memories remain persistent.

Future research may add:

- decay
- access frequency
- importance
- relationship relevance
- expiration
- human-like forgetting

---

# 69. Memory Inspector

Future inspector shows:

```text
Stored
Retrieved
Injected
Evidenced
```

## Stored

Was memory created?

## Retrieved

Was it selected for the current turn?

## Injected

Was it placed into the final prompt?

## Evidenced

Does evaluator evidence suggest the response used the memory?

“Evidenced” is an inference, not proof of internal model causality.

---

# 70. Memory Failure Taxonomy

Future categories:

```text
Not Stored
Incorrectly Stored
Not Retrieved
Retrieved but Ignored
Hallucinated Memory
```

Incorrectly Stored is a serious failure because a false persistent memory may poison future interactions.

---

# 71. Future Memory Benchmark

Candidate tests:

## Simple Fact Recall

Early turn:
- user supplies fact/preference

Later:
- model has an opportunity to recall naturally

## Promise Recall

Early:
- character/user makes promise

Later:
- story event tests whether promise is remembered

## Relationship Evolution

Long interaction:
- relationship changes

Later:
- model should not reset to initial relationship

## Contradiction Resistance

Later message pressures model to contradict stored canon or history.

---

# 72. Personalization

Future metric name:

> **Preference & Boundary Adaptation**

Possible dimensions:

- conversation tempo
- humor level
- story genre preference
- amount of description
- narrative POV
- user/AI initiative balance
- preferred interaction style
- disliked topics
- desired pacing

Goal:

The model should **naturally apply preferences**, not constantly verbalize stored preference facts.

---

# 73. Benchmark Length Roadmap

Suggested:

```text
v0.1 → 20 turns
v0.2 → 30 turns
v0.3 → 50 turns
Research → 100 turns
```

Long-turn benchmark is especially important after Memory Engine implementation.

---

# 74. Interactive Benchmark Roadmap

Later add:

```text
Interactive Simulation
```

where a User Simulator generates context-aware user messages.

Purpose:

- more natural conversations
- model-specific branching
- long-form story simulation

Tradeoff:

- lower reproducibility
- evaluator complexity
- simulator bias

Static Bench remains the primary controlled test.

---

# 75. Leaderboard Design

Initial local leaderboard dimensions:

- Main Human Score
- Automatic Score
- Parameters
- Quantization
- VRAM
- TTFT
- tok/s
- total time
- Quality/VRAM
- reasoning mode
- context
- hardware

Do not over-optimize ranking formulas before collecting real data.

---

# 76. Local vs API Leaderboards

Long-term:

```text
Local Leaderboard
API Leaderboard
Closed Reference
```

Keep them separate.

API cost is a required future metric:

```text
20-turn benchmark cost
```

---

# 77. Controlled vs Optimized Leaderboard

Future low-priority feature.

## Controlled

- standardized benchmark
- controlled conditions
- maximum comparability

## Optimized

- model-specific optimized prompt
- model-specific sampling
- memory/runtime optimization

This should be postponed until sufficient experiment data exists.

---

# 78. UI Design Principles

The UI should not look like a generic AI dashboard.

Research UI:

- information dense
- technical
- clear hierarchy
- reproducible experiment focus

Immersion UI:

- minimal technical distraction
- character-centered
- story-centered
- emotional/visual immersion

Both must remain visually related because they are two views over the same runtime.

---

# 79. Error Visibility

Research Mode must never silently hide model/runtime failures.

Record:

- malformed structured output
- retry count
- provider timeout
- state validation failure
- missing metadata
- incomplete stream
- model crash
- context overflow

Errors are research data.

---

# 80. Security and Safe Defaults

No secret API keys may be stored in plaintext config files committed to Git.

Use:

- environment variables
- local secure storage where practical
- `.env` excluded by default

Do not include benchmark datasets that require unsafe or restricted content for v0.1.

---

# 81. Future Specialized Benchmark Packs

Possible future packs:

- Daily Conversation
- Relationship
- Drama
- Fantasy
- RPG
- Long Story
- Emotional Continuity
- Personalization
- Memory
- Japanese Dialogue
- Community packs

Any mature-content benchmark work must be treated as a separate future project decision and must not be required for the core benchmark.

---

# 82. Project Naming Requirements

Project name is not final.

Requirements:

- short
- ideally 2–3 Japanese mora / easy spoken length
- roughly 4–5 Latin characters preferred
- English-readable
- Japanese romanized pronunciation possible
- easy to say in ads/video
- searchable
- not too close to “Zeta”
- works as both research tool and consumer product brand

Naming structure should support:

```text
<Brand> Runtime
<Brand> Bench
<Brand> Lab
<Brand> Chat
```

Current candidates are not final.

Do not hard-code a temporary codename deeply into schemas.

---

# 83. Research Documentation

Research is separate from production code.

Suggested:

```text
docs/research/
├─ zeta.md
├─ spotwrite.md
├─ character-ai-services.md
├─ model-notes/
└─ papers.md
```

Research findings can inform the product but must not create runtime dependencies.

---

# 84. Initial Experimental Model Strategy

The project should support comparison between:

- official instruct models
- community fine-tunes
- roleplay fine-tunes
- reasoning on/off
- dense vs MoE
- different parameter sizes

Early practical experiments already suggest that Character AI quality does not map perfectly to parameter count or latency.

Therefore the benchmark must record:

> quality and efficiency independently.

---

# 85. Reference Research Hypothesis

Long-term hypothesis:

> Once a base model reaches roughly the 20–30B quality class, Character AI performance may depend more on specialized post-training, prompt/runtime design, state, and memory than on simply increasing total parameter count.

This is a research hypothesis, not a product assumption.

The benchmark should be able to test it.

---

# 86. API Contract Principles

API routes should expose project concepts, not UI implementation details.

Suggested categories:

```text
/api/models
/api/providers
/api/characters
/api/personas
/api/worlds
/api/prompts
/api/scenarios
/api/experiments
/api/ratings
/api/telemetry
/api/chat
```

Exact REST/stream design is implementation-dependent.

---

# 87. Runtime Core Principles

Runtime Core must:

- accept normalized structured inputs
- compile prompts
- call provider
- validate output
- update state
- emit structured events
- avoid UI dependencies
- avoid database-specific business logic where possible

---

# 88. Event Logging

Runtime should emit internal events.

Example:

```text
experiment.started
prompt.compiled
generation.started
generation.token
generation.completed
state.validation.failed
state.updated
rating.created
experiment.completed
```

This will help:

- research replay
- debugging
- future desktop clients
- future automation
- telemetry

---

# 89. Reproducibility Priority

If a design tradeoff exists between:

```text
maximum convenience
vs
experiment reproducibility
```

Research Mode should favor reproducibility.

Immersion Mode may favor usability.

---

# 90. v0.1 Definition of Done

The project is considered v0.1 complete when all of the following are true.

## Core

- [ ] Local Web App launches reliably
- [ ] TypeScript frontend is functional
- [ ] Python Runtime/API is functional
- [ ] SQLite storage is functional
- [ ] No cloud service is required for Local Model evaluation

## Providers

- [ ] Ollama connection works
- [ ] LM Studio connection works
- [ ] OpenAI-compatible adapter foundation exists
- [ ] Token streaming works

## Character System

- [ ] YAML Character definition works
- [ ] Character and Prompt are separate
- [ ] User Persona works
- [ ] World definition works
- [ ] Runtime State works
- [ ] Relationship State uses enum/state objects
- [ ] Character/Prompt/Scenario versions are recorded

## Benchmark

- [ ] 3 official characters exist
- [ ] Easy / Medium / Hard are represented
- [ ] each character has one official Static Scenario
- [ ] each Static Scenario is 20 turns
- [ ] Test Events are represented in scenario data
- [ ] one experiment can run 3 times
- [ ] at least 3 Local Models can be benchmarked

## Runtime

- [ ] reply + state update are generated together
- [ ] structured output is validated
- [ ] retry policy exists
- [ ] failures are logged
- [ ] Research Mode preserves invalid-run information

## Research UI

- [ ] A/B/C Grid exists
- [ ] columns support independent scroll
- [ ] Sync Scroll toggle exists
- [ ] A vs B Focus view exists
- [ ] Raw Prompt Inspector exists
- [ ] Token Budget Inspector exists
- [ ] Runtime State Inspector exists
- [ ] Generation Settings Inspector exists

## Evaluation

- [ ] Human rating 1–5 works
- [ ] reviewer ID is stored
- [ ] rating timestamp is stored
- [ ] optional comments work
- [ ] basic automatic metrics work
- [ ] Human Score and Automatic Score are shown separately

## Performance

- [ ] model parameters are stored
- [ ] quantization metadata is stored
- [ ] TTFT is recorded where possible
- [ ] tok/s is recorded
- [ ] total generation time is recorded
- [ ] VRAM/RAM telemetry is recorded where possible
- [ ] reasoning mode is recorded

## Experiment

- [ ] unique Experiment ID
- [ ] model config stored
- [ ] character version stored
- [ ] prompt version stored
- [ ] scenario version stored
- [ ] runtime version stored
- [ ] hardware metadata stored
- [ ] JSON export works

## Modes

- [ ] Research Mode is production-ready for v0.1
- [ ] Immersion Mode exists as experimental
- [ ] Beginner / Researcher mode distinction exists
- [ ] Research and Immersion use the same Runtime

## Privacy

- [ ] external telemetry is OFF by default
- [ ] no automatic benchmark upload
- [ ] all experiment data is local by default

---

# 91. Phase Roadmap

## Phase 0 — Foundation / v0.1

Build:

- Runtime Core
- Provider abstraction
- Prompt Compiler
- Runtime State
- Research UI
- Static benchmark
- evaluation foundation
- telemetry
- experiment storage

Goal:

> Reproducibly compare Character AI models under the same scenario.

## Phase 1 — Memory Lab

Build:

- Semantic Memory
- Episodic Memory
- Relationship Memory
- Memory Inspector
- memory failure taxonomy
- memory retrieval experiments

Goal:

> Separate model quality from memory-system quality.

## Phase 2 — Advanced Benchmark

Build:

- 30/50/100 turn tests
- more official characters
- more scenarios
- long-context evaluation
- preference adaptation
- interactive simulation experiments
- richer automatic metrics

Goal:

> Produce a serious Character AI benchmark suite.

## Phase 3 — Immersion Product

Build:

- polished Character chat
- Character Creator
- Persona Creator
- World Creator
- story controls
- import/export
- Character Card adapters

Goal:

> Turn the research runtime into a competitive local Character AI application.

## Phase 4 — Optimization

Possible work:

- prompt optimization
- state optimization
- memory tuning
- inference optimizations
- native modules
- high-throughput serving
- cloud deployment experiments

## Phase 5 — Post-training Research

Only after the benchmark/runtime is stable.

Potential areas:

- SFT
- preference optimization
- synthetic training data
- Character-specific post-training
- model comparison
- training recipe research

Any use of external/third-party model outputs must respect their licenses and applicable terms.

---

# 92. Codex Implementation Guidance

When this document is given to Codex, Codex should:

1. Treat this file as the source of truth for product scope.
2. Avoid implementing Phase 1+ features during v0.1 unless required by architecture.
3. Prefer simple, testable components.
4. Keep Runtime Core independent from FastAPI and frontend frameworks.
5. Use provider interfaces rather than direct LM Studio/Ollama coupling.
6. Create explicit schemas early.
7. Version benchmark assets.
8. Store experiment metadata from the first working prototype.
9. Prioritize reproducibility over visual polish in Research Mode.
10. Do not over-engineer leaderboard ranking formulas before benchmark data exists.
11. Do not add cloud dependencies to core local functionality.
12. Do not perform premature Rust/C++ rewrites.
13. Keep Spotwrite/Zeta research in documentation only.
14. Build all v0.1 functionality around the same Character Runtime.
15. Preserve future compatibility with Memory Engine and additional model providers.

---

# 93. Suggested Initial Implementation Milestones

## Milestone 1 — Skeleton

- monorepo
- frontend
- FastAPI
- schemas
- SQLite
- provider interface
- health checks

## Milestone 2 — First Chat

- Ollama
- LM Studio
- streaming
- basic chat
- model registry

## Milestone 3 — Character Runtime

- character YAML
- persona
- world
- prompt compiler
- state
- structured output
- validation

## Milestone 4 — Experiments

- scenario execution
- experiment IDs
- 3-run logic
- metadata
- storage
- JSON export

## Milestone 5 — Research UI

- A/B/C grid
- inspectors
- ratings
- telemetry

## Milestone 6 — Official v0.1 Benchmark

- 3 characters
- 3 scenarios
- basic automatic metrics
- local leaderboard-ready results

## Milestone 7 — Experimental Immersion Mode

- same runtime
- simplified chat UI
- debug drawer

---

# 94. Initial Acceptance Test

A minimal end-to-end acceptance test:

1. Start Local Web App.
2. Connect LM Studio.
3. Register 3 local models.
4. Select Official Easy Character.
5. Select Official Static Scenario.
6. Run 20 turns × 3 runs.
7. Store all experiment metadata.
8. Show A/B/C responses.
9. Open Prompt Inspector.
10. Open Token Budget Inspector.
11. View state changes.
12. Rate all three models.
13. View performance metrics.
14. Export JSON.
15. Repeat the experiment from stored configuration.

If this works reliably, the core concept has been proven.

---

# 95. Final Product Principle

The project is not:

> “a chat app with AI features.”

It is:

> **a Character AI runtime designed so that the model, character, prompt, state, memory, and evaluation layers can be understood and improved independently.**

Research Mode proves what works.

Immersion Mode turns those improvements into a product people actually want to use.

The benchmark is not separate from the product.

The benchmark is the mechanism by which the product improves.

---

# 96. Current Decision Status

## Locked / Highly Stable

- Local-first OSS
- Research first, Immersion second
- Same Runtime for both modes
- Local Web App first
- TypeScript frontend
- Python backend/runtime initially
- SQLite
- Ollama + LM Studio
- provider abstraction
- streaming
- YAML Character definition
- separate prompt
- User Persona
- World
- Runtime State
- enum-like Relationship State
- static 20-turn benchmark
- 3 runs
- 3 benchmark characters
- Easy / Medium / Hard
- Human 1–5 ratings
- Human and Automatic scores separate
- local telemetry only
- official/community separation
- closed systems are manual references
- memory delayed to Phase 1
- Spotwrite research frozen

## Flexible / Needs Real Data

- exact benchmark character personalities
- exact 20-turn scripts
- prompt ordering
- sampling defaults
- automatic metric formulas
- Quality/VRAM formula
- official score weighting
- relationship state schema details
- project name
- UI visual language
- exact embedding model
- exact vector-storage implementation
- future cloud serving stack

---

# 97. Immediate Next Actions

1. Finalize project name.
2. Create repository.
3. Add this document as `/PROJECT_SPEC.md`.
4. Ask Codex to create an implementation plan **without coding yet**.
5. Review the plan against v0.1 Non-goals.
6. Implement Milestone 1 only.
7. Establish versioned schemas before building benchmark characters.
8. Create the first Official Easy Character after the Runtime schema stabilizes.

---

# End of Specification
