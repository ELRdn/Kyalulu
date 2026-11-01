# Saved subscription conditions and rewarded-ad acceptance

Three regressions were reproduced against `1ab8f93` without real payments, ads or production data.

## Existing subscriptions after price rotation

`StripeBilling.subscription` previously resolved the SKU only from current configured sale prices. Removing an old price therefore downgraded an active, paid subscription to Free even though credit granting already used saved checkout conditions.

An active subscription with a pricing key now resolves its original SKU/price from that owner's saved checkout terms in the same transaction as its entitlement update. Owner, plan SKU, stored SKU and retrieved provider price must agree. A mismatch fails before changing the account or wallet. A valid, unrevoked paid receipt for the provider period remains mandatory. Legacy subscriptions without a pricing key retain the current-price path. Cancellation still ends plan privileges while leaving already-granted credits to their original expiry.

The new regression initially failed five cases and passed its legacy control. Tests cover retired-price invoice processing/replay, retained Plus rights and one monthly grant, cancellation without losing credit lots, conflicting/missing terms, and funded/unfunded/revoked receipts on both legacy and saved-price paths.

## New ad offers before external inventory access

The offer route previously called the adapter's inventory before checking ads/legal/private/account admission. The existing admission conditions are now shared between the route and service: rejection occurs before inventory access, and a second check after the await prevents a concurrent policy change from creating an offer. Seven rejection conditions, direct service calls and changes during inventory are exercised with an ASGI app and a test-only adapter.

## Completion delay, polling and reserve release

An offer's existing 24-hour receipt-acceptance deadline is now applied consistently during completion and status polling. A verified completion arriving before that deadline may grant once; arrival at or after it rejects whether or not the client polled. Expiry and return of the original funding reservation commit even when the completion returns 409. The same event replay after a successful grant remains idempotent beyond the deadline; conflicting events remain rejected.

No new grace period or provider SLA is inferred. Duration/reward, prices, funding totals, account ownership and the absence of a daily viewing cap remain unchanged. Tests cover one second before/at/after expiry, with and without polling, persisted reserve release/reopen, replay, conflicts and invalid test signatures. These use real disk SQLite and normal pytest/asyncio with fake ASGI identity and a test-only HMAC adapter; they do not validate a commercial provider's signature scheme or production middleware.

## Validation and limits

Before the ad fixes, the new 29-case suite had eight assertion failures and 21 passes. After correction, all 29 passed; a fresh run including seven unchanged existing ad cases passed 36. Billing's first corrected run passed 77 new/existing billing and unified cases. After both fixes and all regression cases were frozen, the combined billing/reward/Cloud/unified/safety-pricing suite passed **120 tests**, and corresponding-source fixture/module/Python-helper closure passed **3 tests**. Existing Web sources and wire fields did not change.

Local records: `.artifacts/billing-price-history-reproduced.log`, `billing-price-history-fixed.log`, `commercial-fixes-final.log`, `commercial-fixes-source-closure.log`, and `.artifacts/reward-acceptance-20261101/`. Temp and database fixtures remain under task artifacts. No existing production balances, ledger, funding or contracts were reset or changed. Real Stripe/ad contracts, actual provider signatures/settlement, deployment and physical-device acceptance remain separate gates.
