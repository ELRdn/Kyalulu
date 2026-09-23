# Claude Code Implementation Prompt — Kyalulu UI Redesign

You are redesigning an existing application called **Kyalulu**, a Character AI platform.

Your job is to implement the consumer-facing UI redesign using the attached design/spec package **without breaking existing working product logic**.

Read these files completely before making changes:

1. `DESIGN.md`
2. `PRODUCT_SPEC.md`

Visual references:

- `reference/kyalulu_mascot_character_sheet.png`
- `reference/kyalulu_official_color_palette.png`
- `reference/kyalulu_home_mock.png`
- `reference/kyalulu_chat_mock.png`

The mock images are **direction references, not pixel-copy targets**.

---

## Product truth

Kyalulu is a **Character AI platform**.

It is not a generic assistant, AI agent workspace, model playground, benchmark dashboard, or developer console.

The consumer flow is:

> Discover a character/world → meet the character → start a conversation → stay immersed in the dialogue.

The current implementation contains useful technical capabilities, but its UI looks like a prototype / internal LLM tool. Preserve functionality while separating technical power from the consumer experience.

---

## Locked visual direction

Use the official palette from `DESIGN.md`.

Primary:

- Kyalulu White `#F6F6FA`
- Mystic Lilac `#BFA7FF`
- Deep Violet `#6C5CE7`
- Void Gray `#1E1B24`
- Blush Pink `#FFB8D8`

Secondary:

- Mist Blue `#CFE3FF`
- Lavender Gray `#E2DDF3`
- Orchid `#D7B4FF`
- Mint Aqua `#B8F2E6`
- Cream `#FFF5E6`

Do not invent unrelated colors.

The product mood is:

> **Soft × Mystic × Cute × Slightly Mischievous**

Avoid:

- generic purple SaaS
- cyberpunk
- neon hacker UI
- excessive glassmorphism
- generic AI gradient blobs
- Discord / IDE appearance
- direct Zeta imitation

---

# Mandatory IA

Consumer:

- Home
- Discover
- Chats
- Create
- Profile

Advanced:

- Studio
- Research
- Status

Research / Status / model-provider controls must not dominate normal Home or Chat.

---

# Mandatory Chat behavior

These are locked:

- large character artwork is primarily shown **before chat starts**
- in active chat, character is mainly represented by **avatar / compact identity**
- user messages align **right**
- character messages align **left**
- narration aligns **left** and must be visually distinct
- normal chat does **not** require persistent visual-novel background images
- environment / action / scene progression are primarily expressed through narration and prompt behavior
- desktop right context panel is user-configurable:
  - `always`
  - `collapsible`
  - optionally `auto`
- right panel must not expose provider URL / benchmark / raw debugging controls

---

# First task: audit, do not edit blindly

Before changing code, inspect and report:

1. framework / build tooling
2. routing structure
3. current page/component hierarchy
4. theme / CSS architecture
5. chat message schema
6. session state ownership
7. provider / research state ownership
8. existing responsive behavior
9. existing tests
10. whether narration already has a structured role

Then produce a concise implementation plan.

Do not start a framework migration.

---

# Implementation phases

## Phase 1 — Design-token foundation

Implement the official Kyalulu semantic token layer.

Create or refactor shared primitives where appropriate:

- Button
- IconButton
- Input
- Textarea
- Card
- Avatar
- Badge
- Tooltip
- Panel
- Sheet
- Dialog
- NavItem
- CharacterCard
- WorldCard
- SessionRow
- ChatBubble
- NarrationBlock
- Composer
- ContextPanel

Avoid massive page-specific CSS duplication.

Preserve existing component library if it is useful; reskin / wrap it rather than replacing dependencies for no reason.

---

## Phase 2 — App shell

Create the new consumer shell:

Desktop:

- left navigation
- main content
- global search / profile controls
- optional compact sidebar state

Mobile:

- bottom navigation for the five consumer destinations

Advanced:

- Studio
- Research
- Status clearly secondary

Consumer screens should feel spacious and editorial.

---

## Phase 3 — Consumer screens

Implement in this order:

1. Home
2. Chats landing
3. Active Chat
4. Character entry / pre-chat
5. Discover
6. Profile
7. Create shell

Use actual existing data / API wiring when available.

If data does not exist, do not invent backend features. Use typed UI fallback / empty states only where necessary.

---

## Home requirements

Implement:

- brand hero
- Continue chatting
- Featured worlds
- Mood picks
- Featured / trending characters

The Home mock is a strong direction reference.

Do not make Home a technical dashboard.

---

## Character entry requirements

Implement a pre-chat character page with:

- large artwork
- name
- creator
- short hook
- mood tags
- scenario / world
- intro
- Start Chat

Start Chat must use existing session logic.

---

## Active Chat requirements

Desktop structure:

```text
chat/session list | conversation | optional context panel
```

Message presentation:

- USER → right
- CHARACTER → left + avatar
- NARRATION → left + prose-style distinct surface

Do not infer narration using formatting heuristics if a structured role already exists.

If structured narration does not exist, do not fake a parser that silently misclassifies messages. Keep rendering stable and document the missing backend contract.

Keep conversation reading width controlled on FHD / WQHD / 4K.

Do not let chat text stretch edge-to-edge.

---

## Right context panel

Implement preference behavior.

At minimum:

- always visible
- collapsible

Use persistent UI preference storage if available.

Panel sections only if backed by data:

- Character
- Scenario / World
- Narration style
- Appearance
- Memory / context
- Conversation controls

Do not fabricate relationship scores or memory capabilities.

---

# Existing advanced screens

Preserve functionality for:

- provider health
- model selection / routing
- Research A/B/C compare
- experiments
- runs
- leaderboard
- raw prompt inspection
- diagnostics

Move / organize them under:

- Studio
- Research
- Status

Do not delete working expert workflows merely to make the app prettier.

---

# Responsive requirements

Validate at:

- 1920×1080
- 2560×1440
- 3840×2160
- 1366×768
- tablet
- mobile

Critical rule:

> The UI must not become tiny on WQHD / 4K.

Chat reading region should remain roughly 760–920px comfortable width, with an upper readable bound around 960px.

---

# Accessibility

Required:

- WCAG AA contrast where applicable
- visible keyboard focus
- semantic interactive elements
- ARIA labels for icon-only actions
- `prefers-reduced-motion`
- no information encoded only by color

---

# Do not silently decide open questions

Do not permanently lock these without explicit approval:

- final Creator wizard structure
- exact narration styling
- exact Home hero composition
- final Character Detail composition
- expression-driven avatar system
- deep per-character UI theming
- extra social / monetization features

If implementation needs a temporary choice, keep it modular and clearly document it.

---

# Visual quality gate

Reject your own work and revise if the consumer UI still looks like:

- a model playground
- an internal tool
- a purple admin dashboard
- a generic AI startup
- a direct copy of Zeta

The final consumer experience should feel like:

> **entering a soft, slightly mysterious character world.**

---

# Verification workflow

After each major phase:

1. run formatter / lint
2. run typecheck
3. run existing tests
4. run build
5. fix regressions
6. visually inspect primary routes
7. inspect FHD / WQHD / 4K behavior
8. verify no consumer screen leaks provider URLs / raw debug controls

Do not report “done” merely because compilation succeeds.

---

# Final deliverable

At completion provide:

1. files changed
2. architecture / component summary
3. routes implemented
4. tests / checks run
5. screenshots or visual verification notes at FHD / WQHD / 4K
6. known limitations
7. open design questions still intentionally unresolved
8. any backend contract needed for structured narration

Do not overwrite project documentation with invented product decisions.
