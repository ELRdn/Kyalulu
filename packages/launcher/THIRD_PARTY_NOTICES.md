The launcher itself has no npm dependencies and uses Node.js standard libraries.
Node.js is installed by the user. Its license is supplied by its distribution.

Runtime artifacts include pinned CPython and the locked Python dependencies,
their installed distribution metadata/licenses, an inventory in
`third-party-licenses.json`, `requirements.txt`, and the application's complete
corresponding source. Runtime/Python/dependency hashes are covered by the final
SHA-256 in `runtime-manifest.json`.

Before publication, review the generated inventory (including any package with
missing or ambiguous license metadata), preserve all required notices/source
offers, and verify AGPL compatibility. No model weights or proprietary runtime
DLLs are bundled. LE redistribution/automatic installation is not enabled.
