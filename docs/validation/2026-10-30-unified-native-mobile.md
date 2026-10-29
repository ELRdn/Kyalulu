# Native and Mobile package validation — 2026-10-30

The first, historical record below uses clean corresponding source from
`232c2ee0afbef784791e6b07530d4291590e78d2`. That source passed 845 Web tests and
the unified build. The later same-document target-switch defect makes these
candidates **superseded**; successful packaging and recovery checks are not
permission to publish them. New candidates must include the
[routing correction](2026-10-29-unified-runtime-routing.md).
The corrected fixed candidates are recorded at the end of this document.

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

## Corrected fixed candidates: b133ce0

Clean corresponding source from
`b133ce0cbcc02d168db444d1bc20c20379c1a3b8` includes the target-switch correction.
Its **851 Web tests / 66 files** and unified build passed. The actual commercial
fixture passed **24/24 cases, 472 checks**, including blocked unregistered PCs
and explicit Cloud return with the original draft. These candidates replace the
superseded artifacts above.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Cloud tar | 65,973,573 | `d3a48e955b08d91dbae6b5d7d30a60306d15edf29432d5a760492842e57c980e` |
| Windows runtime tar | 140,134,789 | `ea6f1d9fd133833c9475c75fbb8b50eabbd1670e6fca2f2cc48c47fa0ee5cc4f` |
| Mobile corresponding-source ZIP | 16,396,388 | `4e886d11f492119241a7429e90d2766757927be1853d44b1ed227252bc60f9e7` |

The Cloud archive passed **223 manifest**, **220 build/source** and **61 precache**
comparisons. The Windows archive has **8,706 safe regular members**, **217 matched
product files**, Python 3.13.7 and 33 locked dependencies. Its packed CLI was
rerun with an empty PATH and isolated fictional data: start/restart, memory/chat
persistence, backup/restore, rollback, all seven pointer failures and preservation
checks passed. The owned Runtime was stopped; no process record remains. The
bundled interpreter independently loaded all four scenarios and verified static
main/device/migration headers.

The Mobile candidate passed the same **78 Pages / 77 manifest / 40 precache**
checks and the 25 MiB limit. Its safe source ZIP now has **785 members**. All
**560 committed-source files** match the Git export exactly. The 530 raw Git
differences are strictly verified UTF-8 CRLF-to-LF changes, while 30 files match
raw bytes. Export/content acceptance and strict raw-byte equality remain separate.

Local audit files are `.artifacts/unified-release-b133ce0-audit.json`,
`.artifacts/unified-native-b133ce0-audit.json` and
`.artifacts/unified-mobile-b133ce0-audit.json`. Build outputs remain in the
task-specific temporary source tree. CI results are separate from these local
checks; the `232c2ee` Ubuntu failure must not be described as a passing CI run.

All gates and limits above remain: no fresh WASM build, macOS/clean-OS/physical
device acceptance, signing, license acceptance, public download or production
recovery is claimed. The latest Cloud tar has not been uploaded or built as a
Linux image; `bf83d03` image evidence cannot validate its newer client code.
