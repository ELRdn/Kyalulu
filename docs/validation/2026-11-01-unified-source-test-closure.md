# Corresponding source: test and CI input closure

The 9269b5f source-only audit checked imports reachable from its existing allowlist.
That scope missed 85 of 187 tracked files under `tests/`, including the Research
driver despite earlier delivery notes describing it as included. Nine of the 40
script entrypoints in `runtime-web.yml` were absent. A scoped source audit was
therefore insufficient evidence that the shipped test suite could be reproduced.

The collector now explicitly includes all 187 reviewed test files, the Runtime/Web
workflow and its missing entrypoints, the artifact workflow read by pytest, 21
Python/CharacterBench helpers, the Remote wrapper input, and ten Desktop build
inputs. These are 122 existing tracked paths; this report is one additional path.
No recursive `tests/`, scripts, benchmark data or private artifact directory is
added. Existing link, path, model-credential and private-file guards remain active.
BUILD.md records the Web-test/generated-export-verifier order and Chromium prerequisite.

The new regression failed with the 89 missing direct test/workflow inputs before
the allowlist correction. The initial run could not create sandbox TEMP; an
explicit fresh workspace basetemp then reproduced the actual assertion failure.
After the direct correction, release-source/fingerprint checks passed 43 tests.

An independent dependency audit found another 33 tracked inputs. A precommit
projection used the unmodified public 9269b5f export plus exactly the collector
and regression edits, without consulting other dirty working-tree payloads or
installed renderer license data. It collected all 1,426 Python tests without
manual supplements. This projection is a development check, not an immutable
release artifact. The complete projected Python suite passed 1,426 tests plus
seven subtests in 315.47 seconds. The runner used a dedicated workspace TEMP and
basetemp; loopback/subprocess tests ran outside the Windows sandbox. These are
fictional-data tests, not provider or production acceptance. The final collector's
source/fingerprint/renderer-license/Cloud-bundle checks passed 63 tests in 20.56
seconds. The preceding focused run had 62 passes and one byte-comparison failure
because the parallel CI investigation changed sync-incoming.html during collection;
the stable rerun retained the comparison. Final committed-source collection remains
separate from this precommit projection and working-tree focused check.

Private evidence is under `.artifacts/release-source-closure-20261101/` and
`.artifacts/release-source-dependencies-20261101/`. Only public-source paths,
test results and bounded audit conclusions belong in this report.

This change does not validate real GGUF tokenization, stock Mocha context fit,
clean-OS installation, dependency acquisition, physical phones, WASM compilation,
Linux images, signing, final license grants, real OAuth or production cutover.
The previously built 81e5927 Native/Cloud artifacts remain stale. Including an
artifact workflow as a pytest input does not establish that workflow's acceptance.
