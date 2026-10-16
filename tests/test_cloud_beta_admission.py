"""Offline financial admission; no provider calls or actual funds are created."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import time
from uuid import uuid4

import pytest
from python.cloud.config import CloudConfig
from python.cloud.store import CloudStore, CloudError
from python.cloud.router import public_routes, operator_provider


def setup(tmp_path, **options):
    config = CloudConfig(root=tmp_path, origin="https://cloud.test", secret="s" * 32,
                         monthly_subsidy_jpy=0, signup_limit=10, **options)
    return CloudStore(config)


def test_funding_replay_cannot_restore_spent_balance_or_extend_expiry(tmp_path):
    store = setup(tmp_path)
    assert store.add_funds(700_000_000, "beta-first-ten")["funded"]
    with store.transaction() as db:
        db.execute("UPDATE funds SET remaining=123 WHERE id='operator:beta-first-ten'")
        expires = db.execute("SELECT expires FROM funds WHERE kind='operator'").fetchone()[0]
    assert not store.add_funds(700_000_000, "beta-first-ten")["funded"]
    with store.transaction() as db:
        assert tuple(db.execute("SELECT remaining,expires FROM funds WHERE kind='operator'").fetchone()) == (123, expires)
    with pytest.raises(CloudError, match="operator_funding_conflict"):
        store.add_funds(699_000_000, "beta-first-ten")
    with pytest.raises(CloudError, match="operator_funding_limit"):
        store.add_funds(1, "second-source")
    for amount in (True, 0, -1, 700_000_001, 1.2):
        with pytest.raises(CloudError, match="invalid_operator_funding"):
            store.add_funds(amount, "invalid")


def test_unfunded_signup_rolls_back_and_existing_owner_keeps_balance(tmp_path):
    store = setup(tmp_path)
    existing = str(uuid4())
    store.account(existing, consent="old")
    store.grant(existing, 425, time.time() + 86400 * 40, "admin", "existing")
    store.account(existing, consent="new", enroll=True)
    assert store.balance(existing) == 425
    with pytest.raises(CloudError, match="operator_budget_exhausted"):
        store.account(str(uuid4()), consent="new", enroll=True)
    with store.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 1
        assert db.execute("SELECT trial_granted FROM accounts").fetchone()[0] == 0


def test_concurrent_new_users_cannot_exceed_nine_or_double_grant(tmp_path):
    store = setup(tmp_path)
    existing = str(uuid4())
    store.account(existing, consent="old")
    store.grant(existing, 425, time.time() + 86400 * 40, "admin", "existing")
    store.add_funds(700_000_000, "beta")
    owners = [str(uuid4()) for _ in range(18)]
    def enroll(owner):
        try:
            store.account(owner, consent="v", enroll=True)
            store.account(owner, consent="v", enroll=True)
            return True
        except CloudError as error:
            assert error.code == "cloud_registration_capacity_reached"
            return False
    with ThreadPoolExecutor(max_workers=6) as executor:
        assert sum(executor.map(enroll, owners)) == 9
    with store.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 10
        assert db.execute("SELECT COUNT(*),SUM(remaining) FROM credit_lots WHERE kind='trial'").fetchone()[:] == (9, 9000)
    assert store.balance(existing) == 425


def test_all_existing_credit_liability_and_fund_expiry_are_checked(tmp_path):
    store = setup(tmp_path)
    existing = str(uuid4())
    store.account(existing, consent="v")
    store.grant(existing, 1000, time.time() + 86400 * 40, "admin", "existing")
    store.add_funds(16_666_667, "one-person-only")
    with pytest.raises(CloudError, match="operator_budget_exhausted"):
        store.account(str(uuid4()), consent="v", enroll=True)
    store.add_funds(100_000_000, "second")
    with store.transaction() as db:
        db.execute("UPDATE funds SET expires=? WHERE kind='operator'", (time.time() + 86400 * 29,))
    with pytest.raises(CloudError, match="operator_budget_exhausted"):
        store.account(str(uuid4()), consent="v", enroll=True)


def test_private_remaining_fund_does_not_become_public_funding(tmp_path):
    store = setup(tmp_path)
    with store.transaction() as db:
        db.execute("INSERT INTO funds VALUES('private-test-budget',100000000,253402300799,'private')")
    with pytest.raises(CloudError, match="operator_budget_exhausted"):
        store.account(str(uuid4()), consent="v", enroll=True)


def test_other_four_routes_are_rejected_before_network(tmp_path):
    store = setup(tmp_path, inference_enabled=True, openrouter_approved=True, openrouter_key="fixture")
    routes = {row['id']: row for row in public_routes(store.config)}
    for key in ("cloud-deepseek-baidu", "cloud-deepseek-decart", "cloud-gpt-luna-flex", "cloud-claude-haiku"):
        assert routes[key]['available'] is False
        with pytest.raises(CloudError, match="cloud_route_not_available"):
            operator_provider(store.config, session="fixture", route_id=key)
    for key in store.config.allowed_model_routes:
        assert routes[key]['available'] is True
    with pytest.raises(ValueError, match="invalid cloud model allowlist"):
        replace(store.config, allowed_model_routes=("unverified",))
