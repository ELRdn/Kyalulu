# Monthly subsidy clock consistency

The Windows run for `001cf99` failed the interrupted-ad reservation test at a month
boundary. The subsidy key used `time.time()` while its expiry used a separate
`datetime.now()` reading. Advancing the funding clock into the next month could
create that month's fund with an already-expired timestamp. Ubuntu ran the test
earlier and passed; its success did not cover this boundary.

`CloudStore._subsidy` now captures one instant and derives both the JST month key and
next-month expiry from it. The funding amount, eligibility, budget checks, reservation
and settlement logic are unchanged. Existing rows retain their amounts and expiry;
this patch performs no production repair or ledger reset.

Four deterministic fictional-DB cases cover 31-day and 30-day month ends, leap day and
year rollover. An expired ad restores only its original fund, the next offer reserves
the new month's fund with the correct expiry, and repeating expiry does not release
money twice. Three boundary cases reproduced the failure before the repair.

Local validation passes 214 related Python tests covering unified rewards, Cloud
funding/admission, private budgets, cost accounting/review and safety pricing.

Real ads/payments and production rollout remain closed or separately gated. CI for an
older commit or a successful package build is not acceptance of this repair.
