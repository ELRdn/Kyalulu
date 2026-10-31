# Browser JSONL diagnostics on Windows consoles — 2026-11-01

The `1a09d05` PR Windows job failed in the new branch-ACK driver while both Ubuntu
jobs succeeded. Its log shows Python `charmap` encoding errors when an expected
guard result contains the bilingual storage error. `emit` first saved valid
UTF-8 JSONL, then failed printing the same unescaped Japanese text to a cp1252
console. The outer scenario handler recorded that logging error as another
result; reload's resumed attempt was skipped. The final count was 46 passed
records among 66 records, instead of the required 47 executions.

Affected job: [124568122705 / run 41211785363](https://github.com/ELRdn/Kyalulu/actions/runs/41211785363/job/124568122705).
Raw log: `.artifacts/ci-1a09d05-pr-windows-branch-failed.log`.
A local run with `PYTHONIOENCODING=cp1252`, `source-corrupt` and `reload` reproduces
the same encoding/count failure in `.artifacts/browser-jsonl-cp1252-reproduced.log`.

The two new drivers now use `json.dumps(..., ensure_ascii=True)` for emitted
JSONL only. ASCII escapes are lossless JSON: Japanese, emoji, errors and nested
values decode identically in saved stdout and console output. The receive driver
used the same emitter and receives the same correction. UTF-8 payload/evidence
files keep their original representation. No product code, fixture, assertion,
scenario, deadline, input, transport or source-freeze rule changes.

An isolated check extracts each actual nested emitter, runs old/new versions
through a strict cp1252 stream, and compares decoded file/console objects with
the complete original bilingual/emoji input. Both old emitters fail and both
new emitters round-trip exactly. A full AST comparison independently confirms
that the sole executable change in each driver is that emitter's `ensure_ascii`
flag. Evidence: `.artifacts/browser-jsonl-console-selfcheck.json`.

Complete forced-cp1252 browser reruns are retained separately from this isolated
console check. Hosted Windows acceptance is tracked independently; a local
reproduction and correction do not retroactively turn the old CI green.

Final forced-cp1252 reruns pass **47/47 branch ACK executions** and **26/26 receive
executions**. Original assertions, full old-oracle comparisons, guards and reloads
remain enabled; the receive run still independently compares 87 whole entities.
All 332/333 source inputs match before/after/current hashes. Parent verifies that
the 95/53 JSONL console records equal the saved records exactly, contain only
ASCII bytes and decode the branch's Japanese storage errors without loss.

- Branch artifacts: `.artifacts/sync-branch-ack-browser/20261031T152121175529Z/`,
  source hash `80a33897463231a7b643a51e8872a55201b0e0e6fdbc1e975351cf867f9e30a1`.
- Receive artifacts: `.artifacts/sync-receive-projection-browser/20261031T152120957548Z/`,
  source hash `d611bfee1306a2a46aa439686bd2ca303176d12983e32a525d35fe71695e64a6`.
- Parent audit: `.artifacts/browser-jsonl-cp1252-parent-proof.json`; full console
  logs: `.artifacts/browser-jsonl-cp1252-{branch,receive}-final.log`.

Only diagnostic serialization changed, so the unchanged product's 1,499 Web
tests/type/build evidence remains separate. No 1 GB/RSS, real provider/model,
physical-device, production or release acceptance is claimed.
