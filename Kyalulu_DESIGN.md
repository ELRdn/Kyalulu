# Kyalulu DESIGN.md

> **Status:** Design Source of Truth  
> **Audience:** Claude Code / Codex / human contributors  
> **Scope:** Kyalulu consumer-facing product UI  
> **Out of scope for this version:** Creator / Character Sheet Builder detailed UX, backend architecture, prompt schema, research-lab internals

---

## 0. Purpose

This document defines the visual language, interaction rules, layout system, and screen-level design direction for **Kyalulu**, a Character AI platform.

Kyalulu must not look like:

- a generic LLM dashboard,
- a developer console,
- an admin panel,
- a purple SaaS template,
- or a direct clone of an existing Character AI service.

The product should feel like a **soft, mystical portal into character conversations**.

The visual identity is derived primarily from the Kyalulu mascot / character-sheet reference:

- soft white / cream surfaces,
- lilac and violet accents,
- rounded but not overly bubbly geometry,
- thin lavender-gray borders,
- tiny decorative motifs,
- a cute but slightly mysterious mood,
- character-first composition.

Existing Character AI services may be used only as **UX references** for information density, discoverability, and mobile navigation. Their visual identity, exact layouts, card compositions, or interaction patterns must not be copied.

---

# 1. Source-of-Truth Priority

When implementation decisions conflict, use this order:

1. **This `DESIGN.md`**
2. Kyalulu official mascot / character-sheet reference image
3. Product requirements / IA documents
4. Current Kyalulu implementation
5. External references such as Zeta

The current UI is considered **legacy implementation**, not visual truth.

Do not preserve legacy styling simply because it already exists.

---

# 2. Product Identity

## 2.1 Product definition

Kyalulu is a **Character AI platform**.

It is not presented as:

- an AI agent,
- a general-purpose assistant,
- a model playground,
- a benchmark dashboard,
- or an LLM provider selector.

The main user experience is:

> Discover a character or world → choose a character → start a conversation → become immersed in the dialogue.

Research, provider status, benchmarks, model experiments, and prompt-debugging tools are secondary internal capabilities and must not dominate the consumer UI.

---

## 2.2 Core mood

**Soft × Mystic × Cute × Slightly Mischievous**

Target emotional balance:

- Cute: 60–70%
- Mystical / dreamy: 20–25%
- Dark / mischievous edge: 10–15%

Avoid:

- cyberpunk,
- neon hacker aesthetics,
- enterprise SaaS,
- glassmorphism-heavy UI,
- overdone “AI gradient” visuals,
- excessive bloom / glow,
- childish toy-app styling.

---

# 3. Design Principles

## P1. Character First

Characters, their names, expressions, voices, moods, and conversations are always more visually important than technical controls.

A user should never have to parse model/provider/debug information before engaging with a character.

---

## P2. Quiet UI, Expressive Characters

The shell should be calm and restrained.

Personality should come from:

- character artwork,
- avatars,
- small decorative motifs,
- copywriting,
- motion,
- state transitions.

Do not make every panel decorative.

---

## P3. Soft, Not Weak

Use light surfaces and soft borders, but maintain strong hierarchy through:

- typography,
- scale,
- spacing,
- contrast,
- selective use of Deep Violet.

Avoid a washed-out “everything is pale lavender” interface.

---

## P4. Immersion Through Conversation, Not Fake Scenery

Kyalulu chat does **not** use full visual-novel background images as its default chat canvas.

Story atmosphere, locations, weather, action, and scene progression should primarily be communicated by:

- narration,
- character dialogue,
- prompt-defined behavior,
- optional structured narration blocks.

The UI supports immersion without pretending to render a literal scene.

---

## P5. Technical Power Lives Behind the Curtain

Provider health, model routing, research A/B/C tools, experiment runs, raw prompts, and low-level model settings belong in **Studio / Research / Status**, not the main consumer flow.

---

# 4. Information Architecture

The top-level consumer IA is fixed as:

1. **Home**
2. **Discover**
3. **Chats**
4. **Create**
5. **Profile**

Secondary / advanced areas:

- **Studio**
- **Research**
- **Status**

These advanced areas must be visually and navigationally separated from the everyday character experience.

---

# 5. Global App Shell

## 5.1 Desktop

Recommended structure:

```text
┌─────────────────────────────────────────────────────────────┐
│ Kyalulu              Search                     Profile / ⋯  │
├────────────┬────────────────────────────────────────────────┤
│ Home       │                                                │
│ Discover   │                                                │
│ Chats      │                 MAIN CONTENT                   │
│ Create     │                                                │
│            │                                                │
│ Profile    │                                                │
│            │                                                │
│ ─────────  │                                                │
│ Studio     │                                                │
└────────────┴────────────────────────────────────────────────┘
```

### Sidebar behavior

Desktop sidebar:

- default expanded width: **208–224px**
- optional compact width: **68–76px**
- fixed on desktop
- icon + label
- section separation between consumer and advanced tools

Active navigation should use:

- a soft tinted background,
- subtle left / inner accent,
- Deep Violet or Mystic Lilac detail.

Do **not** use a large saturated purple rectangle for every active item.

---

## 5.2 Mobile

Primary bottom navigation:

- Home
- Discover
- Chats
- Create
- Profile

Advanced areas such as Studio / Research / Status should be accessed from:

- Profile,
- overflow menu,
- or a dedicated advanced settings entry.

They should not occupy bottom-navigation space.

---

# 6. Official Color System

## 6.1 Brand colors

```css
--kyalulu-white: #F6F6FA;
--mystic-lilac: #BFA7FF;
--deep-violet: #6C5CE7;
--void-gray: #1E1B24;
--blush-pink: #FFB8D8;
```

Recommended support colors:

```css
--mist-blue: #CFE3FF;
--lavender-gray: #D9D2E8;
--ash-purple: #8E7CC3;
```

If an implementation already has a confirmed official support palette, use that source instead of inventing new support colors.

---

# 7. Semantic Color Tokens

Do not hard-code brand colors directly into components.

Use semantic tokens.

## Light theme

```css
--bg-canvas: #F6F6FA;
--bg-surface: #FFFFFF;
--bg-surface-soft: #F2EFF9;
--bg-hover: #EEE9FA;

--text-primary: #1E1B24;
--text-secondary: #625D6C;
--text-muted: #8E8798;

--border-subtle: #DDD7E8;
--border-strong: #C8BEDD;

--accent-primary: #6C5CE7;
--accent-soft: #BFA7FF;
--accent-pink: #FFB8D8;
```

## Dark theme

Dark mode must not be a simple inversion.

```css
--bg-canvas: #151219;
--bg-surface: #1E1B24;
--bg-surface-soft: #25212C;
--bg-hover: #2D2836;

--text-primary: #F6F6FA;
--text-secondary: #CFC8D9;
--text-muted: #988FA5;

--border-subtle: #342E3E;
--border-strong: #4A405A;

--accent-primary: #BFA7FF;
--accent-strong: #8C73FF;
--accent-pink: #FFB8D8;
```

Exact dark support values may be adjusted during implementation for contrast compliance, but the hue family must remain violet / plum rather than neutral charcoal.

---

# 8. Theme Strategy

Kyalulu uses a **hybrid experience**, not “light app vs dark app”.

## Brand / discovery surfaces

Preferred default:

- light,
- cream,
- white,
- lilac,
- spacious,
- editorial.

Applies primarily to:

- Home
- Discover
- Character detail
- Create
- Profile

## Conversation surfaces

May use either user-selected light or dark appearance.

Dark chat should feel like:

- moonlit,
- quiet,
- intimate,
- soft purple-black.

It must not look like a terminal, IDE, Discord clone, or developer dashboard.

---

# 9. Typography

Typography should feel:

- contemporary,
- readable,
- slightly elegant,
- not overly rounded,
- not corporate.

Recommended stack:

```css
font-family:
  "Inter",
  "Noto Sans JP",
  system-ui,
  sans-serif;
```

A decorative serif may be used **only** for:

- Kyalulu wordmark,
- very large campaign / hero copy,
- selected branded headings.

Never use decorative serif for:

- body copy,
- form fields,
- chat messages,
- navigation,
- settings.

---

## Type scale

Recommended desktop scale:

```text
Display       40–52px / 1.05–1.15
H1            30–36px / 1.15
H2            24–28px / 1.2
H3            18–22px / 1.3
Body Large    16–18px / 1.6
Body          14–16px / 1.6
Small         12–13px / 1.5
Micro         11–12px / 1.4
```

Do not reproduce the current implementation’s tiny, dense developer-dashboard typography in consumer screens.

---

# 10. Spacing System

Use a consistent 4px base system.

Recommended scale:

```text
4
8
12
16
20
24
32
40
48
64
80
```

Consumer UI should generally prefer:

- 16–24px internal card padding,
- 24–32px section spacing,
- 32–64px major vertical separation.

Research / Studio may be denser.

---

# 11. Radius, Border, Shadow

## Radius

```text
Small controls     8px
Inputs              10–12px
Cards               14–18px
Large panels        18–24px
Hero surfaces       24–32px
Pills               999px
```

Do not make every element pill-shaped.

---

## Borders

Kyalulu should rely more on **thin borders and surface contrast** than heavy drop shadows.

Preferred:

```css
border: 1px solid var(--border-subtle);
```

Use Deep Violet borders only for:

- selected state,
- focus,
- important active state.

---

## Shadows

Default shadows should be very subtle.

Avoid:

- dark thick shadows,
- floating-dashboard cards everywhere,
- neon glows.

Use glow only for rare branded moments such as:

- active character state,
- new-world highlight,
- subtle loading / typing feedback.

---

# 12. Brand Motifs

The mascot reference establishes a secondary graphic language.

Approved motifs:

- `✦`
- `✧`
- `×`
- small crescent / curled-tail-like curves
- tiny sparkle clusters
- thin diagram-like lines

Use them sparingly.

### Correct usage

- section heading accent,
- empty state,
- loading state,
- creator preview,
- selected mood,
- occasional corner decoration.

### Incorrect usage

- every card,
- every button,
- every heading,
- random absolute-positioned decoration,
- meaningless visual noise.

The `×` motif is a secondary Kyalulu visual signature and may appear in:

- selected badges,
- decorative state indicators,
- subtle branded icons.

It should **not** replace standard close icons when doing so harms usability.

---

# 13. Home

## Goal

Home is a **portal**, not a database.

It should answer:

> “Where do I want to go / who do I want to talk to right now?”

rather than:

> “Which model or technical configuration do I want?”

---

## Recommended hierarchy

### 1. Hero / daily portal

Large visual section featuring:

- Kyalulu brand copy,
- mascot or featured character/world,
- one clear CTA,
- optional mood selector.

### 2. Continue chatting

Recent conversations with:

- character avatar,
- character name,
- short latest-message preview,
- timestamp / unread indicator.

### 3. Featured worlds

World / scenario-first discovery.

### 4. Mood picks

Examples:

- 癒し
- ツンデレ
- 深夜
- 学園
- ミステリアス
- 甘々
- 異世界
- Parallel World

### 5. Featured / trending characters

Character discovery cards.

### 6. New creators / new arrivals

Secondary discovery.

---

# 14. Discover

Discover is more search- and filtering-oriented than Home.

Recommended tools:

- global search,
- mood filter,
- world / scenario filter,
- tags,
- trending / new / recommended sorting,
- optional creator filter.

Character cards must prioritize:

1. artwork,
2. name,
3. one-line hook,
4. mood / scenario,
5. creator attribution.

Avoid filling cards with technical metadata.

---

# 15. Character Entry / Pre-Chat Screen

This screen is important because the **full character image should appear before the conversation**, not dominate the chat itself.

## Purpose

The screen should create the feeling:

> “I am about to meet this character.”

---

## Required content

- large character artwork,
- character name,
- short hook,
- creator,
- mood tags,
- scenario / world summary,
- introduction,
- optional sample dialogue,
- conversation-start CTA.

Primary action:

> **Start Chat**

Secondary actions may include:

- Save
- Share
- View creator
- More details

---

## Visual behavior

Character artwork may occupy:

- 35–50% of hero area on desktop,
- full-width hero region on mobile.

Once the conversation begins, the full artwork is reduced to:

- avatar,
- compact character identity,
- optional detail panel.

Do not keep a giant static character illustration permanently occupying chat space.

---

# 16. Chats Landing Page

The Chats section before opening a conversation should show:

- recent sessions,
- pinned characters,
- saved characters,
- unread / active sessions,
- optional search.

Each session row / card should contain:

- avatar,
- character name,
- latest message,
- time,
- optional world/scenario label.

Avoid exposing:

- model provider,
- raw system prompt,
- low-level API information.

---

# 17. Chat Information Architecture

This section is **fixed for the first implementation**.

---

## 17.1 Core message alignment

### User message

- aligned to the **right**
- visually distinct user bubble
- compact avatar optional
- user identity should not dominate

### Character message

- aligned to the **left**
- character avatar visible
- character name may appear when helpful
- softer, more expressive surface treatment

### Narration

- aligned to the **left**
- visually distinct from direct character speech
- should feel like prose / scene narration
- not rendered as a user bubble

Narration should not be represented by a giant background image.

---

## 17.2 Message visual hierarchy

Recommended semantic roles:

```text
USER
CHARACTER
NARRATION
SYSTEM_VISIBLE
```

UI should render each role intentionally.

Do **not** rely on fragile heuristics such as:

- “italics means narration,”
- “asterisks always mean action,”
- parsing arbitrary prose to guess role.

If the backend supports structured message roles, preserve them.

If structured narration is not yet supported, use a single character message style until a proper message contract is implemented.

---

## 17.3 Character imagery inside chat

Inside an active conversation:

- character appears primarily as an **avatar**,
- full character artwork is not permanently shown,
- avatar may have subtle expression variants later,
- clicking avatar may open Character Detail / side panel.

This keeps the focus on dialogue.

---

## 17.4 Story background

Kyalulu does not require literal visual-novel background images in chat.

Story environment should be conveyed primarily through:

- narration,
- scenario context,
- character behavior,
- system-prompt-controlled scene style.

Prompt/persona settings may allow each user or chat configuration to tune narration style.

Examples of configurable narration behavior:

- minimal narration,
- descriptive narration,
- dialogue-heavy,
- light novel style,
- first-person,
- third-person,
- cinematic.

These are **content-generation settings**, not visual UI themes.

---

# 18. Chat Desktop Layout

Recommended desktop structure:

```text
┌──────────────┬──────────────────────────────┬───────────────┐
│ Chat list    │ Conversation                 │ Context panel │
│              │                              │               │
│ avatars      │ character ←                  │ character     │
│ sessions     │                    user →    │ chat info     │
│ search       │ narration ←                  │ settings      │
│              │                              │ memory*       │
│              │                              │ world*        │
├──────────────┴──────────────────────────────┴───────────────┤
│                           Composer                           │
└─────────────────────────────────────────────────────────────┘
```

`*` exact capabilities depend on product/backend support.

---

# 19. Right Context Panel

The right panel must support **user-selectable behavior**.

Required preferences:

### Mode A — Always visible
For users who like persistent context and controls.

### Mode B — Collapsible
Default recommendation for desktop.

Panel may be opened via a clear button and remain closed until needed.

### Mode C — Auto
Optional future mode:

- visible on very wide screens,
- collapsed on narrower desktop widths.

---

## Panel contents

Possible sections:

- Character summary
- Current chat / scenario
- World information
- Chat appearance
- Narration preference
- Conversation controls
- Memory / context, if supported
- Advanced chat settings

Do not include raw provider / API/debug controls in the consumer context panel.

---

# 20. Chat Composer

The composer is a primary interaction surface.

Required:

- clear text input,
- send action,
- multi-line support,
- keyboard shortcut support,
- responsive height,
- focus styling.

Optional future actions:

- regenerate,
- continue,
- branch,
- swipe alternative,
- attach reference,
- narration toggle.

Do not overload the first implementation with many tiny icon-only buttons.

---

# 21. Chat Reading Width

Conversation text should not stretch edge-to-edge on 1440p / 4K displays.

Recommended readable conversation column:

```text
min: ~640px
comfortable: 760–920px
max text line region: ~960px
```

The outer app may be full-width, while the message stream remains readable.

This directly avoids the current problem where high-resolution displays can make content feel tiny or overly spread out.

---

# 22. Responsive Rules

## ≥ 1440px

- expanded sidebar allowed
- conversation centered
- right panel may be visible
- generous whitespace

## 1024–1439px

- compact or reduced sidebar
- right panel collapsible
- chat remains primary

## 768–1023px

- sidebar becomes drawer or compact rail
- right context panel becomes overlay / sheet

## < 768px

- bottom navigation
- single-column chat
- right panel becomes full-height sheet
- character pre-chat art becomes top hero
- no persistent multi-column layout

---

# 23. Buttons

## Primary

Deep Violet / strong branded action.

Use for:

- Start Chat
- Create
- Save / Publish
- major confirmation

One primary action per local context where possible.

---

## Secondary

Soft surface + border.

Use for:

- Share
- Save
- Cancel
- View details
- secondary navigation

---

## Destructive

Do not use pink or violet for destructive actions.

Use a dedicated accessible danger color token.

---

# 24. Inputs

Inputs should use:

- 10–12px radius,
- subtle border,
- clear focus ring,
- generous vertical padding.

Focus should use a violet-family outline, e.g.:

```css
box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.16);
```

Avoid tiny IDE-like fields.

---

# 25. Cards

Character and world cards should feel editorial, not dashboard-like.

A card should typically contain:

- dominant visual,
- title,
- concise hook,
- small metadata.

Avoid cards made only of:

- borders,
- labels,
- rows,
- tiny numerical metadata.

---

# 26. Empty States

Use the Kyalulu mascot / silhouette selectively.

Examples:

- no chats yet,
- no saved characters,
- no search results,
- empty creator draft.

Empty-state tone may be playful and slightly mischievous.

Avoid generic database / folder illustrations.

---

# 27. Motion

Motion should feel:

- soft,
- responsive,
- alive,
- not flashy.

Recommended durations:

```text
Micro interaction     120–180ms
Panel / sheet         180–260ms
Page transition       220–320ms
Ambient decoration    slow, subtle
```

Preferred easing:

```css
cubic-bezier(0.22, 1, 0.36, 1)
```

Potential branded motion:

- tiny sparkle on successful action,
- avatar breathing / subtle hover,
- soft lilac highlight sweep,
- panel appearing with gentle scale + fade.

Avoid:

- bouncing every card,
- heavy parallax,
- constant floating blobs,
- excessive animated gradients.

Respect `prefers-reduced-motion`.

---

# 28. Accessibility

Minimum requirements:

- WCAG AA contrast for text and interactive controls
- keyboard-navigable main flow
- visible focus states
- semantic buttons / links
- ARIA labels for icon-only controls
- reduced-motion support
- no essential information encoded only by color

Cute styling must not reduce usability.

---

# 29. Research / Studio / Status Separation

The current implementation includes useful technical capabilities such as:

- provider health,
- model selection,
- experiments,
- A/B/C comparisons,
- run lists,
- raw prompts,
- system prompt controls,
- advanced presets.

These features should survive, but in an intentionally separate product layer.

Recommended advanced navigation:

```text
Studio
├─ Characters / assets
├─ Prompt configuration
├─ Model routing
└─ Advanced settings

Research
├─ Experiments
├─ A/B/C compare
├─ Leaderboard
└─ Runs

Status
├─ Providers
├─ API health
└─ Diagnostics
```

Consumer Home / Discover / Chats must never look like these screens.

Advanced screens may be denser and darker, but should still reuse Kyalulu tokens.

---

# 30. Creator

Top-level navigation item **Create** is fixed.

The final Creator experience will become a **Character Sheet Builder**, not a plain form.

Detailed Creator structure is intentionally deferred to a later design phase.

Until that phase is complete:

- do not permanently lock a complicated wizard,
- do not redesign it as a generic admin CRUD screen,
- do not treat current form controls as final UI.

---

# 31. Anti-Patterns / Visual Rejection Rules

Reject an implementation if it does any of the following:

### Generic AI SaaS
- purple-blue gradient blob hero
- huge glowing orb
- generic “AI sparkle” everywhere
- indistinguishable from an LLM startup template

### Developer dashboard leakage
- provider URLs visible in normal chat
- model routing as a primary user control
- tiny monospace-heavy metadata
- raw API endpoints on consumer surfaces

### Excessive density
- every area boxed
- tiny 11px text across the whole app
- dozens of controls in a single toolbar
- full-width tables in normal consumer screens

### Excessive cuteness
- every component pastel
- every label has an emoji
- mascot repeated constantly
- bubble radius on every element
- low contrast for aesthetic reasons

### External imitation
- visually recreating Zeta’s exact mobile shell,
- copying exact navigation / card layouts,
- copying external brand colors or proportions.

---

# 32. Visual Acceptance Criteria

A build is visually acceptable only if all are true:

## Brand recognition

Without reading the product name, the UI still visually feels consistent with:

- white / lilac / violet,
- soft mystical mood,
- Kyalulu mascot language.

## Character priority

Character artwork and conversation are more prominent than technical metadata.

## Chat clarity

At a glance:

- user messages are right,
- character messages are left,
- narration is distinguishable,
- composer is obvious.

## Desktop quality

At 1920×1080, 2560×1440, and 3840×2160:

- text does not become microscopically small,
- content does not stretch uncontrollably,
- chat remains readable,
- empty space feels intentional.

## Consumer / Lab separation

A new user can use Kyalulu without seeing:

- provider URLs,
- experiment runs,
- raw prompts,
- benchmark tables.

---

# 33. Implementation Notes for Coding Agents

When implementing this document:

1. **Audit existing components first.**
2. Preserve working product logic unless redesign requires a UI boundary change.
3. Introduce design tokens before mass restyling.
4. Build shared primitives:
   - Button
   - Input
   - Card
   - Avatar
   - Badge
   - Panel
   - Sheet
   - Dialog
   - NavItem
   - ChatBubble
   - NarrationBlock
5. Rebuild consumer shell before polishing advanced screens.
6. Validate at FHD, WQHD, and 4K.
7. Do not “improve” the product by inventing extra features not described here.
8. Do not use external UI references as pixel-copy targets.
9. Preserve responsive behavior as a first-class requirement.
10. If a design decision is ambiguous, prefer:
    - character focus,
    - simplicity,
    - spaciousness,
    - subtle branding,
    over technical density.

---

# 34. Current Locked Decisions

The following decisions are considered locked for the current redesign:

- Official Kyalulu brand palette is used.
- Top-level IA:
  - Home
  - Discover
  - Chats
  - Create
  - Profile
- Advanced:
  - Studio
  - Research
  - Status
- Character’s large artwork is shown primarily **before chat starts**.
- During chat, the character is represented mainly by **avatar / identity UI**.
- User messages appear on the **right**.
- Character messages appear on the **left**.
- Narration appears on the **left** with a distinct presentation.
- Story environment is handled mainly through narration / prompt behavior rather than persistent background art.
- Desktop right context panel behavior is user-configurable.
- Create will ultimately become a **Character Sheet Builder**.
- Detailed Creator UX will be designed later.

---

# 35. Open Design Questions

These are intentionally **not** locked yet:

1. Exact Home hero composition
2. Exact world-card vs character-card ratio
3. Final character-detail page structure
4. Whether dark mode is global user preference or screen-aware by default
5. Exact narration visual style
6. Final right-panel contents
7. Creator / Character Sheet Builder flow
8. Character artwork expression-system behavior in chat
9. Motion identity beyond basic transitions
10. Final mobile Home composition

Do not silently lock these during implementation without explicit product approval.

---

# 36. One-Sentence Design Test

Before approving any screen, ask:

> **“Does this feel like entering a soft, slightly mysterious character world — or does it still feel like operating an AI tool?”**

If the answer is “AI tool”, redesign it.
