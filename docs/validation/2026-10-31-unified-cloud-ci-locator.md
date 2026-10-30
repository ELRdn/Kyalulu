# Cloud target-switch CI reply locator — 2026-10-31

## Scope and diagnosis

Checkout: `D:/VibeCoding/my zeta`, branch `codex/unified-app-integration`,
HEAD `6bda649`. This sidecar changes only `tests/e2e_cloud_target_switch.py`
and this validation note. Existing unrelated working-tree edits are preserved.
Product sources, dependencies, Git state and CI runs were not changed.

Read the complete supplied Ubuntu PR job log (2,072 lines / 178,561 bytes):
`.artifacts/ci-6bda649-ubuntu-pr.log`, run `41130054301`, job `124318367182`.
At log lines 2027–2052, driver line 240 fails because the global exact-text
locator resolves to both `<div class="k-session-row__preview">hello</div>` and
the reply's `<p>hello</p>`. JA reaches the held cancelled-result stage, then
fails on the explicitly resumed reply; EN is not reached in that CI invocation.
The job exits 1. This is the red evidence, not a new CI run.

Caller/reference search found `main()` calling `run_case()` for JA393light and
EN1280dark, the `__main__` entry point, the Runtime/Web workflow invocation,
the release-source collector's file entry and the prior validation note.
No other module imports this driver's functions. No caller, fixture, config
or export needs updating. Read `ActiveChat.tsx`, `MessageContent.tsx`,
`MarkdownView.tsx` and `SessionRow.tsx` to establish the rendering scope.

## Minimal correction and regression acceptance

The existing visible wait now uses:

```python
reply = page.locator('.k-msg--character .k-msg__stack').get_by_text('hello', exact=True)
await reply.wait_for()
```

The scope is the actual character reply content, excluding sidebar previews,
user messages, reply metadata and reasoning summaries. Strict matching remains
enabled; no `first`, `nth`, timeout extension or application change is used.

After the existing network-idle and route-drain checks, the same driver asserts:

- Exactly one sidebar preview matches the exact text `hello` (attached DOM;
  the narrow layout need not display the sidebar).
- The original global exact-text locator matches exactly two elements.
- The reply-scoped locator matches exactly one element.

Thus both real renderings must coexist for acceptance; merely passing before
the sidebar refreshes is insufficient. Each case reports
`reply_locator_ignores_sidebar_preview: true` only after these asserts pass.

Existing 180-second overall deadline, 15-second page timeout and all previous
assertions remain intact: Stop, held saved-result barrier, Profile reload guard,
late-success fence, cancelled wallet unchanged/charge 0, Device isolation,
draft preservation, no automatic resend, two deliberate provider calls and
the final ledger `[(failed, 0), (completed, 1)]` after the explicit resume.
Temporary tenant, route, browser, Cloud thread and Vite cleanup are unchanged.

## Fresh local green evidence

Used installed dependencies without installing or rebuilding anything:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/hiron/AppData/Local/ms-playwright'
$env:PYTHONDONTWRITEBYTECODE='1'
.venv/Scripts/python.exe -B tests/e2e_cloud_target_switch.py
```

Windows run finished **2026-10-31 06:26:52 JST**, exit **0**, Chromium
**151.0.7922.34**, **2/2 passed**:

| Case | Duplicate-text acceptance | Provider calls | Cancelled charge | Explicit resume charge | Automatic resend |
| --- | --- | ---: | ---: | ---: | --- |
| JA / 393px / light | passed | 2 | 0 | 1 | false |
| EN / 1280px / dark | passed | 2 | 0 | 1 | false |

Both cases report retained draft, unchanged cancelled balance, late-success
fence and Profile reload guard. Both have zero blocked requests, page errors,
cancelled route callbacks and active routes at cleanup. The process exits
normally without pending-task warnings; no sandbox escalation was needed.

Existing driver outputs were regenerated under
`.artifacts/cloud-target-switch-browser/` (`results.json` and pending screenshots);
no new script or separate fixture was added. `git diff --check` passes for the
driver. Final diff inspection confirms only the scoped wait, three duplicate-text
asserts and one result flag were added to executable test code.

SHA-256 evidence identifiers:

- Supplied CI log: `f48793e5e55662a75abc33d3b70173decb4f2fe4591434c9fae1eba3e47c2642`
- Fresh `results.json`: `84e7c59bce187707d23e9bfac1db5d49e7900409bfcce0d7c65496e23be033ba`

## Not verified

Ubuntu CI after this edit was not rerun or cancelled. This Windows fixture
result does not establish full CI success, real provider/OAuth/billing,
hosted TLS or physical-device acceptance. The parent's 1GB memory-projection
probe was not operated or evaluated; this change does not validate its results.
