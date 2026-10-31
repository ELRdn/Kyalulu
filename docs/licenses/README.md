# Bundled upstream license texts

`renderer-license-sources.json` supplements packages which omit root license
files. Entries match exact package names, versions and declared SPDX values;
each text has an immutable upstream commit URL and SHA-256. The collector copies
verified bytes offline and records that provenance in `renderer-licenses.json`.
An existing published package text takes precedence. A different version is never
assigned a license by inference. `/docs/licenses/** -text` preserves upstream
bytes in Windows checkouts and Git exports.
The unmodified Rollup text and extracted V8 notice retain upstream trailing/blank
lines; only those two files are excluded from whitespace cleanup.

| Text | Upstream evidence |
|---|---|
| `onnxruntime-MIT.txt` and `onnxruntime-ThirdPartyNotices.txt` | Microsoft/onnxruntime stable `v1.30.0` resolves to `f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7`; Web/common development packages contain commits `8d85527a010e294a26b274749f74294b2a32cec5` and `2a43ec07e67df9263c7c56c15da76cc7f74d7b32`. Both texts match at all three commits. |
| `esbuild-MIT.txt` | Registry metadata for each locked `@esbuild/*@0.25.12` package identifies commit `208f539945b145e7c9d6d844290f81c3fe5af320`. |
| `rollup-LICENSE.md` | Registry metadata for each locked `@rollup/rollup-*@4.63.0` package identifies commit `34b8b924c815ec9413d7821f6fd54cc615584a51`. The full file includes bundled-dependency notices. |
| `wllama-MIT.txt` | `@wllama/wllama-compat@3.8.1` registry metadata identifies commit `b68fd6427063266176bb0054befe9ff70b3258f1`. |
| `noise-c-MIT.txt` | `noise-c.wasm@0.4.0` pins its C vendor checkout to `40b64ab83d4ecfdbefcab319a91761507e9fb98c`; [COPYING at that commit](https://raw.githubusercontent.com/rweather/noise-c/40b64ab83d4ecfdbefcab319a91761507e9fb98c/COPYING), SHA-256 `f2c0cc36aa63c383fd1669b63eff210ee8cabb304dd818a9f442d93906eff587`. This covers the upstream C notice, not the wrapper's separate 0BSD declaration. |
| `stackback-V8-notice.txt` | The unchanged first 1,598 bytes of [formatstack.js at v0.0.2](https://raw.githubusercontent.com/defunctzombie/node-stackback/2963095372abf7b75ba55f01cef08ab1e62c2ff4/formatstack.js), including its V8 BSD notice. Installed source bytes matched; notice SHA-256 `50e3a58083f6fa4aa476c27ebc77b9ed03f38be59fc4127754999c5689b85152`. This does not supply the package's declared MIT grant. |

All 51 locked esbuild/Rollup platform package registry records were checked, not
only the Windows names. This establishes pinned-source/text provenance, not a
build or legal-acceptance result for those platforms.

For the fixed 234-package dependency inventory previously checked at `4bca277`,
eight of eleven entries without package-root texts now have verified supplements.
Three remain unresolved:

- `guid-typescript@1.0.9`: declares ISC; the registry's `gitHead` was unavailable
  from the renamed upstream repository. No matching complete grant was obtained.
- `stackback@0.0.2`: declares MIT; its fixed tag has no root license or complete
  MIT grant in the checked README/code. Its separate embedded V8 notice is copied
  in the source offer; a current license was not assigned retroactively.
- `noise-c.wasm@0.4.0`: declares 0BSD; its fixed README names that license but does
  not contain the full grant. The separately copied C MIT notice does not resolve it.

The current mixed development installation has additional Electron/tool packages
and additional unresolved notices. Its inventory is not the fixed distribution.
Unknown packages remain visible with empty `texts`; the collector does not fill
them with generic SPDX templates. Final package/license review, signing, platform
and production acceptance remain open; `license_reviewed` stays false.
