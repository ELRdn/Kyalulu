# Native and Mobile package validation — 2026-10-30

These local, unsigned candidates use clean corresponding source from
`232c2ee0afbef784791e6b07530d4291590e78d2`. That source passed 845 Web tests and
the unified build. The later same-document target-switch defect makes these
candidates **superseded**; successful packaging and recovery checks are not
permission to publish them. New candidates must include the
[routing correction](2026-10-29-unified-runtime-routing.md).

## Windows artifact and isolated CLI

The existing native builder bundled managed CPython **3.13.7** and **33 locked
Python dependencies**, the unified UI and corresponding application source.
The tar has **8,705 regular, unique, safe members**, **217 product files**
matched to the clean build/source, and **559 corresponding-source files** matched
byte for byte to the committed Git export. All four general research scenarios
load under the bundled interpreter. Its actual ASGI static server supplies
main, isolated device and neutral migration documents with their expected
headers, without importing developer Python packages.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Windows runtime tar | 140,128,892 | `7f093472a5299fc39dbf995cad5083fe09360f8b0acb1cc9b3f3cd3a57ff711d` |
| Unpublished packed CLI | See local audit | `434591330c8b85811abd4d5d924dbbdfb398857c37e08af561fa7aadb48202bd` |

`scripts/verify_npm_beta.mjs` ran the packed CLI with an isolated home/data root,
empty PATH and no developer Python configuration. Its fictional chat/memory
survived start/restart, backup/restore and rollback. Invalid restore, failed
update and failed startup preserved the correct data or owned process; an
unrelated fixture HTTP process remained alive. All seven update/rollback pointer
write/rename failures preserved the running instance. A successful update
committed pointers before shutdown. The owned Runtime was stopped afterward.

This is a development host with isolated data and PATH. `clean_os_accepted` and
`first_download_verified` remain **false**. It does not prove a fresh machine,
first public download, real model, physical device or production backup recovery.
Native `device_accepted` and `license_reviewed` gates remain **false**.

## Legacy Mobile candidate

`build:mobile` and `scripts/mobile_release.py` produced **78 Pages files**,
**77 hashed manifest entries** and **40 verified precache entries**. The largest
file is **16,811,691 bytes**, below the 25 MiB Pages limit. The source ZIP has
**784 safe, unique regular members**, including shared runtime/schema/renderer
sources. Its SHA-256 is
`a0c73cc76b9c805062f0bfff76180b13ae39859ac95c7e27a67340aca5d71a68`.
Eight upstream license copies and migration/inference-worker policies matched.

All 559 source files match the clean Git export byte for byte. Compared directly
with Git blobs, 30 match and 529 differ only by UTF-8 text CRLF line endings;
strict UTF-8 decoding and CRLF-to-LF normalization prove no other content change.
The audit retains the raw-byte mismatch and its strict-audit failure separately
from successful export/content verification. No package bytes were normalized.

## Evidence and remaining work

Local ignored records are `.artifacts/unified-native-232c2ee-audit.json` and
`.artifacts/unified-mobile-232c2ee-audit.json`. Build outputs and CLI fixture data
are in a new task-specific temporary source tree; old candidates were preserved.

WASM uses existing pinned outputs and has not been rebuilt. macOS packaging,
clean-OS/Node-only installation, signing, license acceptance, real model/device
tests and public delivery remain open. No npm/GitHub release, Pages deployment,
production DB change, provider connection or real-user restore occurred.
