# Branch driver Windows CI initialization (2026-10-31)

Scope: only `tests/e2e_device_branches.py` and this document. Product, fixtures,
workflow, collector, dependencies, Git state and existing GitHub jobs are unchanged.

## Diagnosis

Both supplied `381d1a9` Windows logs show all 24 cases failing uniformly at approximately
31 seconds, before any case-specific error is printed. The old driver stored individual
tracebacks/page errors in temporary JSON but printed only `{scenario, ok, seconds}`.
The original browser exception cannot be recovered from those console logs alone.

A deterministic local Chromium reproduction isolates a Windows checkout difference:
`device-branches.html` fetches `memory-source-projection.html`, extracts its helper text
and checks a pinned LF SHA-256. Windows `core.autocrlf=true` can serve CRLF HTML;
`.gitattributes` has no LF rule for these fixtures. The existing local helper is LF,
which explains why the previous local run could pass while a CRLF checkout fails.

Actual Chromium **151.0.7922.34**, with the original driver delivery and only the fetched
helper changed to CRLF, threw **`Projection helper bytes changed; re-audit extraction`**
and failed initialization at the unchanged **30000 ms** deadline. No product function or
source fixture was replaced. The two extracted helper hashes are:

- Audited LF: `4d853a83221309ab8ade134a7f52aa40e4cec6db3aea0b2d4802f644b9e4bc96`
- Equivalent CRLF: `7aa10abd107171adb53750a8b817f885884f8baf8183a4a888e30909cb9b506f`

Before-fix reproduction:
`C:/Users/hiron/AppData/Local/Temp/branch-ci-crlf-before-u1me51k4/result.json`.
This proves the reproduced initialization failure, not an exception extracted from the
original GitHub worker. Drive/path case normalization was not needed to reproduce it.

## Minimal fix

The driver's existing loopback fixture router now also serves the one helper HTML file
with CRLF normalized to LF. Its original helper extraction and pinned hash check remain
intact, so a non-newline byte change still refuses initialization. The raw source-byte
fingerprints, frozen old branch/receiver/binder/schema hashes, executable transpilation
check, complete source/output comparisons, data, assertions and every deadline remain.
The fixture file itself and the dependency import map are unchanged.

Each case now prints launch/initialize/fixture-ready progress. Page errors, browser
console errors, failed request URLs and HTTP failure status/URLs are printed with case
and stage. Failure prints the full per-case traceback and initialization details
(navigation URL/status, fixture/helper routes, document readiness, import map, module
resources and fixture progress); the existing screenshot and JSON evidence are retained.
Only test/runtime paths and fictional fixture state are inspected.

## Validation

After-fix CRLF input was injected only at helper text reading, without writing any
fixture or product file. Both actual browser cases **pending-copy** and
**late-rewrite-corruption** passed, including reload and complete comparisons.
All four helper reads contained **348 CRLFs** before normalization.

- Report: `C:/Users/hiron/AppData/Local/Temp/branch-ci-crlf-after-5_iaequn/result.json`
- Injection evidence: adjacent `crlf-injection.json`.
- This selected diagnostic run correctly retains `acceptance: false`.

The complete driver on stable product **`04ea182`** passed **24/24**,
**`ok: true`, `acceptance: true`**, in **175.336 s** summed case time.
All **161 input fingerprints** matched before/after every case and the complete run.
There were zero denied external attempts, page errors, request errors or console errors.
All **26 owned contexts** closed, both quota cases reopened Chromium, and owned Vite
stopped. The same source/output payload assertions, zero-root-message observer,
corruption/owner/CAS/quota/sequence checks and frozen oracle all passed.

Full result:
`C:/Users/hiron/AppData/Local/Temp/branch-ci-fix-full-20261031/result.json`
(SHA-256 `321917149a9fbca6f6c1df6fa9629b9a1094f5ff9a5810b822ea52a3e4475ef3`).
The parent was told that all source-sensitive runs had ended and fingerprint stability
was confirmed before its proposed subsequent product edits. This result applies to the
recorded source fingerprint, not to those later edits.

A separate negative control changed a non-newline helper byte only in the served test
input. Initialization still refused at **30000 ms**, `acceptance` remained false,
and the emitted console included the case traceback, `initialize` stage, page error,
fixture/helper routes, import map and module/resource details. This proves that newline
normalization did not bypass the pinned helper checksum or silently retry a failure.

- Negative report: `C:/Users/hiron/AppData/Local/Temp/branch-ci-diagnostic-failure-4f2d1pks/result.json`
- Console proof: adjacent `console.log`.
- Python syntax and scoped `git diff --check` passed. No extra full-body fixture was
  created; existing fixture/oracle files are unchanged.

The generation driver/fixture were read for impact only: `generation-commits.html`
does not fetch/extract the pinned helper or perform this LF-sensitive helper checksum.
This specific initialization mechanism therefore does not apply to it. No generation
test or source file was changed, and its other behavior was not revalidated here.

## Limits

These are bounded local Chromium/IndexedDB tests. No GitHub job was canceled/restarted,
and the original failed worker's temporary JSON was unavailable in the supplied logs.
A later green Windows CI run is still required to confirm that worker environment.
No new 1 GB, physical-device, model/provider or crash-recovery validation is claimed;
previous-source evidence remains scoped to its recorded fingerprint.

## Hosted follow-up

`cc0b95f` PR run41192711985, Windows job124512580204, reports the
`tests/e2e_device_branches.py` step **completed/success**. The same job was still
running later steps when read. This confirms that hosted branch step after the fix;
it does not turn the original missing exception into direct causal evidence or
claim a complete latest-source hosted/release pass.
