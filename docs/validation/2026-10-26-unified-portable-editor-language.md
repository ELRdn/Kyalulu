# JA/EN Portable editor details and retained drafts

Application source: `592016b`. Browser driver correction: `f5b1bec`.
Final scope-change test: `611df45`.

Validation used a clean Git export/collection of `592016b`, with only the later
committed test files copied from Git. Existing WASM outputs were reused. Unrelated
working-tree changes were excluded; no dependency or lockfile changed.

## Behavior

- All three editor kinds, six character tabs, lore conditions, greeting previews,
  creator notes, tags, media roles/rights and generation-preset details follow
  JA/EN. Dynamic labels, required markers, character/item counts, placeholders
  and accessible names also follow the current language.
- Authored content, unknown fields, dictionary entry keys, source data, asset
  references, preset versions and stable schema/parameter keys remain original.
  Changing editor labels does not fetch a model or save a document.
- Invalid JSON retains its raw text and validation state while switching tabs or
  language. Errors render in the current language; Library Save stays disabled
  until the JSON is fixed. JSON fields stay mounted when their panels are hidden.
- Upload errors retain their Error/status metadata until rendering. Local size
  and format errors use the shared formatter. A late image-upload rejection from
  another connection scope is ignored, matching the existing media-upload guard.
- Rights confirmation, 32 MiB limits, supported MIME types, Cloud upload
  restrictions and explicit playback remain enforced.

## Evidence

- Related editor/Create/error suites: **81 passed** before the final scope-change
  case. Final editor boundaries: **8 passed**; full final-source Web suite:
  **755 passed / 62 files**. These counts overlap.
- Typecheck and unified App build passed. Existing Node localStorage, WASM
  externalization, theme-init and large-chunk warnings remain.
- Unit fixtures cover all three kinds in both languages, with no Japanese fixed
  labels in English output; original fields remain unchanged. They also cover
  invalid JSON and validity callbacks, dictionary lore edits, keyboard tab
  navigation, composing Enter suppression, retained HTTP errors, old-scope
  rejection suppression, Cloud restrictions, rights and pre-upload size checks.
- `tests/e2e_unified_pwa.py` passed four actual Chromium/Native-static conditions:
  JA 393/light, EN 393/dark, JA 1280/dark and EN 1280/light. Each condition:
  - Edits keyword/lore fields and an uncommitted tag, then enters incomplete JSON.
  - Switches language and tabs without losing the raw JSON, tag or lore content.
  - Verifies `aria-invalid`, translated validation and disabled Library Save.
  - Fixes JSON, saves two stable Library versions, checks original lore and
    numeric generation settings in IndexedDB, and downloads the selected export.
  - Retains the existing exact draft/request record through reload and editor
    close/resume, and repeats import/duplicate cancellation, uncertain-send,
    explicit PWA update and offline full-browser-restart checks.
- Every browser condition had **0 server API requests, 0 external requests and
  0 page errors**. There was no document-width overflow. Small-screen/light and
  desktop/dark editor screenshots were visually inspected.
- Local evidence: `.artifacts/unified-portable-editor-browser-results.json`;
  the isolated browser output also contains `*-portable-json-review.png`.
  The first browser run stopped because its reload locator expected the old
  language; correcting the driver and rerunning all four conditions succeeded.
  Initial unit mock/fixture expectations were corrected before the final runs.

## Limits

Browser evidence uses the real Device adapter and fictional IndexedDB data.
Cloud restrictions, HTTP errors, rights checks and late upload results use unit
fixtures; actual Cloud/linked-PC media services were not exercised in this phase.
In-progress JSON/tag text is volatile editor state: this change proves language
and tab retention, not persistence of invalid text across reload or browser exit.
The reload checks use corrected, valid document drafts in sessionStorage.
Real models, providers, native OS IME, Android/iPhone, signed distribution and
production rollout remain unqualified. This is not full-plan or release acceptance.
