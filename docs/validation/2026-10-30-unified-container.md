# Fixed 897737f image: isolated Linux verification

The operator explicitly authorized this fixed public archive and the new validation directory on 2026-10-30. Real Android/iPhone verification was deferred by the operator; no PC result below replaces it. This phase did not authorize or perform production selection, backup/restore, DNS, Caddy or OAuth changes.

| Item | Accepted value |
| --- | --- |
| Application source | `897737fbe63e424f51b225467a81685ef0b7bccd` |
| Archive bytes | 66,009,824 |
| Archive SHA-256 | `fb88a3d1bab219372e78f518bc082959678abd78ceee0aec55b72f1b49f15e52` |
| Validation directory | `/opt/kyalulu-cloud/validation/unified-897737f-20261030/` |
| Distinct image tag | `kyalulu-cloud:unified-897737f-validation` |
| Accepted image ID | `sha256:2fdf72c8c69e7c9bd71482fda567a4028cc7416e3abff4df0d2ded54532faa44` |
| Corresponding-source SHA-256 | `ff33ba67f91e1e565e8561f2ebcc87edc5d5c1e562b8d2e7ad226fb0a6280260` |

## Build and file correspondence

Existing host-key verification and the deployment lock were retained. The destination/tag were unused before this operation. The actual server reported Docker 29.1.3; initial available RAM was about 522 MiB and free disk about 82 GiB. No Docker update, swap/configuration change or production service restart was performed.

The archive and all 223 extracted manifest files passed before building. The build used the reviewed limits: memory 384 MiB, 512 MiB including swap and CPU 50%. These constrain build steps, not every host operation. Cloud/Relay/Caddy health, restart/OOM/image/start state and available host RAM were monitored. The corrected build recorded six healthy observations and minimum available memory **533,176,320 bytes**. Production health requests used the actual `Host: cloud.kyalulu.com`; wrong-Host rejection was not mistaken for a failed service.

A separate network-none/read-only container streamed hashes for **210 actual image files**, matching all copied Runtime/catalog/prompt/Web/license/admin/source-offer files to the fixed archive. All four fresh standard/compat JS/WASM hashes matched the [fresh build evidence](2026-10-30-unified-wasm.md). Source/archive correspondence and installed-base dependency acceptance remain distinct from physical-device, signing and licensing gates.

## Accepted execution

The exact probe contained in the archive passed **12 checks** under UID 10002, network none, read-only rootfs, no published ports or host binds, memory 256 MiB, CPU 25%, pids 64 and fictional temporary data only:

- Exact main/device/migration/worker/service-worker bytes and expected isolation/CSP/cache/scope headers.
- Missing/private paths closed; private APIs and wrong Host rejected.
- Unknown regional policy closed; billing and advertising unavailable.
- Exact corresponding-source offer; no external request or production account/operation creation.

A second owned container ran the **unmodified default Uvicorn command**. Actual loopback HTTP returned health **200** and Device **200** with `require-corp`. Inspection confirmed the accepted image ID, user `10002:10002`, network none, read-only rootfs, no binds/published ports and no OOM. Its data/backups were dedicated tmpfs, never production volumes. Both named containers were removed, and both validation image IDs were checked for zero remaining containers, including failed diagnostic attempts.

## Failures and repair before acceptance

The first probe comparison stopped before execution because the Windows Git export used CRLF and the working tree used LF. Both were strictly UTF-8 decoded and only CRLF-to-LF normalization was allowed for comparison; execution then used the archive's exact probe bytes.

The initial build was **not accepted**: the validation wrapper's `umask 077` made implicit extracted directories root-only, so UID 10002 could not import `python.cloud.app`. A read-only diagnostic confirmed the directory permission failure. This was a validation-context error, not evidence of a missing archive source file. After verifying the owned image ID and unchanged archive/manifest, only public directories inside the new validation `bundle/` were changed to 0755 and the same source was rebuilt under the same limits. The enclosing validation directory stayed private. The earlier image ID `sha256:ef89b66192373e312dbea5a0fd424f003d3a247cebe51e92281988ec63dd7e57` is historical and must not be selected. No existing production image/volume was deleted or replaced.

## Production preservation and remaining work

Authorized read-only SQLite integrity checks, complete table digests (excluding the three reviewed authentication tables), ledger aggregates and configuration flags matched before/after. All three production containers retained image/start/restart/OOM/healthy state. Production deployment remained unselected. Sensitive aggregates and fingerprints stay outside Git/PRs under `.artifacts/unified-vps-preflight-20261029/` with `*-897737f` names.

Evidence includes `image-build-897737f.json`, `image-smoke-897737f.json`, `image-files-897737f.json`, `image-entrypoint-897737f.json`, `entrypoint-handle-897737f.json`, `validation-cleanup-897737f.json` and `preservation-897737f.json`. Public evidence here contains only code hashes, validation results and preservation booleans.

A proposed follow-up read of production volume/Compose-path metadata to a local file was rejected by automatic approval review as beyond the scoped permission. It was not executed. After a separate explicit authorization, a narrower read of only mount type/name/container destination/RW was completed to the specified private file; host Source and Compose paths were not obtained. See [scoped layout review](../UNIFIED_RECOVERY_LAYOUT_REVIEW.md). Actual backup/restore remains unapproved. The allowed validation cleanup check was completed independently.

This confirms the fixed candidate's isolated Linux image, not canonical public delivery, real OAuth/Remote keys, independent encrypted backup recovery, full large-conversation/UI capacity, physical phones, signing or commercial provider contracts. The 1 GB decoded restore remains unaccepted under its separate 4 GiB test budget. The PR remains a Draft and merging remains held.
