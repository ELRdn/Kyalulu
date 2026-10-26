# JA/EN conversation entry and first-chat guidance

Product source: `33d00b0`, following `b0c402c`. The isolated build began with a
clean export of `b0c402c`; only `ActiveChat.tsx` changed afterward and was copied
directly from `33d00b0`. No unrelated or pending Core changes were included.

## Changes

- Character entry: start/resume/login/save, portraits, profile/scene/world
  headings, adult-access guidance and failures follow the selected language.
  Errors retain their original cause and are translated on render, so changing
  language does not start another request. Names, profile originals, greetings,
  selected scene and generation recommendations are retained.
- Character cards and conversation rows: known mood labels, counts, relative
  times, empty previews and pin accessibility labels follow the language.
  Mood aliases, stable URL/filter keys, ranking inputs and unknown authored tags
  retain their original meaning. Profile placeholder substitution is display
  only and does not rewrite stored cards.
- First-chat guide: all four steps, receipts and fallback messages are JA/EN.
  The device route describes browser inference/model preparation instead of
  incorrectly describing connected-PC execution or BYOK. Cloud still explains
  per-send consent, destinations, input scope and cost caps; cancellation/expiry
  does not generate. BYOK provider costs remain separate from K-Credits. PC
  guidance retains the external-provider distinction. Memory correction is
  still separate from conversation editing, and word matches are not evidence
  of factuality. Inspector remains disabled when permission is unavailable.
- Primary chat controls: input/send/stop/narration, starter suggestions, first-guide
  and model-panel controls, reply waiting and model preparation/recovery actions
  follow the language. No model fallback, charging, transport or automatic-send
  behavior was changed. Explicit custom input hints and typed drafts are kept.

The adult entry message now requires login and the required adult verification;
it does not implement or activate a verification provider.

## Validation

- Related entry/tutorial/composer/waiting/text suites: **54 passed**.
- Full collected-source Web suite: **707 passed / 55 files** after the final
  model-status copy change. Web typecheck and collected-source `build:app` pass.
- Existing Japanese browser drivers now explicitly select `ja-JP`, rather than
  depending on hardcoded Japanese UI under an English browser locale. Python
  syntax checks passed for the five adjusted drivers; their full scenarios were
  not rerun in this phase.
- The actual built app passed **four** disposable Chromium profile conditions:

| Language | Width | Theme |
|---|---:|---|
| JA | 393 px | Light |
| EN | 393 px | Dark |
| JA | 1280 px | Dark |
| EN | 1280 px | Light |

`tests/e2e_unified_pwa.py` opens a bundled character and switches language in
place through the existing preference event. The scene preview remains the
same and no conversation is created until the start button is clicked. It then
creates exactly one conversation through the real device adapter and stores a
Japanese draft. Opening/closing the model picker retains that draft.

The device tutorial advances to step 2, shows the local-processing disclosure
without BYOK instructions, and switches language without losing the step or
draft. The actual IndexedDB conversation records, including revisions and
payloads, remain identical. Completing, reopening and skipping the guide writes
only the existing browser receipt; conversation records still match. The driver
then repeats explicit worker update, other-tab rejection, offline reload and
full browser-process close/reopen checks from the preceding PWA phase.

All four conditions recorded **0 API requests, 0 external requests and 0 page
errors**. Entry/guide/chat viewports have no horizontal overflow. English mobile
guide and post-restart screenshots were inspected. These checks use actual
App, Native static serving, Service Worker, IndexedDB and localStorage. They
do not prepare or run a model or impersonate an HTTP Runtime.

Local summary: `.artifacts/unified-chat-entry-browser-results.json`. The selected
output also contains `results.json`, `server.log`, disposable profiles and
`*-entry.png`, `*-guide.png`, `*-offline.png`, `*-offline-restart.png` captures.
Machine-specific absolute paths remain only in local evidence.

Reproduce after building the unified app and installing Playwright's Chromium:

```text
python tests/e2e_unified_pwa.py --dist <unified-build> --output <fresh-output>
```

## Limits

Eligibility/preferences and worker release markers are fictional fixtures.
Offline traffic is blocked; offline status text additionally uses the explicit
DevTools renderer-state emulation described in
[Unified PWA](2026-10-26-unified-pwa.md). This is not physical network switching.

This is not complete English coverage: other screens, detailed conversation
actions, configuration fields and some recovery/provider notices remain to be
reviewed. Authored Japanese names/messages are intentionally preserved.
OS IME, real inference, Android/iPhone, actual Cloud/Remote routing, hosted
eligibility/adult checks, commercial connections and production rollout are not
qualified by this phase. Prior distribution candidates remain tied to their
recorded source revisions and must be rebuilt before releasing these changes.
