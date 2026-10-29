# Unified Cloud image: isolated Linux acceptance

2026-10-29. The operator explicitly authorized a fixed public application bundle
to a dedicated validation directory on the existing VPS, resource-limited image
building, and fictional-data containers without networking or production mounts.
Separate approval covered read-only production aggregates/table digests retained
only in a local ignored directory. This is not a production cutover or public
launch acceptance.

## Fixed candidate

| Item | Verified value |
| --- | --- |
| Source | `bf83d033ed4e86137c7dbc33835536f03cf87928` in public `ELRdn/Kyalulu` |
| Bundle SHA-256 | `9be12a4cbb4fa58e87d69fe2260919dc03eb8ae2a8d2d470f2a56bd5a76c42b2` |
| Image tag | `kyalulu-cloud:unified-bf83d03-validation` |
| Image ID | `sha256:8349da472b6d7af41da51c991cef4d8687d9ace467d9687a91b44fcd0271c9a9` |
| Image size | 158,087,698 bytes |
| Corresponding-source archive SHA-256 | `de2bae9c31ca338927d4e1ce3e483a789853da0b6a62f0c770ff476a7cd144bd` |

The clean source passed 821 Web tests / 66 files and the unified build. Its 223
bundle manifest entries, 213 packaged product files and 380 renderer/Runtime
source files were compared before upload. The remote archive and extracted
manifest hashes also passed. WASM inputs remain reused fixed outputs, not a
fresh WASM rebuild. The quota-test follow-up changes tests/docs/CI/source
collection only; it does not change the candidate's renderer/Runtime code.

## Image and application acceptance

Docker 29.1.3 built the prebuilt candidate with 384 MiB memory, 512 MiB including
swap and 50% CPU. It used a new validation directory and a distinct image tag;
no production Compose configuration or environment file was copied or selected.

An ephemeral container passed twelve checks:

- User 10002, `network=none` with loopback only, and read-only root filesystem.
- Real image's health endpoint and exact built main/device/migration bytes.
- Device isolation, neutral migration headers and one CSP on each isolated page.
- Exact Service Worker bytes/scope and inference Worker bytes/isolation policy.
- Missing assets/private paths do not receive application HTML.
- Unauthenticated private API and wrong Host are rejected. Unknown region remains
  closed, and billing/advertising remain unavailable in the fictional config.
- The actual `/source.tar.gz` response matches the bundled source archive.

This test used the application's ASGI lifespan and only fictional SQLite data
in tmpfs, 256 MiB memory, 25% CPU and 64 pids. No external requests occurred.
The exact portable probe is `tests/fixtures/unified-container.py`. With the
reviewed image available locally, it can be repeated without production data:

```sh
docker run --rm -i --network none --read-only \
  --memory 256m --memory-swap 256m --cpus 0.25 --pids-limit 64 \
  --tmpfs /tmp:rw,size=64m,uid=10002,gid=10002 \
  --entrypoint python kyalulu-cloud:unified-bf83d03-validation - \
  < tests/fixtures/unified-container.py
```

A second container also ran the image's **unmodified default Uvicorn command**
with fixture-only environment values. Actual loopback HTTP returned health 200
and Device 200 with `require-corp`. Docker inspection confirmed read-only rootfs,
network none, no host binds, no published ports and the intended image/user.
Its recorded container ID was stopped normally and `--rm` removal was verified.

The first short readiness attempt was not accepted; the subsequent owned
container handle was retained and observed separately until ready. The record
does not establish a startup-time SLA or sustained-load acceptance.

## Preservation and remaining conditions

The authorized production flags, ledger aggregates and complete table digests
matched before and after these tests. Their contents stay outside Git and PRs.
Cloud and Relay remained healthy with unchanged restart/OOM observations. No
production image, configuration, volume, DNS, Caddy or OAuth setting was selected.
Only the dedicated validation image, directory and build log remain.

Local evidence is under `.artifacts/unified-vps-preflight-20261029/`, including
image/build/app/entrypoint and preservation records; private aggregates are not
included in this document. The approved scope is in
[container review](../UNIFIED_CONTAINER_VALIDATION_REVIEW.md) and
[read-only review](../UNIFIED_PRODUCTION_PREFLIGHT_REVIEW.md).

This does not prove public canonical delivery, real OAuth, existing Remote keys,
offsite backup restoration, production migrations, provider contracts, full
feature parity, single-conversation capacity or physical-device behavior. The
validation tag is not an instruction to replace the running release.
