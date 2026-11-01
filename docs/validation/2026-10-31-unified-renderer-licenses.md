# Pinned renderer license supplements

The source collector previously listed some installed package license declarations
without distributing any text because those packages omit root license files.
It now uses an offline, exact-package/version/declaration manifest to supplement
only verified upstream texts. Each supplement records its source URL and SHA-256;
published root texts still take precedence. Unknown versions remain unresolved.

The collected source includes original ONNX Runtime MIT and third-party notices,
esbuild MIT, the full Rollup license/dependency notices and wllama MIT bytes. The
existing shared Runtime license copier additionally distributes ONNX third-party
notices and the pinned noise-c C license, bringing that list from eight to ten.
This shared path serves Native, unified Cloud and legacy Mobile. The wrapper's
0BSD declaration remains a separate unresolved matter.
The source offer also retains stackback's embedded V8 BSD notice, matched to the
fixed published source; this is not counted as its missing primary MIT grant.

Local evidence:

- **62 Python source/manifest/bundle/license tests pass**, including seventeen new
  supplement cases: source checksum/emptiness, exact version and declaration,
  published-text precedence, unknown packages, duplicate identity, links, path
  escape and byte preservation with `core.autocrlf=true` Git export. Both legacy
  and unified fictional Cloud archives retain their existing source/manifest rules.
- All **51** locked esbuild/Rollup platform registry records matched the pinned
  revision and declared MIT license. ONNX stable tag and embedded development
  commits supplied identical MIT/third-party text bytes. The collector performs no
  network requests and does not accept mutable branch URLs as source evidence.
- A license-only metadata projection of the fixed `4bca277` installed dependency
  set reproduced its **234 packages / 11 missing texts**. With the new collector,
  eight entries gained verified originals and **three remain unresolved**. Every
  checked original package metadata/license file remained unchanged. Ten Runtime
  license copies matched their source bytes. No package code was copied or run.
- The current mixed development installation was checked separately: **560
  packages / 27 unresolved texts**, after eight supplements. Its Electron/tool
  packages differ from the fixed renderer set; these counts are not interchangeable.

The first Python attempt failed in sandbox temporary-directory setup. The same
tests passed with a fresh workspace-owned base directory; no broader filesystem
permission or cache ACL change was needed. One existing pytest cache-write warning
did not affect results.

See [license provenance and remaining gaps](../licenses/README.md). Complete grants
for guid-typescript, stackback and the noise-c wrapper remain unverified. This is
text delivery/integrity work, not legal clearance. A new complete distribution,
signature, clean-OS/real-model/device acceptance or production cutover was not
performed, and `license_reviewed` remains false.
