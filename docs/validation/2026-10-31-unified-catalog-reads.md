# Device catalog reads

Device character, persona, World, creator, Library and prompt-preset lists previously
decoded every saved entity before filtering its kind. A large or corrupt unrelated
conversation could therefore prevent a settings list from opening.

`allEntities(owner, kinds)` now filters the stored header before restoring a body.
The seven catalog routes request their existing kinds. The default unfiltered read,
message-ID lookup, import duplicate detection, conversation history, sync and export
contracts remain unchanged. No stored schema or payload is rewritten.

## Validation

- Seven API regressions failed before the repair and pass afterward: each catalog
  opens despite an unrelated conversation with a missing body part. Stored records
  remain unchanged. Related Device read/Library suites pass (92 tests).
- Full Web suite: 1,259 tests in 83 files. TypeScript and the unified production build
  pass locally.
- Real Chromium/IndexedDB: 23 scenarios pass, including two added cases. Filtered
  reads access only the selected owner's selected-kind parts; an empty selection
  reads no body. Selected and unfiltered corruption still reject. Switching owner
  while scanning excluded headers aborts. The read and rejected read preserve data.
- Browser fixtures report zero blocked external requests and page errors. Their
  inference and accounts are fictional; the actual UI and physical devices are not
  revalidated by these storage checks.

This isolates catalogs from unrelated bodies. It does not establish bounded memory
for a selected conversation, full history rendering/generation, or 1 GB restoration.
