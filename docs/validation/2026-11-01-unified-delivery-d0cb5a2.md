# Fresh Native and Cloud candidates from d0cb5a2

Built offline from immutable public commit
`d0cb5a297254b2718611ac1eb9daca8b969c574f`. This is local Windows development-host
delivery evidence. It is not production, clean-OS, Linux-image, real-model or
physical-device acceptance. Artifacts have not been published or deployed.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Windows Native tar.gz | 142,348,938 | `0a7d131c94bcd0d237d6a78841a809c9fad7b5ca300726a3705ca0e92ba0ef38` |
| Unified Cloud prebuilt tar.gz | 67,109,087 | `b93f8e97cc0be8f0f261771ea6332e1c60e792229a4c06c36e77724c82a87b75` |
| npm launcher tgz | 18,794 | `3fa9cd62ffbec9cdfea55cfb6e82c2a1c5694cc4a0bae683b09b21981e5b48b4` |

## Source and build boundaries

The 1,194-file Git export was checked before building. Lockfiles match the
previous cache provenance. All 15,399 copied input files were hash-verified in a
fresh task directory; no shared cache, tracked source or global installation was
modified. Catalogs, Native UI and unified Cloud UI were freshly built. The exact
four pinned WASM outputs and ten license texts were reused and checked, rather
than claimed as a new WASM compilation. Python 3.13.7 was replayed from the verified
existing interpreter archive because the pristine uv installer cache is absent.

Native has 9,041 regular safe archive members; Cloud has 236, including 235
independently checked manifest entries. Each contains identical corresponding
source: 1,109 files, consisting of the standalone 874-file offer plus 235 installed
renderer license texts. All 81 paths changed since the retained 6c508d7 baseline
are included; the former self-test exception is gone. Export/blob derivation,
fresh UI bytes, 61 precache entries, compressed assets, requirements hashes and
isolated Device headers were checked. The standalone source offer separately
passed 63 focused tests. The precommit Python projection passed 1,426 tests plus
seven subtests; these are not a fresh packaged-runtime regression execution.

An initial parent audit predicted 1,090 source files by combining the 81e5927
package count with the later 9269 source-only baseline. That count assertion
failed. The preserved investigation identified all 143 additions since 81e5927,
zero removals and all 235 renderer texts; both actual source trees are byte-identical
at 1,109. The corrected check preserves source equality and exact set accounting.

## Packed execution and dependency provenance

The actual npm-packed launcher passed startup/restart, fictional restore/rollback,
seven pointer-fault cases and process-exit checks. The freshly packed Native UI
passed JA/EN settings/diagnostics and draft/history restart checks with mock inference.
Browser evidence reports zero external requests, page errors or real inference
attempts; its Runtime processes exited. This does not test real GGUF context fit.

All 108 Runtime files and 6,548 interpreter files match the retained verified
baseline. Of 1,151 vendor files, 1,133 are identical. The remaining nine generated
PE launchers differ only in bounded interpreter-path resource/shebang data and
associated resource-layout sizes; executable sections and module bodies match.
The corresponding nine RECORD files contain exactly those verified hash/size
changes. Prior 36 Runtime regressions and 75 origin assertions per mode are retained
only as prior-source evidence after checking their exact test/module bytes.

All Native bytes remain scanned. Exactly two known vendor signatures were
classified by exact path/file hash, cache origin, wheel RECORD and locked uv wheel
metadata: cryptography's public key-format delimiter and Pillow's embedded font
substring. Six rejection checks cover unknown vendor signatures and altered bytes
at the known paths. No broad vendor exclusion is used; uncached wheel archives
were not newly downloaded or rehashed. Interpreter bytecode is limited to the
1,148 files identical to the verified interpreter origin.

## Evidence and open conditions

Private evidence and complete member manifests:
`.artifacts/portable-delivery-d0cb5a2-20261101/results.json`, `SHA256SUMS`,
`immutable-source-map.json`, Native/Cloud audit reports, packed CLI/browser results,
the source-count investigation and interpreter/vendor classification reports.
The independent PE/vendor comparison is
`.artifacts/portable-delivery-d0cb5a2-parent-check.json`.

`license_reviewed`, `three_license_grants_confirmed`, `signed`, `clean_os_accepted`,
`device_accepted`, `release_accepted`, `production_selected` and `published` remain
false. The unconfirmed grants are guid-typescript 1.0.9, noise-c.wasm 0.4.0 wrapper
and stackback 0.0.2. Linux wheels/interpreter/image, macOS, first public acquisition,
real models/capacity/phones, provider/region conditions and production recovery
remain outside this acceptance. Stock Mocha plus memory still exceeds the existing
conservative GGUF guard; native tokenizer/template support is unimplemented.
Supabase URL values remain unread because the browser tools cannot access the
owner's logged-in screen. No Auth, DNS, provider, production or merge operation ran.
