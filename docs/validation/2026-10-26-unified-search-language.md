# JA/EN navigation, exploration and explicit search

Product source: `e3d4f7a`, following `9d2b071`. The isolated build began with a
clean Git export of `9d2b071`; only `Discover.tsx` and its search-language test
changed afterward and were copied directly from the final commit. No unrelated
or pending Core changes were included.

## Changes

- Shared navigation, search, theme/sidebar controls, guest/login labels and
  mascot daily text now follow JA/EN. Navigation targets and management access
  remain the same. Default conversation labels are translated only for display;
  authored names and stored IDs remain unchanged.
- Explore translates headings, search/mood controls, counts, empty/failure
  states, world-selection guidance and Hub controls. Errors keep their cause
  and are translated when rendered. Switching language does not add a catalog
  request or reset the query. The world-selection note still explains that a
  world is attached after starting a conversation, rather than promising that
  selecting it filters the character catalog.
- Both Explore and the command palette match known mood labels in Japanese and
  English regardless of display language. Stable tag aliases, filter URLs and
  ordering are retained. Palette page/action keywords also retain both languages.
  This prevents an existing Japanese or English query from losing its results
  merely because UI language changed. Unknown authored tags remain original.
- Hub UI translates source metadata, pagination, download/cancel/review actions
  and known source-download errors. Reviewed pinned content and source-classified
  SFW content retain their distinct descriptions. Imported text, attribution,
  license values, URLs, request options and abort behavior remain unchanged.
  External-link warnings still explain that those sites may include content
  outside Kyalulu's SFW listing; links retain opener/referrer protection.

This adds no automatic import, provider activation, analytics event or new
recommendation analysis. Explicit palette search still includes stored recent
conversation previews as before; it does not feed those previews into ranking.

## Evidence

- Related search-language and Hub transport suites: **13 passed**.
- Full collected-source Web suite: **713 passed / 56 files** after the final
  singular-count correction; Web typecheck and `build:app` pass. Existing Vite
  script/externalization/chunk warnings remain.
- Unit checks cover bilingual results/filter IDs, menu/Hub permission boundaries,
  retained failures, raw source metadata and license values, explicit-only import
  review, seven external-link protections, unchanged authored conversation names
  and IME guards. Hub operations in these tests use fictional mocked responses;
  they do not contact a source site or qualify a live provider.
- Real built App + Native static server + Chromium checks passed in four fresh
  disposable profiles:

| Language | Width | Theme |
|---|---:|---|
| JA | 393 px | Light |
| EN | 393 px | Dark |
| JA | 1280 px | Dark |
| EN | 1280 px | Light |

The driver opens the actual command palette, searches for `butler`, switches
language and retains the input and matching character. A composing Enter event
does not navigate. An ordinary Enter opens Explore; selecting the mood keeps
`q=butler&mood=butler`. Language changes preserve the exact URL, query and result
links. The Japanese query `執事` matches the same character. The selected mood
has `aria-pressed=true`, while All has `false`; the driver awaits the actual
Router update rather than reading immediately after click.

Device management menus and Hub retrieval tabs remain absent. Search continues
into the existing character/guide/draft/update/offline-restart checks without
preparing a model. All four conditions recorded **0 API requests, 0 external
requests and 0 page errors**, with no horizontal overflow. The English 393px
Explore capture was inspected. Screenshot transitions are completed with
Playwright's animation option; product CSS is unchanged.

The first test attempt targeted all `option` roles, including the native
execution selector. It was corrected to scope candidates to the palette. A
later immediate ARIA assertion ran before Router state committed; it now waits
for the same expected attributes. Neither correction relaxes the product or
changes the expected search/filter behavior.

Local summary: `.artifacts/unified-search-browser-results.json`. The selected
output also contains `results.json`, `server.log`, disposable profiles and
`*-explore.png`, entry/guide and offline/restart captures. Absolute machine paths
remain local. Reproduce after a unified build and Playwright Chromium install:

```text
python tests/e2e_unified_pwa.py --dist <unified-build> --output <fresh-output>
```

## Limits

Eligibility/preferences and worker version markers remain fictional fixtures.
The IME check uses a composing keyboard event, not an OS keyboard. Offline status
uses the renderer emulation documented in [Unified PWA](2026-10-26-unified-pwa.md),
separately from the uncached-network rejection and browser-profile restart.

This does not qualify actual Hub downloads/imports, hosted Cloud/Remote routes,
adult/provider contracts, real models, physical phones, OS IME or production.
Other screens, detailed conversation actions, creator fields and some notices
still need language review. Authored Japanese tags, names and messages remain
visible as original content. Prior distribution candidates retain their recorded
revisions and require rebuilding before these changes can be released.
