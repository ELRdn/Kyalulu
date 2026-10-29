# Fictional independent disaster recovery preparation

This is a local probe of existing `scripts/cloud_admin.py` backup/restore behavior. It used a fresh disposable root, fake secrets and two fictional owners; no production data/configuration, SSH, Docker, real provider, model or offsite transfer was used. It prepares the independent-backup gate; it does not complete that gate for production.

`python -B tests/fixtures/unified-disaster-recovery.py --evidence-dir .artifacts/unified-disaster-recovery-20261030/durable-roots-final` passed **23 checks**, with **zero real network attempts** and one explicit HTTPX MockTransport billing response. The report records the exact fixture SHA-256. The parent verified the source syntax and earlier matching evidence; the final report hashes the expanded fixture. The initial 20-check run remains historical.

## Covered behavior

- Backup leaves the source's complete table/schema fingerprints and file hashes unchanged.
- A separate new empty root restores fictional control/tenant databases, conversations, active/deleted memories/events, purge tombstones, native outboxes/source references, received erasures, durable receipts and revocation records.
- Wallet lots/expiration, settled completed/failed operations, positive **budget debt**, review evidence, media bytes and two retained backup files/listings survive.
- The legacy Community database and both kinds of unfinished transfer SQLite metadata survive; their encrypted transfer request IDs and expiration/resume state remain usable through `Transfers.inspect`.
- After restore, repeated recovery/reopen is idempotent. Replaying the retained provider review performs no request and changes no state.
- Existing tenant/control/backup destinations, wrong secret, invalid magic, truncation, tampered ciphertext, trailing data, held Runtime lock, output overwrite and injected pre-publication I/O failure are rejected while preserving the applicable original/destination/input.

`recover()` deliberately settles the seeded unaccounted pending operation to failed/review, charges its full 2,000,000 nano-USD bound and releases its fund hold. The probe names this exact transient delta rather than claiming every recovered row is identical. All other tables, settled operations, wallet/expiry, debt, tenant data and files match the recorded expectations.

## Limits before using real data

Preparation reproduced two actual defects before fixing them: an accounts-only emptiness check could overwrite a funded control plane with zero accounts, and the archive omitted `community.db`, `transfers/` and `entity-transfers/`. The control guard now rejects rows in **any user table**, including quoted extension names. Backup snapshots Community SQLite read-only and preserves both UUID-scoped transfer trees; restore accepts these durable members and refuses already-existing durable destinations. Root-lock, ciphertext/footer, safe-member and retained-version checks remain.

The two related Cloud suites passed **125 tests** after the fixes. The final targeted restore subset passed **10 tests**, including an additional committed-WAL transfer/Community case. The expanded independent probe passed 23/23. Original encrypted archives without the optional new durable members still restore. Archives containing those members require this updated restore tool; older readers reject their unknown members. The earlier accepted 897737f image does **not** contain these later admin changes and must not be credited with validating them.

The existing restore API does **not** guarantee rollback after a publication-stage failure. Real recovery must target only a new isolated root; retain/quarantine a failed attempt and use another fresh destination. Never select an incomplete restored root or overwrite current production data/outboxes.

The current reservation API does not populate `credit_holds`; only empty-table preservation is covered there. Positive **credit debt** was not seeded. Other pending-settlement branches, retained-version individual restore, power loss, concurrent writers, large data, OS permissions and actual secret recovery remain unverified. Positive budget debt and a pending `fund_holds` row were seeded; they must not be confused with those uncovered credit tables.

Container execution was not performed. Running this probe in a container requires the corresponding source tree read-only at its normal relative layout, Runtime dependencies and a disposable temporary root. A fixture placed alone in `/tmp` cannot resolve the admin module. This is separate from the accepted fixed image's twelve checks.

Detailed fictional evidence is kept outside Git at `.artifacts/unified-disaster-recovery-20261030/`, with the final result under `durable-roots-final/evidence.json`; earlier `evidence.json`, `summary.json` and `README.md` describe the preceding slice. Only coverage and results are published here. A separate local staging prototype passed **24 checks** using copies and a minimal cipher/config adapter instead of constructing CloudStore on originals. It remains a prototype: container/read-only mount behavior, legacy schema, WAL staging and production-secret use were not established by those 24 checks. Its directory/code hashes and result are retained privately.

An actual encrypted production backup, offsite ciphertext copy, source-preserving staging and isolated restore require their own reviewed operation; the scoped volume-metadata authorization does not authorize them.
