# Incremental sync receive and commit parsing

2026-10-26. Application source `8354dcc`. Local acceptance using fictional data;
no production database, funds, provider connection, deployment or merge changed.

## Behavior and boundaries

Browser downloads, Native downloads and Cloud transfer commit no longer assemble
one byte array for the entire encoded JSON document. Their shared-format parsers
decode UTF-8 incrementally, frame JSON containers and delegate individual scalar
validation to platform `JSON.parse` or standard-library `json.loads`. No parser
dependency, plaintext temporary file, transfer format or persistent schema is added.

The original request ID, size, part hashes, total SHA-256, owner/revision gates,
receipt replay and existing atomic storage paths remain in use. The parsed tree
stays private to the receive operation until every byte/hash and syntax check
succeeds. Native and Browser also recheck consent before exposing it to storage.
Cloud parse failures do not call `push`, create a receipt or discard the staged
source immediately; the existing temporary-stage expiration policy still applies.

Container grammar rejects missing separators, trailing commas/values, incomplete
documents and invalid UTF-8. A leading UTF-8 BOM remains accepted. Duplicate keys
retain native JSON's last-value behavior. Browser object properties are defined
as own data properties, including `__proto__`, without invoking a prototype setter.
Parsers close after failure/completion and cap container depth at 64; application
payload validation retains its existing tighter depth and content constraints.

## Verification

- Shared `tests/fixtures/json-stream.json`: **14 valid documents, 37 malformed
  documents and 6 invalid UTF-8 sequences**. Both implementations exercise byte
  widths 1/2/3/7/64/1024 as applicable, including Japanese, emoji, escaped quotes,
  Unicode escapes, duplicate/prototype keys, BOM, truncation and trailing input.
  Deterministic comma mutations at each ASCII corpus position match native JSON
  acceptance; terminal-state and depth refusal are checked separately.
- Cloud/Native/JSON/transfer/client/scopes/API/cleanup subset: **70 passed**.
  Malformed staged inputs retain their encrypted stage and create no entity or
  receipt. A Native receive with valid individual parts but an invalid total hash
  leaves target chat rows empty, cursor at zero and the original PC's 29 fictional
  messages intact. Existing restart, quota, encryption, conflict, deletion and
  owner/token boundaries remain covered by these related tests.
- Python parsing consumes **over 84 million encoded bytes** from 6,000 fictional
  records. Peak traced allocation minus allocation still retained after parsing
  stays **below 12MiB**. The decoded result remains allocated and is checked in
  full. Input construction is outside tracing. This measures parser overhead,
  not process RSS or a complete sync transaction.
- Web receive tests additionally cover invalid total hash, syntax, trailing data,
  UTF-8, root shape and final consent withdrawal. References never acquire a
  partial payload. Scalar parsing/UTF-8 decoding are instrumented to detect an
  accidental whole-document decode/parse in the many-message fixture.
- Clean committed corresponding source, frozen offline dependencies:
  **780 Web tests / 65 files**, TypeScript, unified App build and **11 actual
  Chromium/IndexedDB scenarios** pass. Existing Node localStorage, dependency-script,
  static-script, browser-external and bundle-size warnings remain.
- The 11 browser scenarios extend the prior 6 upload/guard cases with successful
  receive, invalid total hash, truncated syntax, invalid final UTF-8 and final
  consent withdrawal. Each receive reads 3 parts. Success updates 28 messages and
  cursor 11→12; failures preserve the exact original record, cursor 11 and absence
  of a remote receipt. Largest UTF-8 decode input: **1,048,576 bytes**; largest
  scalar parser input: **33,002 UTF-16 units**. External requests: **0**. These use
  real sync/storage modules with a fictional peer, not production authentication.

Reproduce the affected checks:

```powershell
pnpm --filter web test
pnpm --filter web build:app
python -m pytest tests/test_json_stream.py tests/test_unified_entity_transfers.py tests/test_native_sync_client.py tests/test_native_sync_scopes.py tests/test_native_sync_api.py tests/test_entity_transfer_cleanup.py -q
python tests/e2e_outbox_guard.py
```

Browser summaries are in `.artifacts/outbox-guard-browser/results.json` in the
verification source tree. Corresponding source includes the browser driver,
HTML and shared JSON fixture. The driver owns its loopback server and fresh
fictional browser stores; no existing browser profile is used.

## Remaining acceptance

Decoded entity trees and individual scalar tokens still remain whole. Native
capture/outbox serialization and canonical hashes, Cloud encrypted writes and
history hashes, Browser IndexedDB records, cache reads and historical/library
clones still need segmented storage/projection. The receive parser removes the
encoded-document buffers; it does not establish bounded total application memory.

**250MB/1GB single-conversation and account-capacity acceptance remains open**, as
do large single-string behavior, old-snapshot recovery at scale, forced-termination
durability, physical phones and production rollout. Final packages must be rebuilt
and audited from completed integration source; the old `0d9b2f5` candidate is stale.
