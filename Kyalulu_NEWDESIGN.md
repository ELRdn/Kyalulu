# Kyalulu DESIGN.md

> **Status:** Visual / Interaction Design Source of Truth  
> **Product:** Kyalulu — Character AI Platform  
> **Audience:** Claude Code / Codex / human contributors  
> **Version:** 2.0  
> **Reference lock:** `reference/kyalulu_mascot_character_sheet.png`, `reference/kyalulu_official_color_palette.png`, `reference/kyalulu_home_mock.png`, `reference/kyalulu_chat_mock.png`

---

# 0. What this document controls

This file defines the **consumer-facing visual system and interaction rules** for Kyalulu.

When implementation decisions conflict, resolve them in this order:

1. `DESIGN.md`
2. official color-palette reference
3. official Kyalulu mascot / character-sheet reference
4. `PRODUCT_SPEC.md`
5. approved Home / Chat mock images
6. current implementation
7. external references such as Zeta

The current implementation is **legacy product logic + prototype UI**.  
It is not the visual source of truth.

Do not preserve a legacy layout merely because it already works.

---

# 1. Product identity

Kyalulu is a **Character AI platform**.

It is not presented as:

- a generic AI assistant,
- an agent workspace,
- a model playground,
- a benchmark tool,
- a developer console,
- or an LLM routing dashboard.

The core experience is:

> **Discover a character or world → meet the character → start a conversation → stay immersed in the relationship / story.**

The interface must make characters and conversation feel alive while keeping the shell calm, elegant, and easy to understand.

---

# 2. Design concept

## 2.1 Core concept

> **Soft Mystic Portal**

Kyalulu should feel like entering a soft, slightly mysterious parallel world.

Emotional balance:

- **Cute:** 60–70%
- **Mystical / dreamy:** 20–25%
- **Dark / mischievous:** 10–15%

The mascot is cute and soft, but details such as black accessories, the `×` motif, violet shadows, and crescent / loop shapes prevent the product from becoming overly childish.

## 2.2 Keywords

- transparent
- fluffy
- mystical
- elegant
- cute
- moody
- gentle
- dreamy
- Parallel World
- character-first

## 2.3 Reject these visual directions

Do not drift into:

- generic purple SaaS
- cyberpunk
- neon hacker UI
- glassmorphism showcase UI
- Discord clone
- IDE / terminal aesthetics
- “AI gradient blob” landing page
- over-cute toy application
- direct Zeta clone

---

# 3. Design principles

## P1 — Character first

Artwork, avatar, name, expression, dialogue, and mood must be more prominent than technical configuration.

A consumer should never have to understand a model name or provider before talking to a character.

## P2 — Quiet shell, expressive content

The application shell should be restrained.

Personality comes from:

- character visuals
- copy
- avatar states
- micro-motifs
- motion
- world cards
- narration styling

Do not decorate every box.

## P3 — Soft, not washed out

Kyalulu uses light colors, but still needs strong hierarchy.

Use:

- Deep Violet for important actions
- Void Gray for text and dark surfaces
- whitespace
- size contrast
- selective accent colors

Avoid “everything is pale lilac”.

## P4 — Immersion through language

The normal chat view does **not** rely on persistent visual-novel background artwork.

Environment and story progression are primarily conveyed through:

- character dialogue
- narration
- scenario
- world context
- prompt-controlled writing style

## P5 — Technical power stays behind the curtain

Provider health, benchmark runs, model routing, raw prompts, experimental A/B/C controls, and diagnostic endpoints belong to **Studio / Research / Status**.

They must not leak into normal Home / Discover / Chats.

---

# 4. Official palette

The palette below is locked to `reference/kyalulu_official_color_palette.png`.

## 4.1 Primary colors

| Token name | Hex | Intended use |
|---|---:|---|
| Kyalulu White | `#F6F6FA` | main bright canvas / base surface |
| Mystic Lilac | `#BFA7FF` | secondary brand accent / hover / soft emphasis |
| Deep Violet | `#6C5CE7` | primary CTA / key links / active states |
| Void Gray | `#1E1B24` | dark surfaces / strong text / scarf-like contrast |
| Blush Pink | `#FFB8D8` | emotion / affection / notification accent |

## 4.2 Secondary colors

| Token name | Hex | Intended use |
|---|---:|---|
| Mist Blue | `#CFE3FF` | calm subcolor / dreamy cool surface |
| Lavender Gray | `#E2DDF3` | borders / dividers / quiet support surfaces |
| Orchid | `#D7B4FF` | glamorous / mystical variation |
| Mint Aqua | `#B8F2E6` | success / special status / fresh accent |
| Cream | `#FFF5E6` | warm support surface |

## 4.3 Neutral scale

| Token | Hex |
|---|---:|
| Gray 900 | `#0E0D12` |
| Gray 800 | `#1E1B24` |
| Gray 700 | `#2E2A38` |
| Gray 600 | `#4B4758` |
| Gray 500 | `#6B6678` |
| Gray 400 | `#8E899E` |
| Gray 300 | `#B9B4CB` |
| Gray 200 | `#E3E1EB` |
| Gray 100 | `#F0EFFF` |

## 4.4 Official gradients

Use gradients as world-building accents, not as default component backgrounds.

```css
--gradient-kyalulu-glow:
  linear-gradient(135deg, #6C5CE7 0%, #BFA7FF 100%);

--gradient-mystic-dream:
  linear-gradient(135deg, #BFA7FF 0%, #CFE3FF 100%);

--gradient-parallel-world:
  linear-gradient(135deg, #1E1B24 0%, #6C5CE7 100%);

--gradient-tyarai-mode:
  linear-gradient(135deg, #FF7AB8 0%, #FFB8D8 100%);

--gradient-mint-breeze:
  linear-gradient(135deg, #B8F2E6 0%, #CFE3FF 100%);
```

### Gradient rules

Allowed:

- Home hero
- promotional / special cards
- active branded CTA
- selected special mode
- subtle empty-state art
- rare atmospheric details

Avoid:

- every button
- every card
- every active navigation item
- long text surfaces
- entire settings screens

---

# 5. Semantic token system

Never style product components directly with arbitrary hex values when an existing semantic token can express the intent.

## 5.1 Light theme

```css
:root {
  --bg-canvas: #F6F6FA;
  --bg-surface: #FFFFFF;
  --bg-surface-soft: #F0EFFF;
  --bg-surface-warm: #FFF5E6;
  --bg-hover: #F1EDFB;

  --text-primary: #1E1B24;
  --text-secondary: #4B4758;
  --text-muted: #8E899E;
  --text-on-accent: #F6F6FA;

  --border-subtle: #E2DDF3;
  --border-strong: #B9B4CB;

  --accent-primary: #6C5CE7;
  --accent-secondary: #BFA7FF;
  --accent-pink: #FFB8D8;
  --accent-blue: #CFE3FF;
  --accent-mint: #B8F2E6;
  --accent-orchid: #D7B4FF;

  --focus-ring: rgba(108, 92, 231, 0.18);
}
```

## 5.2 Dark theme

Dark mode is not a simple inversion.

```css
[data-theme="dark"] {
  --bg-canvas: #0E0D12;
  --bg-surface: #1E1B24;
  --bg-surface-soft: #2E2A38;
  --bg-hover: #3A3446;

  --text-primary: #F6F6FA;
  --text-secondary: #E3E1EB;
  --text-muted: #B9B4CB;

  --border-subtle: #2E2A38;
  --border-strong: #4B4758;

  --accent-primary: #BFA7FF;
  --accent-secondary: #D7B4FF;
  --accent-pink: #FFB8D8;
  --accent-blue: #CFE3FF;
  --accent-mint: #B8F2E6;

  --focus-ring: rgba(191, 167, 255, 0.22);
}
```

Use real contrast testing during implementation.  
If a color must be adjusted for accessibility, keep it inside the same hue family.

---

# 6. Theme strategy

## 6.1 Brand / discovery surfaces

Preferred visual mode:

- Kyalulu White
- white cards
- Lavender Gray borders
- lilac atmosphere
- generous whitespace
- editorial composition

Primary screens:

- Home
- Discover
- Character entry
- Create
- Profile

## 6.2 Chat surfaces

Chat supports both light and dark appearance.

The approved direction for dark chat is:

> **moonlit, intimate, soft purple-black**

It must not resemble:

- an IDE
- a terminal
- Discord
- a generic admin dashboard

---

# 7. Typography

Recommended base stack:

```css
font-family:
  Inter,
  "Noto Sans JP",
  system-ui,
  sans-serif;
```

A decorative serif may be used only for:

- Kyalulu wordmark
- large hero campaign copy
- rare editorial headings

Do not use decorative serif for:

- body copy
- chat text
- inputs
- settings
- navigation

## Desktop type scale

```text
Display       40–52px
H1            30–36px
H2            24–28px
H3            18–22px
Body Large    16–18px
Body          14–16px
Small         12–13px
Micro         11–12px
```

Consumer screens must not inherit the tiny type density of the existing Research UI.

---

# 8. Spacing

4px base system:

```text
4 8 12 16 20 24 32 40 48 64 80
```

Recommended consumer defaults:

- card padding: 16–24px
- section gap: 24–32px
- large section separation: 32–64px
- desktop page horizontal padding: 24–40px

Research may be denser.

---

# 9. Radius / border / shadow

## Radius

```text
small control     8px
input             10–12px
card              14–18px
large panel       18–24px
hero              24–32px
pill              999px
```

Not every control should be a pill.

## Border

Primary visual separator:

```css
border: 1px solid var(--border-subtle);
```

Use stronger borders for selected / focused state only.

## Shadow

Prefer:

- subtle shadows
- soft inner contrast
- surface separation

Avoid heavy floating cards and neon bloom.

---

# 10. Brand motifs

Approved recurring symbols:

- `✦`
- `✧`
- `×`
- `∞`
- crescent / moon curve
- curled-tail / loop curve
- tiny sparkle cluster
- thin diagram-like lines
- mushroom motif when contextually appropriate

Use sparingly.

Good locations:

- large section heading
- loading state
- empty state
- mood / world indicator
- subtle corner detail
- special mode badge

Do not randomly scatter decoration across all components.

The `×` motif is a secondary brand signature.  
Do not replace universal close icons with it if usability suffers.

---

# 11. Product IA

Consumer navigation is locked:

1. **Home**
2. **Discover**
3. **Chats**
4. **Create**
5. **Profile**

Advanced product layer:

- **Studio**
- **Research**
- **Status**

Advanced areas must remain visually and navigationally secondary.

---

# 12. Global desktop shell

Recommended structure:

```text
┌─────────────────────────────────────────────────────────────┐
│ Kyalulu              Search                     Profile / ⋯  │
├────────────┬────────────────────────────────────────────────┤
│ Home       │                                                │
│ Discover   │                                                │
│ Chats      │                 MAIN CONTENT                   │
│ Create     │                                                │
│ Profile    │                                                │
│            │                                                │
│ ─────────  │                                                │
│ Studio     │                                                │
└────────────┴────────────────────────────────────────────────┘
```

## Sidebar

Expanded:

- 208–224px

Compact:

- 68–76px

Active state:

- soft lilac tint
- subtle violet indicator
- clear icon + label

Do not use a giant saturated purple slab.

Studio entry should look visibly secondary / advanced.

---

# 13. Mobile shell

Bottom navigation:

- Home
- Discover
- Chats
- Create
- Profile

Studio / Research / Status:

- Profile
- overflow
- advanced menu

Never consume primary bottom-navigation slots.

---

# 14. Home

## Purpose

Home is a **portal**, not a catalog.

The user should think:

> “Where do I want to go, and who do I want to talk to?”

rather than:

> “Which technical configuration do I want?”

## Recommended hierarchy

1. Hero / daily portal
2. Continue chatting
3. Featured worlds
4. Mood picks
5. Featured / trending characters
6. New creators / new arrivals

## Hero

Use approved Home mock as direction, not pixel-copy target.

Hero may include:

- Kyalulu mascot
- Parallel World visual
- short brand statement
- one primary CTA
- tiny ambient motifs

The hero must remain readable and not become an illustration poster that pushes all product content below the fold.

## Mood discovery

Examples:

- 癒し
- ツンデレ
- 深夜
- 学園
- ミステリアス
- 甘々
- 異世界
- Parallel World

---

# 15. Discover

More search-oriented than Home.

Required:

- search
- mood filter
- scenario / world filter
- tags
- sort / recommendation mode

Character card priority:

1. artwork
2. character name
3. one-line hook
4. mood / scenario
5. creator attribution

Do not show model metadata on consumer character cards.

---

# 16. Character entry / pre-chat

This screen is where **large character artwork belongs**.

Purpose:

> “I am about to meet this character.”

Required:

- large character image
- name
- one-line hook
- creator
- mood tags
- scenario / world summary
- intro
- optional sample dialogue
- Start Chat CTA

Desktop artwork may occupy roughly 35–50% of the hero composition.

After chat starts, full artwork is reduced to avatar / compact identity.

---

# 17. Chats landing

Before a specific chat is opened, show:

- recent sessions
- pinned characters
- saved characters
- unread / active sessions
- search

Session rows:

- avatar
- name
- latest-message preview
- time
- optional scenario / world label

No provider or raw model information.

---

# 18. Chat — locked information architecture

## 18.1 Alignment

### User

- right aligned
- distinct bubble
- user avatar optional
- compact identity

### Character

- left aligned
- avatar visible
- character name where useful

### Narration

- left aligned
- visually distinct from direct speech
- prose-like treatment
- not a user bubble

## 18.2 Structured roles

Preferred internal contract:

```text
USER
CHARACTER
NARRATION
SYSTEM_VISIBLE
```

Do not guess narration from italics or asterisks if structured roles are available.

If structured narration does not exist yet, render ordinary character messages consistently until the backend contract is added.

## 18.3 Character imagery

During chat:

- avatar is primary
- large artwork is not persistent
- clicking avatar may open character detail / side panel
- expression-specific avatars may be added later

## 18.4 Story environment

No mandatory full background artwork.

Story atmosphere comes from:

- narration
- scenario
- character behavior
- system-prompt-controlled generation style

Potential user-level narration preferences:

- minimal
- descriptive
- dialogue-heavy
- light-novel style
- first-person
- third-person
- cinematic

These are content-generation settings, not visual themes.

---

# 19. Chat desktop layout

Recommended structure:

```text
┌──────────────┬──────────────────────────────┬───────────────┐
│ Chat list    │ Conversation                 │ Context panel │
│              │                              │               │
│ avatars      │ character ←                  │ character     │
│ sessions     │                    user →    │ scenario      │
│ search       │ narration ←                  │ settings      │
│              │                              │ memory*       │
├──────────────┴──────────────────────────────┴───────────────┤
│                           Composer                           │
└─────────────────────────────────────────────────────────────┘
```

The approved Chat mock is a direction reference for:

- hierarchy
- dark mood
- character-left / user-right alignment
- right context panel
- readable message width

It is not a pixel-perfect implementation target.

---

# 20. Right context panel

Panel behavior is user-configurable.

## Required modes

### Always visible

Persistent context for wide-desktop users.

### Collapsible

Recommended default.

### Auto

Optional / later:

- visible on wide screens
- collapsed at narrower desktop widths

## Potential contents

- character summary
- current scenario / world
- narration style
- appearance
- conversation controls
- memory / context if backend supports it
- advanced chat settings

Do not place provider URL / API health / benchmark controls here.

---

# 21. Chat composer

Required:

- clear text input
- multiline input
- send
- keyboard shortcuts
- responsive height
- clear focus state

Possible later actions:

- regenerate
- continue
- branch
- alternative response
- attach reference

Do not start with a toolbar full of tiny unexplained icon-only actions.

---

# 22. Reading width and high-resolution behavior

Chat text must not stretch across the entire 1440p / 4K window.

Recommended:

```text
minimum useful conversation width: ~640px
comfortable region: 760–920px
maximum readable message region: ~960px
```

The app shell can use full width while the message reading region stays controlled.

Validation resolutions:

- 1920×1080
- 2560×1440
- 3840×2160

The UI must not look tiny on WQHD / 4K.

---

# 23. Responsive behavior

## ≥1440px

- expanded sidebar allowed
- centered conversation
- context panel may be visible
- generous whitespace

## 1024–1439px

- compact sidebar
- collapsible context panel
- chat remains primary

## 768–1023px

- sidebar becomes rail / drawer
- context panel becomes overlay / sheet

## <768px

- bottom navigation
- single-column chat
- context becomes full-height sheet
- character entry art becomes top hero

---

# 24. Buttons

## Primary

Use Deep Violet / Kyalulu Glow.

Primary actions:

- Start Chat
- Create
- Save
- Publish
- Confirm

One primary action per local context whenever possible.

## Secondary

- white / soft surface
- subtle border
- violet text or icon

Examples:

- Share
- Save
- Cancel
- Details

## Destructive

Use a separate accessible danger token.

Do not use Blush Pink for destructive actions.

---

# 25. Inputs

Default:

- 10–12px radius
- Lavender Gray border
- generous vertical padding
- violet focus ring

Example:

```css
box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.18);
```

Avoid tiny developer-tool fields on consumer screens.

---

# 26. Cards

Character / world cards should feel editorial.

Typical card:

- dominant image
- title
- concise hook
- small metadata

Avoid:

- miniature dashboard tables
- many small numbers
- label soup
- technical metadata grids

---

# 27. Empty states

Preferred visual language:

- Kyalulu mascot
- mascot silhouette
- small sparkle / crescent motifs
- short playful copy

Examples:

- no chat yet
- no saved character
- no search result
- empty creator draft

Avoid generic folder/database illustrations.

---

# 28. Motion

Motion qualities:

- soft
- responsive
- alive
- restrained

Timing:

```text
micro              120–180ms
panel / sheet       180–260ms
page transition     220–320ms
ambient             slow / subtle
```

Preferred easing:

```css
cubic-bezier(0.22, 1, 0.36, 1)
```

Allowed branded motion:

- tiny sparkle after success
- subtle avatar life / hover
- lilac highlight sweep
- gentle panel fade + scale

Avoid:

- bouncing every card
- constant blobs
- heavy parallax
- permanently animated gradients

Respect `prefers-reduced-motion`.

---

# 29. Accessibility

Minimum:

- WCAG AA text / control contrast
- visible keyboard focus
- semantic button / link elements
- ARIA labels for icon-only buttons
- reduced-motion support
- no color-only information

The official palette reference gives AA-oriented pairings such as:

- Deep Violet on Kyalulu White
- Void Gray on Kyalulu White
- Blush Pink on Void Gray
- Mystic Lilac on Void Gray

Use real contrast tooling during implementation.

---

# 30. Studio / Research / Status separation

Existing advanced features are valuable and should remain.

## Studio

- character / asset support
- prompt configuration
- model routing
- advanced settings

## Research

- experiments
- A/B/C compare
- leaderboard
- runs

## Status

- provider health
- API health
- diagnostics

Advanced screens may be denser than consumer screens, but still use the Kyalulu token system.

---

# 31. Create

Top-level **Create** is locked.

The final experience will be a **Character Sheet Builder**, not a plain CRUD form.

Detailed Creator UX is intentionally deferred.

Until it is defined:

- do not permanently lock a generic settings-form layout
- do not build a huge wizard based on assumptions
- preserve extensibility for personality, voice, world, scenario, samples, and visual identity

---

# 32. External-reference rules

Zeta can inform:

- simple mobile navigation
- visual character priority
- discoverability
- compact chat/session lists

Do not copy:

- its exact mobile shell
- card proportions
- typography
- navigation placement
- color system
- screen composition

Kyalulu must remain recognizable as Kyalulu.

---

# 33. Anti-pattern rejection list

Reject the build if any are true:

## Generic AI SaaS

- blue/purple glowing blob hero
- giant abstract AI orb
- “sparkle icon everywhere”
- stock startup dashboard feeling

## Developer UI leakage

- provider URL visible in normal chat
- model routing as a normal user-level primary control
- raw prompt / endpoint visible in consumer flow
- tiny monospace metadata dominating screens

## Excessive density

- every area boxed
- tiny text everywhere
- giant top toolbar
- tables as consumer layout

## Excessive cuteness

- every component pastel
- emoji on every label
- mascot repeated constantly
- low contrast
- bubble radius everywhere

## Visual drift

- arbitrary colors outside approved palette
- unexplained gradients
- inconsistent radius
- inconsistent icon language
- consumer and Research visual hierarchy becoming identical

---

# 34. Visual acceptance criteria

A screen is acceptable only if all are true.

## Brand recognition

Even without reading “Kyalulu”, it visually matches:

- white / lilac / violet
- soft mystical atmosphere
- character-sheet brand language

## Character priority

Character content is stronger than technical metadata.

## Chat clarity

At a glance:

- user = right
- character = left
- narration = distinct and left
- composer = obvious

## Resolution quality

At FHD, WQHD, and 4K:

- text remains readable
- content does not become microscopic
- lines do not stretch uncontrollably
- whitespace feels intentional

## Consumer / advanced separation

A normal user can use Kyalulu without seeing:

- provider endpoints
- benchmark runs
- raw prompts
- diagnostics

---

# 35. Coding-agent implementation rules

1. Audit the existing app before editing.
2. Preserve working product logic where possible.
3. Introduce tokenized theme variables first.
4. Build shared UI primitives before mass page-specific CSS.
5. Rebuild the consumer shell before polishing Research.
6. Validate FHD / WQHD / 4K.
7. Keep mobile responsive behavior first-class.
8. Do not invent major product features.
9. Treat approved mocks as direction references, not pixel-copy instructions.
10. Prefer character focus, simplicity, whitespace, and subtle branding over technical density.

Recommended primitives:

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

---

# 36. Locked decisions

These are currently locked:

- official palette in this document
- Home / Discover / Chats / Create / Profile IA
- Studio / Research / Status as advanced areas
- large character artwork appears mainly before chat
- active chat uses avatar / compact identity
- user messages align right
- character messages align left
- narration aligns left and is visually distinct
- no required persistent story background image in chat
- story atmosphere is primarily generated through narration / prompt behavior
- right context panel behavior is user-configurable
- Create evolves into a Character Sheet Builder
- detailed Creator flow is deferred

---

# 37. Open questions

Do not silently lock these:

1. exact Home hero composition
2. world-card vs character-card ratio
3. final Character Detail composition
4. exact narration-block styling
5. final context-panel information
6. Character Sheet Builder flow
7. expression / avatar variant behavior
8. advanced motion identity
9. final mobile Home composition
10. exact per-character chat appearance customization

---

# 38. One-sentence test

Before approving a consumer screen, ask:

> **“Does this feel like entering a soft, slightly mysterious character world — or does it still feel like operating an AI tool?”**

If it feels like an AI tool, redesign it.
