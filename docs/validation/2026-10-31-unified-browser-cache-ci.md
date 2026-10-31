# Portable Playwright browser-cache selection

At `3688179`, both public [PR run 41132999442](https://github.com/ELRdn/Kyalulu/actions/runs/41132999442)
and [push run 41132992322](https://github.com/ELRdn/Kyalulu/actions/runs/41132992322)
finished with Ubuntu success and Windows failure in `e2e_memory_source_projection.py`.
All 14 scenarios failed in milliseconds. The old driver wrote exception details
only to a local result file, so the CI console alone does not prove the precise
launch exception.

Inspection found that driver forcing a developer's absolute Windows browser
cache path when `PLAYWRIGHT_BROWSERS_PATH` was unset. The history driver contained
the same defect. Both now leave browser selection to Playwright: its per-user
default or an explicitly provided environment variable. The existing CI install
step therefore uses the same browser discovery mechanism as the driver.
Each driver's per-case exception is also printed to CI output without changing
assertions, fixtures, retry policy or deadlines.

With `PLAYWRIGHT_BROWSERS_PATH` removed from the test process environment, the
actual Windows Chromium runs pass:

| Driver | Result | Local console |
| --- | --- | --- |
| Memory source projection | 14/14, 15 contexts closed, one browser restart | `.artifacts/memory-projection-default-cache-browser-unsandboxed.log` |
| History mutations | 13/13 | `.artifacts/history-default-cache-browser-unsandboxed.log` |

Memory evidence is `.artifacts/memory-source-projection-browser/result.json`;
history evidence is `%LOCALAPPDATA%/Temp/kyalulu-history-mutations-k1oeifo_/result.json`.
Both finish with no denied network attempts/page errors, unchanged product
fingerprints and owned Vite stopped. The browser still resolves to
the local user's installed cache, now by Playwright's default rather than a
driver override.

Initial sandboxed attempts stopped making progress before creating their initial
report or starting a browser. Their exact owned Python command lines/PIDs were
verified before termination, and the same tests were rerun outside that sandbox.
They are infrastructure failures, not accepted test results. No existing browser,
production process or user conversation was stopped. This local result does not
claim that a subsequent hosted Windows CI run has passed.
