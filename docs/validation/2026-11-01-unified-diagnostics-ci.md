# Diagnostic audit equality on hosted CI

Both PR `41246402734` and push `41246397891` for `c41d5c8` failed the Web
test step. The PR logs show Ubuntu timing out two diagnostic audit cases and
Windows timing out three, all at the unchanged 5,000 ms test deadline. The exact
expanded-alias case took 6,734/9,258 ms; malformed-final-JSON checks took up to
8,722 ms. Other files passed. This is distinct from parent `543c903`'s earlier
Chromium `ERR_NO_BUFFER_SPACE` navigation failure.

The tests compared multi-MiB typed arrays with a recursive deep matcher. The
correction uses Node's `Buffer.compare` for every actual byte, and independently
retains exact metadata, part ordering/keys and part count comparisons. The same
input sizes, complete export equality, SHA/byte counts, inline boundary, malformed
JSON rejection, preservation checks, deadlines and worker parallelism remain.
No product code, dependency, CI setting, retry or timeout is changed.

## Local evidence

| Original test | Before | After |
|---|---:|---:|
| Expanded alias, exact bytes | 3,683.6 ms | 341.0 ms |
| Malformed tail after inline cutoff, read | 3,114.1 ms | 139.0 ms |
| Malformed tail after inline cutoff, export | 3,172.3 ms | 114.1 ms |

Both focused runs pass all 27 audit cases. These timings are development-host
measurements, not hosted performance guarantees.

A fresh fixed `c41d5c8` export with **only the audit test correction** passes
**1,683/1,683 Web tests** with default worker parallelism. All **1,188 tracked
exported inputs** are hashed before/after; the test file is the sole difference
from the fixed export and no source changes during the run. Existing installed
dependencies are linked locally; this is not a fresh install or the exact hosted
Node/Python environment. Private evidence is in
`.artifacts/audit-ci-c41d5c8-20261101-03/` and
`.artifacts/canonical-audit-equality-{before,after}-20261101.json`.

The first private launcher failed argument binding before testing; the second
could not create its dependency junction under the sandbox. Neither produced
test results. The fresh third attempt used the same fixed source and assertions
with permission for workspace-only junction creation. No old run was restarted
because of an observation delay.

Hosted confirmation is still required. The earlier browser resource failure,
production, physical-device, capacity and provider/region gates remain separate.

## Additional v4 fixture expectations

Follow-up `f7f8844` passed the hosted Web step. Its completed Ubuntu job
`124673493786` then failed `e2e_outbox_guard.py`: the final fixture still required
`db.version===3` although the production writer intentionally opens v4. A targeted
inventory also found that stale expectation in `sync-selection.html`.

Both expected versions now require **4**; index, key-cursor, ownership, exact
original preservation, streaming, quota, withdrawal and corruption assertions
remain. The product schema/writer is unchanged. Current local real Chromium
passes **11/11 outbox guard** and **15/15 selection sync** cases; the latter pins
before/after source hashes and verifies browser/context/server cleanup. This is
not a claim that the earlier unrelated navigation resource failure is fixed.
Evidence: `.artifacts/outbox-guard-v4-20261101/`,
`.artifacts/sync-selection-browser/`, and their `*-v4-20261101.log` files.
