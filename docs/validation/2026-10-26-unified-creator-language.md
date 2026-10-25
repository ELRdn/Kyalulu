# JA/EN personas, worlds and story-rule editing

Product logic: `31e7495`; final CSS: `89d4a6f`. The isolated validation source
began with a clean Git export/collection of `31e7495`. Only the one changed
`lab.css` file was copied from `89d4a6f` before the final build and browser checks.
No unrelated work or pending Core restore changes were included.

## Changes

- Persona/world fields, lists, versions, explicit save/import/export actions,
  notices and known import failures follow JA/EN. Display language does not
  trigger the kind-loading effect or rewrite authored text, IDs or versions.
  Saving still creates a new version; existing chats retain their selected one.
- The shared cast/RPG editor translates names, knowledge/relationship labels,
  validation, selected-runtime behavior and inert examples. Character IDs,
  schema limits, command keys, saved rules and partially typed JSON stay intact.
  Invalid JSON remains visible and prevents saving until corrected. Unsupported
  story capabilities retain saved values and keep controls disabled.
- The persona/world editor is keyed by the existing owner state in App, so an
  owner change disposes the previous owner's unsaved editing state. Saved
  documents and their version histories are retained in their original namespace.
  Language changes keep the same owner/key and retain the active draft.
- Story text fields now use the full label width. The shared lab rule had applied
  checkbox flex layout to every fieldset label, putting text beside narrow
  inputs. It now applies only to labels containing checkboxes; model checkboxes
  keep their existing layout.

## Evidence

- Related creator-language/error suites: **71 passed**.
- Full clean-source Web suite on the final product logic: **736 passed / 59
  files**. The only subsequent product change is the one CSS selector above.
- Web typecheck and final-source unified build: passed. Existing Node localStorage
  and Vite script/externalization/chunk warnings remain.
- Unit checks retain original settings, stable export version targets and
  explicit-only save, reject oversized imports before reading bytes, retain
  invalid JSON/capability denial and block duplicate-cast/world validation errors.
- The final build passes the extended `tests/e2e_unified_pwa.py` against the real
  Native static server, actual Device IndexedDB adapter and Chromium in four
  fresh disposable profiles:

| Initial language | Width | Theme |
|---|---:|---|
| JA | 393 px | Light |
| EN | 393 px | Dark |
| JA | 1280 px | Dark |
| EN | 1280 px | Light |

Each condition switches both languages during editing. The browser saves a
fictional persona as version 1, changes its description and explicitly saves
version 2. The same stable entity retains both versions. Downloading version 1
through RuntimeDownload yields exactly the original stored document, rather
than the edited version or a plaintext Runtime URL.

It then creates a world with a named cast member, private fictional knowledge
and RPG settings. Invalid partially typed JSON survives the language switch and
keeps Save disabled; correcting it allows explicit saving. Stored cast text,
HP and skill keys retain their original values. The JSON field occupies at
least 90% of its label region in all four conditions, with no horizontal document
overflow. The English mobile rule-field capture was visually inspected after
the CSS correction.

Changing the fictional owner clears the previous unsaved name/world editing
state. A separate persona is then saved for that owner, and its completed list
contains exactly that one setting. The original owner's two complete IndexedDB
records remain equal to their pre-switch snapshots. Switching back retrieves
the original persona's second version; all three records retain their owners.
The original conversation's payload/revision and composer draft remain intact
when returning to chat. Only its existing recency timestamp changes on reopen.

The preceding search, management/recovery and profile checks and subsequent
explicit PWA update, another-tab rejection and full-browser offline conversation
restart also pass. Every condition records **0 server API requests, 0 external
requests and 0 page errors**; settings saves use the actual local Device adapter.

## Limits

Unsaved persona/world form state is volatile: owner switches or navigation reset
it. This change does not add persistent drafts for those forms. Saved settings,
conversation drafts and partially edited RPG text during a language switch are
distinct and covered as described above.

The browser owner switch uses fictional local namespaces, not a live OAuth account
change. Hosted Cloud/Remote creator saves, actual RPG/model generation, full
Creator import/export format acceptance, OS IME, physical phones and production
were not qualified in this phase. Eligibility and worker-update fixtures and
offline-renderer emulation retain their prior limitations. Other Create/Portable
fields still need language review. Old distribution candidates require rebuilding
at the final release revision; the whole integration plan remains open.
