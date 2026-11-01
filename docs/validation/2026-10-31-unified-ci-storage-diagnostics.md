# Windows segmented-storage CI diagnosis

The Windows job in PR run `41110527937` at `1b3e5b6` passed both the complete Web
unit step and Python pytest step, then failed `e2e_segmented_storage.py` while
waiting 60 seconds for its page result. Ubuntu succeeded. The old driver recorded
page errors in memory but emitted its results only after all scenarios, so the
failed scenario and console state were unavailable in that failure log. This does
not establish whether the failure was a slow case, an import error or a stalled
storage operation.

The driver now logs each scenario's start/completion and, on exception, records
the scenario, browser version, original exception, page errors, last ten console
errors and blocked request URLs without query/fragment values. It prints the
diagnostic before disk writes and retains the original exception even if output
storage is unavailable. A failure file does not replace the accepted result file.

Two synthetic unit checks cover the diagnostic contents, request-query redaction,
preservation of existing results and unavailable output storage. The same **53
Chromium/IndexedDB scenarios** pass locally with the diagnostic driver. Scenario
data, the 60-second deadline and all count/network/page-error/result assertions
remain unchanged. No workflow was cancelled or rerun merely due to observation
delay. The next CI result must identify and resolve the actual Windows failure;
the diagnostic change is not a claim that it is fixed. Production was not used.
