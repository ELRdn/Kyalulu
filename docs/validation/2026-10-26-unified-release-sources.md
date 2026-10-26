# Unified corresponding source and unsigned distribution candidates

## Changes

The Web TypeScript project includes its tests. Seven referenced JSON fixtures
were missing from corresponding source, so builds from that source could fail
despite passing in the developer checkout. The collector now carries all nine
referenced fixtures, and release evidence fingerprints include their contents.
The regression scans fixture references under Web source and checks that their
exact bytes are delivered.

Legacy Mobile now uses the same allowlisted collector as Cloud and Native,
including catalog originals, Python catalog generation code, renderer license
texts and build instructions. This removes its separate incomplete allowlist
and applies the existing private-file and path/link checks to its source zip.

Native packaging now includes the runtime's scenario YAML files. Native static
serving also applies the inference CSP/COOP/COEP to `/device`, `/device/` and
`/device/index.html`, and the separate migration policy to the corresponding
`/migration` paths. Missing document builds return 404 rather than the main
shell. Ordinary app documents remain outside inference isolation.

## Bounded evidence

Source revision: `9caa68523be376c282791635e63fe7fd80817b62`.
The initial Git archive was `45983ab`; subsequent changes to delivered inputs
were copied directly from their commits (`build_local_bundle.py` and
`runtime/python/api/mobile.py`). No dirty working-tree files were copied.

- Release-source/fingerprint/bundle/readiness and Native Mobile tests: **84 passed**.
- Corresponding-source Web suite: **690 passed / 52 files**.
- Frozen pnpm install with lifecycle scripts disabled; existing cache was
  incomplete, so pinned public npm packages were fetched without changing locks.
- Catalog and casefold data regenerated from collected originals; both matched
  the committed generated files byte for byte.
- `pnpm --filter web build:app` and `build:mobile` passed from collected source.
  Existing Vite nonmodule-script, Node externalization and large-chunk warnings
  remain; these checks do not establish rendering or model quality.
- Unified precache: **61** assets verified, including compressed/original hashes;
  generated device/migration headers and relative base verified.
- Cloud candidate: all **221** manifest entries and outer SHA-256 verified;
  nested corresponding source contains **734** regular files, exact fixtures
  and nonempty renderer license notices.
- Windows candidate: **8,654** regular archive files; embedded Python **3.13.7**
  loaded all four general research scenarios from the extracted artifact. Its
  bundled FastAPI/httpx dependencies exercised the actual Native static server
  against the built HTML and verified device/migration headers. No developer
  Python packages were added to that subprocess's import path.
- Legacy Mobile: **40** precache assets verified, **78** Pages files; largest
  file **16,811,691 bytes**, within the 25 MiB limit. Its shared-source zip is
  **16,220,356 bytes**, also within the limit.

Build outputs are in a fresh C-drive validation directory because the workspace
drive had about 20 MB free. No workspace data was removed to make room.
Local evidence: `.artifacts/release-source-regression.xml`,
`.artifacts/release-artifact-verification.json`, and the preparation/check
scripts `.artifacts/prepare-clean-release.py` and
`.artifacts/verify-clean-release.py`. Generated artifacts are not committed.

## Inventory

Paths below are relative to the fresh, isolated release validation directory.
Its machine-specific absolute path is retained only in the local evidence.

| Candidate | Path under local root | Bytes | SHA-256 |
|---|---|---:|---|
| Cloud tar | `cloud-bundle-9caa685/kyalulu-cloud.tar.gz` | 65,797,873 | `a0719fe08b5d341896fdb7322ba7063b45174c9d13ca77d196d672384990355e` |
| Windows tar | `native-bundle-final/kyalulu-0.1.0-beta.1-win32-x64.tar.gz` | 139,839,146 | `01b9313f9e4371d84c66464ea5d8dde11cf6fad6d5fa5b3d594ffb9d78c931ab` |
| Mobile corresponding-source zip | `source/.artifacts/mobile-pages/source/kyalulu-mobile-source.zip` | 16,220,356 | `1e2acf6ef1f860b81b5d3f55f929a34b3d7422760e4800e133a89f3aa4be5dfe` |

Commands used in the isolated source: `python scripts/build_app_catalog.py`,
`pnpm install --frozen-lockfile --ignore-scripts`, the Web build/test commands,
`python scripts/prepare_cloud_bundle.py --unified --output <fresh-output>`,
`python scripts/build_local_bundle.py --output <fresh-output> --release
0.1.0-beta.1 --target win32-x64 --web-dist .artifacts/unified-app`, and
`python scripts/mobile_release.py`. Python build tools used the existing project
environment. Native dependencies and interpreter were freshly bundled via the
pinned builder, not copied from that environment.

## Limits and recovery

These are unsigned local candidates. The acceptance gates in the Native
manifest remain false. WASM binaries and their upstream license files were
copied from the existing pinned build outputs; recompiling their toolchain,
bit-reproducible archives and a full license review were not established.
Mac packaging, a clean Node-only install, actual LLMs, physical phones, browser
cross-origin isolation, and full offline/restart behavior were not qualified by
this phase. SHA-256 checks provide integrity, not a publisher signature.

Old candidates are retained in separate directories. Validation extraction used
a new `native-extracted` directory and no real accounts, Runtime lifespan,
operator databases or production endpoints. For an actual rollout use the
existing migration/recovery instructions in `docs/UNIFIED_APP.md`; preserve
outboxes, receipts, owner records, credits and Remote keys. Whole-DB Core restore
remains unaccepted and its corrective implementation is pending specific review.
No release upload, deployment, DNS change or provider activation occurred.
