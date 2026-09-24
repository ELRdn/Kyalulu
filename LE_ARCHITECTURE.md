# LE_ARCHITECTURE.md

> **Status:** Architecture Proposal v1  
> **Date:** 2026-09-24  
> **Project:** Kyalulu / LE  
> **LE meaning:** Kyalulu Local Engine / Local Execution Runtime  
> **Target license:** AGPL-3.0  
> **Primary upstream reference:** PurpleDoubleD/locally-uncensored (LU)  
> **Scope:** Local execution architecture, LU fork boundary, LE API v1, desktop lifecycle, media/voice/tools/agent/remote integration, cloud boundary, migration phases.

---

# 0. Executive Summary

Kyalulu is a **Character AI platform/runtime**.  
LE is the **local AI execution runtime** underneath it.

The architectural rule is:

> **Kyalulu owns character truth. LE owns execution.**

Kyalulu owns Character, Persona, World/Lore, Runtime/Relationship State, Memory, Timeline/Events, conversation semantics, prompt compilation, benchmark/evaluation, product UI, and cloud account/credit/billing policy.

LE owns LLM inference, model discovery/download/verification/load/unload, embeddings, GPU/VRAM/RAM detection and scheduling, image/video generation, image editing, STT/TTS, ComfyUI lifecycle, local process supervision, tool execution, MCP transport, agent jobs, remote transport primitives, local API auth, execution logs/jobs/events.

LE is **not** a renamed LU desktop application.

LE is a **headless fork-derived runtime** that extracts and restructures LU's non-UI execution stack for Kyalulu.

Recommended repository boundary:

```text
ELRdn/Kyalulu
    Character runtime / UI / research / product

ELRdn/LE
    AGPL fork-derived local execution runtime
    based in part on PurpleDoubleD/locally-uncensored

HTTP / SSE / WebSocket boundary between them
```

---

# 1. Product Boundary

## 1.1 Kyalulu

Kyalulu owns the semantic truth:

- Who is this character?
- What does this character know?
- What happened before?
- What is the current relationship?
- What world is active?
- Which memories should be retrieved?
- What should be sent to the model?
- Which tool result is safe to expose?
- What counts as canon?
- How is character quality benchmarked?

## 1.2 LE

LE owns execution:

- Which inference engines are available?
- Which models are installed?
- Can the model fit?
- How is it downloaded and verified?
- Which process/GPU should run it?
- How are tokens streamed?
- How are image/video workflows executed?
- How are STT/TTS executed?
- How are approved tools run?
- How are jobs queued/cancelled/observed?
- How are capabilities exposed through a stable local API?

## 1.3 Hard rule

LE must never become the canonical owner of:

- character personality
- relationship stage
- Kyalulu memory semantics
- story canon
- world state
- Kyalulu prompt templates
- Kyalulu account entitlements

It may receive derived execution requests containing those values, but it does not persist them as its own domain model.

---

# 2. High-Level Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         Kyalulu UI                          │
│              Web / Desktop / future Mobile                 │
└───────────────────────────┬─────────────────────────────────┘
                            │
                      Kyalulu API
                      FastAPI :8000
                            │
             ┌──────────────┴──────────────┐
             │                             │
             ▼                             ▼
┌────────────────────────┐      ┌────────────────────────────┐
│   Character Runtime    │      │       LE Client           │
│ Character / Persona    │      │  typed HTTP/SSE/WS client │
│ World / Lore           │      └────────────┬───────────────┘
│ State / Relationship   │                   │
│ Memory / Timeline      │                   ▼
│ Prompt Compiler        │      ┌────────────────────────────┐
│ Benchmark / Evaluation │      │      LE Headless API       │
└────────────────────────┘      │       Rust + Axum          │
                                └────────────┬───────────────┘
                                             │
        ┌──────────────────┬─────────────────┼──────────────────┬─────────────────┐
        │                  │                 │                  │                 │
        ▼                  ▼                 ▼                  ▼                 ▼
┌──────────────┐   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Inference   │   │    Media     │  │    Voice     │  │ Tools/Agent  │  │   Remote     │
│ llama.cpp    │   │ ComfyUI      │  │ Whisper/TTS  │  │ MCP/native   │  │ pairing/WS   │
│ Ollama       │   │ image/video  │  │ realtime     │  │ OpenClaw opt │  │ device events│
│ LM Studio    │   │ LoRA         │  │              │  │              │  │              │
└──────────────┘   └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
        │                  │                 │                  │
        └──────────────────┴─────────┬───────┴──────────────────┘
                                     ▼
                          ┌───────────────────────┐
                          │ Resource / Job Core   │
                          │ GPU / VRAM / queues   │
                          │ cancel / events / log │
                          └───────────────────────┘
```

---

# 3. Process Model

## 3.1 Desktop

```text
Kyalulu Desktop (Electron)
    ├── Kyalulu Python API
    └── LE daemon
```

Preferred path:

```text
Renderer
  ↓
Kyalulu FastAPI
  ↓
LE
```

The renderer should not require direct access to LE management credentials.

## 3.2 Development mode

- Web: localhost:5173 / 5174
- Kyalulu API: 127.0.0.1:8000
- LE: loopback-only configurable port
- LE management API requires authentication even on loopback

## 3.3 Port policy

Provisional default:

```text
LE_API_PORT=8130
```

Internal llama.cpp / ComfyUI ports are implementation details and should be dynamically allocated or managed by LE.

---

# 4. LE Internal Module Boundary

```text
le/
├── core/
│   ├── jobs
│   ├── events
│   ├── errors
│   ├── capabilities
│   ├── cancellation
│   └── audit
├── server/
│   ├── openai_api
│   ├── le_api
│   ├── auth
│   ├── cors
│   └── websocket_or_sse
├── inference/
│   ├── llama_cpp
│   ├── ollama
│   ├── lmstudio
│   ├── openai_compatible
│   └── embeddings
├── models/
│   ├── catalog
│   ├── discovery
│   ├── download
│   ├── verification
│   ├── storage
│   └── lifecycle
├── hardware/
│   ├── gpu
│   ├── memory
│   ├── compatibility
│   └── resource_scheduler
├── media/
│   ├── comfyui
│   ├── workflows
│   ├── image
│   ├── video
│   └── lora
├── voice/
│   ├── stt
│   ├── tts
│   └── realtime
├── tools/
│   ├── registry
│   ├── permissions
│   ├── mcp
│   ├── native
│   └── openclaw_adapter
├── agent/
│   ├── runs
│   ├── tool_loop
│   ├── background_jobs
│   └── approval_bridge
├── remote/
│   ├── pairing
│   ├── device_identity
│   ├── sessions
│   └── transport
└── secrets/
    └── os_keychain
```

This is a target architecture. Migration should be incremental.

---

# 5. LU Fork Strategy

## 5.1 Principle

Do **not** do this:

```text
copy src-tauri → rename LU to LE → delete React
```

LU backend behavior is split across Rust Tauri commands, TypeScript API modules, lifecycle logic, Zustand stores, and React/UI callers.

The first LE milestone is therefore a **headless extraction**, not a branding change.

## 5.2 KEEP / REFACTOR / DELETE

### KEEP / PORT FIRST

| LU area | LE target |
|---|---|
| `src-tauri/src/commands/engine.rs` | inference / llama.cpp lifecycle |
| `engine_sanity.rs` | engine health / diagnostics |
| `gpu.rs` | hardware detection |
| `download.rs` | model/media download core |
| `custom_models.rs` | local model inventory |
| `gguf.rs` | GGUF metadata |
| `process.rs` / `process_util.rs` | process lifecycle |
| `health.rs` | runtime diagnostics |
| `proxy.rs` | localhost backend transport |
| `local_api.rs` | API/auth/error-shape reference |
| `comfy_folders.rs` / `comfy_ws.rs` | ComfyUI integration |
| `video.rs` / `media_cmds.rs` | media execution |
| `tts.rs` / `whisper.rs` | voice primitives |
| `bg_tasks.rs` | job/background primitives |
| `cancel_registry.rs` | cancellation |
| `secret.rs` | OS secret-storage ideas |
| `os_paths.rs` / `os_error.rs` | cross-platform runtime support |
| `torch_wheels.rs` / install helpers | Python/Comfy install support |

TypeScript-side logic worth porting or translating:

| LU area | LE target |
|---|---|
| `src/api/model-bundles.ts` | model/media manifest data |
| `discover.ts` | discovery logic |
| `engine.ts` / `builtin-ensure.ts` | lifecycle orchestration |
| `lu-engine-switch.ts` | model switching semantics |
| `vram-handoff.ts` | resource scheduler reference |
| `comfyui.ts` | media adapter |
| `dynamic-workflow.ts` | workflow compiler |
| `comfyui-graph.ts` / nodes / ws | media transport |
| `rag.ts` | embedding reference |
| `voice.ts` | voice orchestration |
| `tool-capability.ts` / registry | tool capability ideas |
| `api/mcp/*` | MCP transport ideas |
| `api/agents/*` | agent execution ideas |

### REFACTOR BEFORE SHIPPING

| LU area | Required change |
|---|---|
| `src-tauri/src/state.rs` | replace Tauri app-global state with LE daemon state |
| `src-tauri/src/main.rs` | create headless binary entry |
| `remote.rs` | split transport/permissions from LU mobile UI |
| `agent.rs` | separate executor from LU product state |
| `filesystem.rs` / `shell.rs` / `search.rs` | put behind LE permission model |
| `trainer.rs` | retain only if Kyalulu needs local training |
| `downloadStore.ts` | move authoritative job state server-side |
| `createStore.ts` | separate UI state from render job state |
| `providerStore.ts` / `modelStore.ts` | daemon truth belongs to LE API |
| `permissionStore.ts` | daemon-enforced permissions |
| `remoteStore.ts` | client state only |
| `voiceStore.ts` | client state only |
| `localApiStore.ts` | obsolete as authority |

### DO NOT PORT AS LE DOMAIN

- LU React UI/design system
- LU chat conversation ownership
- LU personas
- LU general-assistant memory as Kyalulu truth
- LU benchmark/Compare UI
- LU Cloud account/auth/billing
- LU waitlist/sales funnel
- LU release-note UI
- LU-branded onboarding
- LU Cloud credits/catalog
- LU app updater UI
- LU Character/persona prompt semantics

---

# 6. API Design

Two surfaces:

1. `/v1/*` — ecosystem compatibility
2. `/le/v1/*` — LE lifecycle/capability management

## 6.1 OpenAI-compatible surface

```text
GET  /v1/models
POST /v1/chat/completions
POST /v1/embeddings
```

Future:

```text
POST /v1/responses
```

Stable IDs:

```text
le/qwen3.6-35b
ollama/qwen3.6
lmstudio/local-model-id
```

## 6.2 LE system

```text
GET /le/v1/version
GET /le/v1/health
GET /le/v1/capabilities
GET /le/v1/events
```

Events include:

- job state
- download progress
- model lifecycle
- engine state
- hardware changes
- media progress
- agent/tool execution
- remote device state

SSE is enough for v1; WebSocket can be added for bidirectional realtime control.

## 6.3 Model management

```text
GET    /le/v1/models
GET    /le/v1/models/{id}
POST   /le/v1/models/download
POST   /le/v1/models/load
POST   /le/v1/models/unload
DELETE /le/v1/models/{id}
```

Model states:

```text
not_installed
queued
downloading
verifying
ready
loading
loaded
unloading
failed
```

Partial downloads are never `ready`.

## 6.4 Hardware

```text
GET /le/v1/hardware
GET /le/v1/hardware/gpus
GET /le/v1/resources
```

Unknown values stay unknown. Never mislabel total VRAM as free VRAM.

## 6.5 Media

```text
POST /le/v1/images/generate
POST /le/v1/images/edit
POST /le/v1/images/upscale
POST /le/v1/videos/generate
POST /le/v1/videos/animate
```

LE receives high-level intent, not raw ComfyUI graphs.

## 6.6 Voice

```text
POST /le/v1/audio/transcriptions
POST /le/v1/audio/speech
```

Future:

```text
/le/v1/realtime
```

Realtime requires explicit cancellation and interruption.

## 6.7 Tools

```text
GET  /le/v1/tools
POST /le/v1/tools/invoke
```

Tool descriptor fields:

- id
- input schema
- output schema
- mutation class
- required permission
- source: native / MCP / OpenClaw
- timeout policy
- approval requirement

## 6.8 Agents

```text
POST   /le/v1/agents/run
GET    /le/v1/agents/runs/{id}
DELETE /le/v1/agents/runs/{id}
```

Agent mode is optional and not required for normal Character chat.

---

# 7. Job Model

Long operations become Jobs:

- model download
- model verification
- model load
- media render
- LoRA training
- background tool work
- agent run
- install/repair

States:

```text
queued
preparing
running
waiting_for_resource
waiting_for_approval
cancelling
completed
failed
cancelled
```

Every Job has:

```text
id
kind
state
created_at
started_at
finished_at
progress
resource_usage
error
request_id
parent_job_id?
```

Mutating calls should support idempotency keys.

---

# 8. Resource Scheduler

Recommended priority:

| Priority | Work |
|---|---|
| P0 | realtime voice interruption / active chat |
| P1 | foreground chat model load |
| P2 | embeddings / memory lookup |
| P3 | foreground image generation |
| P4 | video / training |
| P5 | maintenance |

Initial policy:

> One foreground text model remains sticky. Heavy media waits or asks to hand off resources.

Later:

- multi-GPU
- multiple model slots
- smarter preemption

---

# 9. Character + Media Flow

```text
User
  ↓
Kyalulu Character Runtime
  ↓
Kyalulu resolves visual/state/world context
  ↓
Kyalulu builds media request
  ↓
LE Media API
  ↓
ComfyUI adapter
  ↓
Image/video result
  ↓
Kyalulu decides whether result becomes conversation/canon
```

LE creates media.

Kyalulu decides what it means.

---

# 10. Tool / Agent Architecture

```text
Character Runtime
    ↓ proposes tool call
Kyalulu Tool Policy
    ↓ validates intent/context
LE Tool Registry
    ↓ checks permission
optional approval
    ↓
Executor
    ↓
structured result
    ↓
Kyalulu
    ↓
Character narrates result
```

A failed real-world action remains failed.

Suggested permission classes:

```text
read_public
read_user_selected
write_user_data
external_account_read
external_account_write
filesystem_read
filesystem_write
process_control
shell_execute
persistent_automation
admin
```

## OpenClaw

OpenClaw is an **optional adapter/reference**, not the Character Runtime.

```text
LE Tool Registry
    ├── Native LE tools
    ├── MCP tools
    └── OpenClaw adapter
```

Rules:

- never expose an OpenClaw operator secret to a Character model
- apply Kyalulu/LE policy before forwarding
- direct shell/filesystem mutation remains denied unless explicitly enabled
- audit delegated actions
- use OpenClaw Gateway as a reference for roles/scopes, events, device identity, cancellation, approvals and task/session control

---

# 11. Memory Boundary

Kyalulu Memory remains Kyalulu-owned.

LE may provide:

- embeddings
- vector primitives
- optional local indexing

Kyalulu decides:

- Semantic / Episodic / Relationship memory
- provenance
- corrections
- forgetting
- retrieval
- prompt budget
- benchmark metrics

---

# 12. Desktop Lifecycle

Startup:

```text
1. Electron starts
2. acquire single-instance lock
3. start/supervise LE
4. GET /le/v1/health
5. start/supervise Kyalulu Python API
6. Python connects to LE and queries capabilities
7. open renderer
8. UI shows actual local capability state
```

Shutdown:

```text
1. stop new foreground work
2. cancel cancellable jobs
3. persist Kyalulu state
4. stop Kyalulu API
5. stop child LE if Kyalulu owns it
6. leave external LE alive if configured
```

Crash recovery:

- detect orphan child processes
- never blindly kill unrelated llama.cpp/ComfyUI
- track child PID/identity
- bounded diagnostics
- interrupted jobs remain interrupted, not completed

---

# 13. Remote / Mobile Direction

LE binds loopback by default.

Preferred future path:

```text
Kyalulu Mobile
      ↓ authenticated Kyalulu remote protocol
Kyalulu Desktop / Remote Gateway
      ↓
Kyalulu Runtime
      ↓
LE
```

Mobile clients should not receive LE admin authority.

Borrow from OpenClaw:

- pairing
- device identity
- scoped roles
- reconnect/event history
- approvals
- node health

---

# 14. Cloud Boundary

```text
                 Kyalulu Runtime
                  Provider Layer
                 /                      LE Local Provider     Kyalulu Cloud Provider
             │                       │
      own user hardware        hosted inference
```

Public cloud API/account/credits/billing are **not part of LE**.

Do not port LU Cloud billing/waitlist/entitlements into LE.

Product rule:

> Character identity, memory portability and local ownership are product assets. Compute is the metered service.

---

# 15. Security Requirements

## Local API

Default:

- loopback only
- auth required
- CORS disabled
- explicit allowlist if needed
- request IDs
- bounded requests
- structured errors

## Downloads

```text
request
↓
staging path
↓
stream download
↓
length/hash verification
↓
license/metadata record
↓
atomic promote to ready
```

## Tools

- validate schemas
- filesystem path jail where practical
- separate read/write permissions
- separate shell permission
- approval for sensitive mutation
- timeout
- cancellation
- audit
- model output is never authorization

## Secrets

Provider/API keys belong in OS-backed secret storage where supported.

Never persist secrets in Character cards, prompts, tool results, logs or chat exports.

---

# 16. Licensing / Attribution

Intent:

- Kyalulu: AGPL-3.0
- LE: AGPL-3.0
- LU upstream: AGPL-3.0-only

LE preserves upstream copyright/license notices.

Track third-party licenses separately:

- llama.cpp
- ComfyUI
- PyTorch/runtime packages
- image/video model weights
- LoRAs
- STT/TTS models
- external models

Recommended files:

```text
THIRD_PARTY_NOTICES.md
MODEL_LICENSES.json
UPSTREAM.md
```

`UPSTREAM.md` records LU source, fork base, imported areas, divergence and cherry-picked fixes.

---

# 17. Repository Strategy

Recommended:

```text
ELRdn/LE
  fork-derived headless runtime

ELRdn/Kyalulu
  Character product/runtime
```

Kyalulu consumes LE through:

- release binary
- configurable dev URL
- typed client/schema

Do not vendor the whole LE source tree into Kyalulu unless distribution constraints later require it.

---

# 18. Migration Plan

## LE-0 — Headless boot

Goal:

> LE boots without LU React UI.

Tasks:

- fork LU with history
- preserve AGPL/upstream attribution
- create daemon entrypoint
- isolate daemon state from Tauri window state
- expose `/le/v1/version`
- expose `/le/v1/health`

Completion:

- Windows headless process starts/stops cleanly
- no webview
- tests run without LU UI

## LE-1 — LLM / models

Implement:

- `/v1/models`
- `/v1/chat/completions`
- `/v1/embeddings`
- discovery
- download
- verification
- load/unload
- hardware inventory
- cancellation
- event stream

Benchmark direct backend vs LE proxy on:

- TTFT
- total latency
- tok/s
- State JSON success
- retries
- cancellation
- 20-turn stability
- reload count
- RAM/VRAM

## LE-2 — Media

Implement:

- ComfyUI lifecycle
- model bundles
- workflow compiler
- image/edit
- video
- progress events
- VRAM handoff

Completion:

- portrait
- scene snapshot
- image-to-video
- cancellation
- chat model recovery

## LE-3 — Voice

Implement:

- STT
- TTS
- audio lifecycle
- cancellation
- realtime prototype

## LE-4 — Tools / Agent

Implement:

- registry
- permission classes
- audit log
- MCP
- background jobs
- optional OpenClaw adapter

## LE-5 — Remote / mobile

Implement:

- pairing
- scoped device token
- session/events
- Kyalulu remote gateway

## LE-6 — Cloud parity

Kyalulu can switch between local LE and Kyalulu Cloud without changing Character semantics.

---

# 19. Non-Goals

LE v1 is not:

- a second Character Runtime
- a second Kyalulu UI
- an LU UI reskin
- a billing platform
- unrestricted shell for characters
- a guarantee every model supports tools/vision/structured output
- duplicate Memory ownership
- a requirement to use OpenClaw
- a requirement to use ComfyUI forever

---

# 20. Architecture Decisions

## AD-001 — Separate LE repository
Recommended.

## AD-002 — Kyalulu owns Character truth
Required.

## AD-003 — Headless service boundary
Required.

## AD-004 — `/v1/*` + `/le/v1/*`
Required.

## AD-005 — Long operations are Jobs
Required.

## AD-006 — Tool policy before execution
Required.

## AD-007 — OpenClaw is adapter/reference, not Character core
Required.

## AD-008 — Local and cloud remain separable
Required.

---

# 21. References

Primary code reference:

- Locally Uncensored: https://github.com/PurpleDoubleD/locally-uncensored
- LU license: AGPL-3.0-only
- reviewed LU version: v3.0.2

OpenClaw references:

- https://docs.openclaw.ai/gateway/protocol
- https://docs.openclaw.ai/gateway/external-apps
- https://docs.openclaw.ai/gateway/tools-invoke-http-api

Kyalulu authority:

- `PROJECT_SPEC.md`
- `PRODUCT_SPEC.md`
- `docs/ROADMAP.md`
- compatibility docs

---

# 22. Immediate Next Action

Do **not** begin by mass-deleting LU UI files.

First engineering spike:

1. Fork LU with history.
2. Add a minimal headless entrypoint beside the existing LU entrypoint.
3. Boot only minimum shared runtime state.
4. Expose:
   - `GET /le/v1/version`
   - `GET /le/v1/health`
5. Run tests.
6. Identify compile-time dependencies from headless path into UI/window state.
7. Record those dependencies.
8. Then extract `engine`, `gpu`, `download`, and `local_api` into reusable LE modules.

First success criterion:

> **LE can boot headlessly, report health, and shut down cleanly without opening LU's UI.**

After that, Phase LE-1 begins.
