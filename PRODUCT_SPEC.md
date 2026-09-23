# Kyalulu PRODUCT_SPEC.md

> **Status:** Product / UX implementation specification  
> **Version:** 1.0  
> **Depends on:** `DESIGN.md`  
> **Primary scope:** Consumer experience redesign  
> **Deferred:** Detailed Character Sheet Builder design

---

# 0. Goal

Transform the existing Kyalulu prototype into a coherent, production-quality **Character AI product experience** without destroying working backend / research capabilities.

The redesign must:

1. make Kyalulu feel like a Character AI product rather than an LLM laboratory,
2. establish a consumer-first information architecture,
3. create a strong Home / Discover entry experience,
4. make Chat readable, immersive, and character-first,
5. isolate technical tools into Studio / Research / Status,
6. preserve room for the future Character Sheet Builder.

---

# 1. User-facing product structure

## Primary navigation

- Home
- Discover
- Chats
- Create
- Profile

## Advanced navigation

- Studio
- Research
- Status

Advanced areas are available but visually secondary.

---

# 2. Route proposal

Use the existing routing architecture if already present.  
Do not change framework unnecessarily.

Recommended logical routes:

```text
/
  -> Home

/discover
/chats
/chats/:sessionId
/characters/:characterId
/create
/profile

/studio
/research
/status
```

If the current app uses hash routing or another route shape, preserve it unless there is a clear technical reason to migrate.

---

# 3. Global state domains

Keep state ownership conceptually separated.

## Consumer shell state

- active route
- theme
- compact / expanded desktop sidebar
- mobile nav state
- global search state

## Character / discovery state

- featured characters
- featured worlds
- mood filters
- search results
- saved / followed state

## Chat state

- session list
- active session
- messages
- draft
- active character
- scenario / world metadata
- context-panel preference
- narration preference
- chat appearance preference

## Advanced state

- provider health
- model routing
- research runs
- experiment selection
- raw prompt / debug data

Do not couple advanced state into ordinary chat rendering unless the backend requires it.

---

# 4. Home

## 4.1 Purpose

Home is the emotional entry point.

Primary jobs:

- continue an existing relationship
- discover a world / mood
- discover characters
- communicate Kyalulu’s identity

## 4.2 Required modules

### A. Global shell

- logo
- sidebar / mobile nav
- global search
- profile entry

### B. Hero

Required:

- large visual region
- short brand statement
- one primary CTA
- Kyalulu mascot or a featured world / character

CTA target can be:

- Discover
- featured world
- featured character

Do not hard-code the CTA copy into reusable components.

### C. Continue chatting

Show recent sessions.

Each item:

- avatar
- character name
- latest-message preview
- time
- unread indicator if available

Click opens `/chats/:sessionId`.

### D. Featured worlds

World / scenario cards.

Required card data:

- image
- title
- one-line summary
- optional engagement / popularity metadata

### E. Mood picks

Chip / button filter row.

Examples are content, not schema:

- 癒し
- ツンデレ
- 深夜
- 学園
- ミステリアス
- 甘々
- 異世界
- Parallel World

Click navigates to Discover with filter applied.

### F. Featured characters

Character cards.

Required:

- artwork
- name
- short hook
- creator
- optional popularity / save state

---

# 5. Discover

## 5.1 Purpose

Let users deliberately search and filter characters / worlds.

## 5.2 Required controls

- search
- mood filter
- world / scenario filter
- tags
- sort mode

Recommended sort modes:

- Recommended
- Trending
- New

Do not add filters without supporting data.

## 5.3 Results

Results may mix characters and worlds only if the UI makes the distinction clear.

Prefer dedicated sections / result types over ambiguous mixed cards.

## 5.4 Empty state

Show:

- Kyalulu visual / silhouette
- clear empty-state message
- reset filters action

---

# 6. Character entry / pre-chat screen

## 6.1 Purpose

This is the “meet the character” screen.

The large character visual belongs here.

## 6.2 Required content

- character artwork
- name
- creator
- short hook
- mood tags
- scenario / world
- intro
- Start Chat CTA

Optional if data exists:

- sample dialogue
- popularity / saves
- creator profile link
- share

## 6.3 Start Chat behavior

When user selects Start Chat:

1. resolve existing / new session according to current product logic,
2. create / select chat context,
3. navigate to active chat,
4. preserve character / scenario context.

Do not duplicate backend session logic if it already exists.

---

# 7. Chats landing

## 7.1 Purpose

Manage active conversations.

## 7.2 Required sections

- pinned
- recent
- archived if current backend supports it

## 7.3 Session row

Fields:

- avatar
- character name
- latest-message preview
- timestamp
- unread state if available
- optional world / scenario label

Actions may include:

- pin
- archive
- more menu

Destructive delete must require an explicit confirmation if deletion is permanent.

---

# 8. Active Chat

## 8.1 Layout

Desktop:

```text
left session rail | center conversation | optional right context panel
```

Mobile:

```text
single conversation column
context panel -> sheet
session list -> separate screen / drawer
```

## 8.2 Character header

Required:

- back / session navigation where applicable
- character avatar
- character name
- short state / scenario label if available
- minimal secondary actions

Do not show provider URL or benchmark data.

## 8.3 Message roles

### User

- right
- user bubble

### Character

- left
- avatar
- character bubble / message surface

### Narration

- left
- visually distinct prose block
- no user-style bubble

### System-visible

Only show if product intentionally exposes it.

## 8.4 Message behavior

Preserve existing:

- streaming if available
- retry / regenerate logic if available
- edit / delete only if supported by backend
- timestamps according to current data

Do not fake functions.

## 8.5 Composer

Required:

- multiline textarea
- send
- Enter / Shift+Enter behavior based on current product convention
- disabled / loading state
- visible focus
- graceful streaming state

Potential later actions must not block v1 redesign.

## 8.6 Typing / generation state

Show a subtle character-side typing state.

Use:

- avatar
- small lilac dots
- restrained motion

No large “AI is thinking…” developer indicators.

---

# 9. Narration

## 9.1 Product concept

Narration is responsible for:

- environment
- action
- scene transitions
- tone
- descriptive prose

Kyalulu does not require persistent background images to communicate the scene.

## 9.2 UI

Narration must be distinguishable from speech.

Potential styling:

- slightly wider prose block
- lower-contrast surface
- `✦` / small motif
- no speech-tail metaphor
- comfortable line height

Exact final narration style remains open.

## 9.3 Prompt behavior

Narration style should eventually be configurable per user / chat using prompt context.

Possible settings:

- minimal
- descriptive
- dialogue-heavy
- light-novel style
- first-person
- third-person
- cinematic

This spec does not define backend prompt serialization.

---

# 10. Right Context Panel

## 10.1 Preference

Persist one of:

```text
always
collapsible
auto
```

If persistence infrastructure already exists, use it.

Otherwise local preference storage is acceptable for UI-only state until backend settings exist.

## 10.2 Sections

Only render sections supported by data.

Candidates:

- Character
- Mood
- Scenario / World
- Narration style
- Chat appearance
- Memory / context
- Conversation controls

Do not fabricate “relationship score” or memory features if they do not exist.

## 10.3 Width

Recommended desktop width:

```text
300–360px
```

Never let the panel shrink the readable conversation below the chat minimum.

---

# 11. Theme / appearance

## 11.1 Global theme

Support light / dark according to existing app capabilities.

## 11.2 Chat appearance

Chat may support additional local appearance options later.

For current redesign:

- use official theme tokens
- support right-panel mode
- support readable font sizing if current settings architecture makes it easy

Do not add deep per-character theming unless backend / product data exists.

---

# 12. Create

## 12.1 Current scope

Create remains a primary navigation destination.

## 12.2 Future direction

It becomes a Character Sheet Builder.

Expected eventual domains:

- Identity
- Personality
- Speech
- World / Scenario
- Visual
- Dialogue samples
- Preview / test chat

This version does **not** lock the wizard sequence.

## 12.3 Interim requirement

Avoid shipping a permanent generic admin form as the final creator experience.

If existing create functionality must remain:

- wrap it in the new shell
- improve visual consistency
- preserve logic
- clearly treat it as interim

---

# 13. Profile

Required consumer-level content:

- avatar
- display name
- short profile
- saved / followed content if supported
- created characters if supported
- settings entry
- advanced / Studio entry

Do not expose technical credentials on the main profile surface.

---

# 14. Studio

Purpose:

- advanced creator / configuration environment

Possible existing capabilities to place here:

- character assets
- prompt configuration
- system prompt support
- model routing
- presets
- advanced chat setup

Do not merge Studio with Research unless the existing information architecture requires it.

---

# 15. Research

Preserve the existing research workflow:

- experiments
- A/B/C compare
- run selection
- leaderboard
- raw prompt inspection if useful

Research can stay dense.

Redesign goals:

- use Kyalulu tokens
- improve readability
- preserve expert density
- keep it isolated from consumer UI

Do not turn Research into a consumer card grid.

---

# 16. Status

Preserve:

- provider state
- API health
- diagnostics

Status can be compact and technical.

It should still use:

- correct typography
- Kyalulu token system
- clear health states

---

# 17. Migration strategy

## Phase 1 — Audit and token layer

- inspect current routes
- inspect state ownership
- inspect chat API contract
- inspect theme system
- map current components
- introduce official tokens
- preserve functionality

## Phase 2 — New shell

- desktop sidebar
- top header / search
- mobile bottom nav
- advanced navigation separation

## Phase 3 — Consumer pages

Order:

1. Home
2. Chats landing
3. Active Chat
4. Character entry
5. Discover
6. Profile
7. Create shell

## Phase 4 — Advanced pages

- Studio
- Research
- Status

Do not block consumer redesign on complete advanced-page polish.

---

# 18. Technical non-goals

Do not:

- rewrite the backend without need
- replace API contracts casually
- migrate framework solely for visual redesign
- remove research capabilities
- invent social features
- invent paid-plan logic
- introduce heavy animation libraries unnecessarily
- introduce a new global state library unless needed

---

# 19. Acceptance tests

## Navigation

- all five primary destinations work
- advanced pages remain reachable
- desktop + mobile navigation behaves correctly

## Home

- hero renders
- recent chats render
- featured worlds render
- mood controls render
- character cards render

## Character entry

- large art visible
- Start Chat works
- session transition works

## Chat

- user right
- character left
- narration left / distinct where supported
- streaming works
- composer works
- right panel preference works
- no provider/debug leakage

## Responsive

Test:

- 1920×1080
- 2560×1440
- 3840×2160
- 1366×768
- tablet
- mobile

## Visual

- official palette only
- no generic SaaS drift
- no tiny dashboard typography in consumer UI
- no giant full-width message lines

---

# 20. Definition of done

The redesign is considered complete for this phase when:

1. Home / Discover / Chats / Create / Profile exist in the new shell.
2. Character entry exists before chat.
3. Chat uses the new information architecture.
4. Right context panel preference works.
5. Research / Status are isolated from consumer navigation.
6. Official palette and semantic tokens are implemented.
7. FHD / WQHD / 4K visual checks pass.
8. Mobile core navigation and chat are usable.
9. Existing working backend behavior is preserved.
10. No major Open Design Question has been silently hard-coded as a permanent product decision.
