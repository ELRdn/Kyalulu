# Confirmed manual corrections across regeneration and sync

An actual Device generation followed by the manual memory PATCH and regeneration
preserved the correction but produced a `before` snapshot with state turn 0 and
the original memory source turn 1. Both the browser receiver and Python bridge
rejected that supported result as a future source. Before the fix, the browser
shared fixture and actual API test fail (2 failed / 41 passed); the matching
Python fixture fails (1 failed / 7 negative cases passed).

The receivers now recognize only an explicit confirmed correction from the turn
being regenerated: `before` snapshot, `origin=model_edited`,
`source_kind=user_correction`, `confirmation=user_confirmed`, safe positive integer
version and `source_turn == before.state.turn + 1`. The existing consecutive
before/after turn check and past-only message-ID references remain mandatory.
Automatic model memories, unconfirmed edits, a different kind, unsafe version,
later source turns, `after` snapshots with future sources and future message IDs
still reject. AI-produced facts retain the fixed `model` origin; this rule does
not let a model confirm its own fact.

Device regeneration preserves the source turn, quote, generation attribution and revision.
Native retains its existing local generation mapping; the authored source turn,
quote and revision survive the tested roundtrip.
`source_revision` is opaque provenance, not authorization evidence: Native uses
an internal JSON identity wrapper. The bridge now retains an incoming revision
inside `original_source_revision` in that wrapper and restores it on export.
Older wrappers remain opaque; a missing original value is not guessed.

Both runtimes use `tests/fixtures/unified-regeneration-memory.json`. Tests cover
the confirmed case and the same negative conditions. The actual Device API test
generates a fact, manually corrects it, regenerates, receives the whole history
and branches from the user point. The Native test imports the shared fixture into
a fictional SQLite database, verifies the stored snapshot and exports it again,
then validates the result with the original authored revision restored.

Final Web regression: **1,440 tests / 91 files**;
`.artifacts/generation-commits-reviewed-web-all.log`. TypeScript and unified build
(9.43 s) pass. Related history/Runtime bridge/Native client/lineage tests:
**74 passed in 28.14 s**, `.artifacts/generation-manual-native-regression-final.log`.
The final [generation persistence driver](2026-10-31-unified-generation-commits.md)
also passes all 84 cases on the corrected source.

Earlier diagnostic failures remain in `.artifacts/regeneration-manual-source-red.log`
and `.artifacts/regeneration-manual-python-red.log`. An intermediate Native assertion
exposed the internal wrapper replacing the original revision; that led to the
preservation fix above. Native stored values use the wrapper; exported values use
the original revision when available. All databases and inference inputs are
fictional. No production, real model, physical device or full actor memory bound
is claimed.
