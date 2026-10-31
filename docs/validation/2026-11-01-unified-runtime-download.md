# Runtime exports: incremental production and file saving

Research exports previously called `JSON.stringify` on the entire diagnostic tree,
then `RuntimeDownload` buffered the full Response into a Blob. A completed file
also had no incremental account guard or declared-length validation.

Device experiment and benchmark export routes now reuse `jsonChunks` to produce
the existing self-contained JSON value in at most 1 MiB chunks. Each consumer
pull checks the owner and request signal; an invalid tail errors the stream.
Ordinary detail/status APIs, stored experiments, generation inputs, full saved
diagnostics and replay semantics are unchanged. This source still decodes the
saved research tree whole before serialization.

The common Runtime download control opens the file picker directly in the user's
click, before awaiting anything or fetching private data. Its suggested filename
comes from the existing export view. File saving awaits each stream write and
closes only after normal EOF, scope and applicable length checks. Errors cancel
the reader, abort the writable and release the reader lock. Unmount aborts only
this control's work; duplicate clicks cannot open another picker.

Browsers without file-system saving use an explicit bounded Blob fallback, at
most **1,500,000 actual response bytes**. A larger export reports unsupported
streaming saving in Japanese/English and retains the source. This is a browser
representation boundary, not truncation of saved diagnostics or conversation
history. Cancellation/permission rejection never falls back to another save.
`Content-Length`, when present, must be valid; identity responses must match it
at EOF. Encoded gzip/br lengths are not compared with decompressed body lengths.
The fallback bound still applies to the actual decompressed bytes.

Evidence on source based on `b09b3f8` plus this change:

- Three route regressions first failed on aggregate serialization and owner/abort
  changes. Corrected routes pass all **27 Research tests**, including a late
  serialization error that preserves saved evidence. Producer/storage/transfer
  suites passed **67 tests** before that additional tail regression.
- The download/helper component suites pass **58 tests**, covering pending
  permission/read/write, cancellation, unmount, write/close/EOF/checksum errors,
  exact fallback boundary, dishonest lengths and compressed responses. Full-body
  `blob/text/json` methods are prohibited in the stream tests.
- Full Web suite: **1,589 passed / 96 files**. TypeScript and unified build pass;
  the build uses fictional `https://relay.example.invalid`.
- Real Chromium: **16/16**, Japanese/393/light and English/1280/dark. The real
  React control, Device API, IndexedDB source and OPFS writable are exercised.
  Only the OS picker is substituted. The successful export is exactly
  **4,500,276 bytes**, matching expected SHA-256, written in five chunks of at
  most **1,048,576 bytes**, with one write pending at most and one close.
- Injected write/close errors, owner change, corrupt final source part and picker
  cancellation preserve the original 13-byte target. Cancelled pickers cause
  zero IDB reads. The fallback saves an exact small export and rejects the large
  export without accepting a prefix. All 63 observed source fingerprints remain
  stable; no blocked requests, page errors or model Workers. All 16 contexts,
  owned Chromium and Vite close.
- Existing actual Device Research UI: **2/2**, eight-turn pipeline, rating/reload,
  small fallback export, account separation and explicit/navigation stop. Source
  closure checks: **3 passed**; the new driver/HTML are in corresponding source
  and the browser driver is included in normal Windows/Ubuntu CI.

Private evidence: `.artifacts/runtime-download-browser/result.json`,
`runtime-download-{web-all,build,source-tests,research-browser}-20261101.log`,
`device-export-{producer-final,typecheck}-20261101.log`. Source test execution
used the installed interpreter after sandbox uv-cache access failed; pytest's
cache warning does not change the three passing test results.

The first published `9d9ef7d` Ubuntu PR/push runs failed in the existing
Benchmark driver's `expect_download` (30 seconds). Its context still exposed
the native file picker. A fixed `9d9ef7d` export reproduces the same wait after
an actual `showSaveFilePicker` call with user activation, rejected by headless
Chromium with `AbortError`. The Benchmark driver now explicitly selects the
browser-download fallback, as the existing Research driver already does.
The separate 16-case OPFS driver retains streaming-sink coverage. No product
source, timeout or result assertion changes. On that fixed export plus only
the two-line driver correction, JA/EN cases pass, retaining paired32 turns,
native export shape, navigation/cross-tab cancellation, interrupted reload,
account isolation, load timeout and the synthetic100-turn case. All1,181
tracked input files are compared before/after; only the driver differs from
the original fixed export. Installed dependencies are reused, not freshly
resolved. Evidence: `runtime-download-benchmark-{red,green,ci-job}-20261101.log`
and `runtime-download-benchmark-ci-20261101/proof.json` under `.artifacts`.
This local repair does not establish subsequent public CI success.

Not verified: native OS picker/permissions, physical disks or disk exhaustion,
Android/iPhone, peak RSS or arbitrary 1 GB values. Canonical receipt storage,
legacy diagnostic conversion, bounded debug/detail reads, actor admission,
Worker clones/merge/ONNX fitting and full capacity acceptance remain open.
The complete Native/Cloud distribution candidates remain pinned at `81e5927`;
this later source change is not present in those candidates. No providers,
Auth settings, deployment, merge or production data were changed.
