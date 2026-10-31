"""Saved monthly purchase conditions survive price rotation without real Stripe calls."""
import copy
from dataclasses import replace
import json
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest

from python.cloud.billing import StripeBilling
from python.cloud.config import CloudConfig
from python.cloud.contracts import purchase_terms
from python.cloud.store import CloudError, CloudStore


@pytest.fixture
def billing(tmp_path):
    store = CloudStore(CloudConfig(root=tmp_path, origin='https://app.test', secret='s' * 32,
                                  unified_enabled=True, stripe_prices=(('plus', 'price_old'),)))
    owner = str(uuid4())
    store.account(owner, consent='fictional')
    until = int(time.time()) + 30 * 86400
    terms = {**purchase_terms('plus'), 'stripe_price': 'price_old'}
    with store.transaction() as db:
        db.execute("UPDATE accounts SET customer='cus_fixture' WHERE id=?", (owner,))
        db.execute('INSERT INTO checkout_terms VALUES(?,?,?,?)', ('fixed', owner, 'plus', json.dumps(terms)))
    subscription = {'customer': 'cus_fixture', 'status': 'active', 'metadata': {'pricing_key': 'fixed'},
                    'items': {'data': [{'price': {'id': 'price_old'}, 'current_period_end': until}]}}

    class Billing(StripeBilling):
        async def call(self, path, **kwargs):
            if path == 'subscriptions/sub_fixture':
                return copy.deepcopy(subscription)
            if path == 'invoices/in_fixture':
                return {'status': 'paid', 'paid': True, 'subscription': 'sub_fixture',
                        'billing_reason': 'subscription_create', 'payment_intent': 'pi_fixture',
                        'lines': {'data': [{'price': {'id': 'price_old'}, 'period': {'end': until}}]}}
            if path == 'payment_intents/pi_fixture':
                return {'status': 'succeeded', 'customer': 'cus_fixture', 'latest_charge': {
                    'refunded': False, 'disputed': False, 'billing_details': {'address': {'country': 'JP'}},
                    'balance_transaction': {'currency': 'usd', 'status': 'available', 'net': 500}}}
            raise AssertionError('Unexpected provider request: ' + path)

    result = Billing(store, SimpleNamespace(admission=lambda *args, **kwargs: None))
    result.owner, result.until, result.saved_terms, result.remote = owner, until, terms, subscription
    return result


@pytest.mark.asyncio
async def test_old_price_paid_invoice_and_subscription_replays_preserve_plan_and_single_grant(billing):
    billing.config = replace(billing.config, stripe_prices=(('plus', 'price_new'),))
    event = {'id': 'evt_invoice', 'type': 'invoice.paid', 'data': {'object': {'id': 'in_fixture'}}}
    before = billing.store.balance(billing.owner)
    await billing.process(event, 'fixed-event-hash')
    assert billing.store.account(billing.owner)['plan'] == 'plus'
    assert billing.store.balance(billing.owner) == before + 50_000
    with billing.store.transaction() as db:
        lots = [tuple(row) for row in db.execute('SELECT * FROM credit_lots')]
        receipts = [tuple(row) for row in db.execute('SELECT * FROM receipts')]
    await billing.subscription('sub_fixture')
    await billing.process(event, 'fixed-event-hash')
    assert billing.store.account(billing.owner)['plan'] == 'plus'
    assert billing.store.entitlements(billing.owner).id == 'plus'
    with billing.store.transaction() as db:
        assert [tuple(row) for row in db.execute('SELECT * FROM credit_lots')] == lots
        assert [tuple(row) for row in db.execute('SELECT * FROM receipts')] == receipts
    billing.remote['status'] = 'canceled'
    await billing.subscription('sub_fixture')
    assert billing.store.account(billing.owner)['plan'] == 'free'
    assert billing.store.balance(billing.owner) == before + 50_000


@pytest.mark.asyncio
@pytest.mark.parametrize('mismatch', ['owner', 'price', 'sku', 'missing'])
async def test_conflicting_saved_subscription_terms_cannot_change_account_or_wallet(billing, mismatch):
    billing.store.receipt(billing.owner, 'paid', 'plus', 5_000_000_000, billing.until,
                          event_id='evt_paid', event_hash='paid', terms=billing.saved_terms)
    await billing.subscription('sub_fixture')
    before = billing.store.account(billing.owner), billing.store.balance(billing.owner)
    with billing.store.transaction() as db:
        if mismatch == 'missing':
            db.execute("DELETE FROM checkout_terms WHERE id='fixed'")
        elif mismatch == 'owner':
            db.execute("UPDATE checkout_terms SET owner='foreign' WHERE id='fixed'")
        elif mismatch == 'sku':
            db.execute("UPDATE checkout_terms SET sku='credits_5' WHERE id='fixed'")
        else:
            terms = {**billing.saved_terms, 'stripe_price': 'price_other'}
            db.execute("UPDATE checkout_terms SET terms=? WHERE id='fixed'", (json.dumps(terms),))
    with pytest.raises(CloudError, match='checkout_price_conflict'):
        await billing.subscription('sub_fixture')
    assert (billing.store.account(billing.owner), billing.store.balance(billing.owner)) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('pinned', [False, True])
async def test_current_and_pinned_old_prices_require_funded_unrevoked_receipt(billing, pinned):
    if pinned:
        billing.config = replace(billing.config, stripe_prices=(('plus', 'price_new'),))
    else:
        billing.remote['metadata'] = {}
    await billing.subscription('sub_fixture')
    assert billing.store.account(billing.owner)['plan'] == 'free'
    billing.store.receipt(billing.owner, 'legacy_paid', 'plus', 5_000_000_000, billing.until,
                          event_id='legacy_paid', event_hash='legacy', terms=billing.saved_terms)
    await billing.subscription('sub_fixture')
    assert billing.store.account(billing.owner)['plan'] == 'plus'
    billing.store.revoke_receipt('legacy_paid', owner=billing.owner)
    await billing.subscription('sub_fixture')
    assert billing.store.account(billing.owner)['plan'] == 'free'
