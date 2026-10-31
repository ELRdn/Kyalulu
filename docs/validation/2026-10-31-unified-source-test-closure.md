# Corresponding-source test closure — 2026-10-31

An offline archive audit at97b49d1 found that the exported collector omitted five
files needed to retain the current benchmark/streaming checks: the Benchmark
browser driver, benchmark backend tests, JSON stream tests, Native outbox tests
and shared pytest configuration. The audit could supplement them from the same
commit, but the standard collector would omit them again on the next build.

The existing explicit source allowlist now includes those five files. Its local
Python helper test requires them, resolves sibling imports as before, runs the
collector and compares every required collected file byte-for-byte with source.
No runtime, inference, synchronization, archive boundary or dependency behavior
changes. The collector still excludes private inputs and external links.

## Fresh evidence

- Extended helper check fails before the allowlist fix, identifying exactly the
  five missing files (`.artifacts/source-collector-helpers-red.log`).
- Source/fixture/helper closure **3 passed /10 deselected**,12.88s.
- Full source collector regression **13 passed**,8.29s, including private-source
  boundaries, link refusal, license text copying and WASM export newlines.
- Logs: `.artifacts/source-collector-helpers-fixed.log` and
  `.artifacts/source-collector-full-fixed.log`; explicit disposable temporary
  directories and existing dependencies only.

The prior fixed97b49d1 source-only archive contains691 files/16,380,479 compressed
bytes with five supplements;689 tracked members match Git blobs exactly or differ
only by documented LF→CRLF export conversion. Its SHA-256 is
`0709be0c1b4fb33fac907f6160fbf6d29cd181f9a95b1d969413e71c15447562`.
That archive is a separate historical artifact, not a binary distribution or a
claim that the new collector itself was loaded from that older commit.

## Limits

No dependency installation, WASM/binary/native build, real model, provider or
production operation is included. The clean source export has no node_modules;
its generated renderer license inventory is empty and unverified. The three
previously recorded grants remain unresolved and `license_reviewed=false`.
Complete third-party corresponding-source/legal closure and clean-OS/release
acceptance remain separate requirements.
