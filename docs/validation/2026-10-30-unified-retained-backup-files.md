# Retained backup tree regression

The disaster archive helper previously selected only UUID-scoped user backup
versions. A fictional backup directory containing historical archives, metadata
and nested files reproduced their omission. The helper now preserves the entire
backup tree, including empty directories, excluding only its own staging
directory and current output. Files remain inert bytes during restoration.

Restore validates canonical portable member paths, uniqueness and file/directory
types before extraction. Traversal, path aliases, links and special files are
rejected; tenant and transfer owner directories still require UUIDs. Existing
empty-destination guards and retained-version restoration remain in place.

Related disaster/retained-cost tests: **22 passed**. They cover archive
destinations inside/outside the backup directory, retained-version restoration,
source file hashes, arbitrary retained files and empty directories, and hostile
encrypted archives rejected before extraction/adoption. Private fictional
staging, worker and controller checks also passed **51/51**, **18/18**, **26/26**.

These are code and fictional-data results. Operational evidence is private;
this document records no production execution status, infrastructure layout,
database fingerprints, individual ledger values, ciphertext or keys.
