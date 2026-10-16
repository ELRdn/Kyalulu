"""Offline failed-cost reviews; every provider request uses MockTransport."""

import hashlib
import importlib.util
import json
import math
import sqlite3
from contextlib import closing, nullcontext
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

from python.cloud.config import CloudConfig
from python.cloud.contracts import ROUTES
from python.cloud.store import CloudStore, fingerprint
from python.storage.runtime_lock import RuntimeLock


MAX_COST = 5_430_562
ACTUAL = 1_178_569
PRIOR = 49_548_721
ACCOUNTED = PRIOR + MAX_COST
PROVIDER_TOTAL = PRIOR + ACTUAL
NATIVE_ACTUAL = 269_726
NATIVE_MAX_COST = 3_595_466


@pytest.fixture
def admin():
    spec = importlib.util.spec_from_file_location(
        "cloud_cost_review_admin_test", Path(__file__).parents[1] / "scripts/cloud_admin.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(autouse=True)
def forbid_real_http(monkeypatch):
    def blocked(*args, **kwargs):
        pytest.fail("real HTTP is forbidden in cost review tests")
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)


@pytest.fixture
def review_case(tmp_path, request):
    actual, max_cost, route = getattr(request, "param", (ACTUAL, MAX_COST, "cloud-deepseek-baidu"))
    store = CloudStore(CloudConfig(
        root=tmp_path / "cloud", origin="https://cloud.test", secret="s" * 32,
        private_test=True, allowed_emails=("owner@example.test",), signup_limit=1,
        trial_credits=0, monthly_subsidy_jpy=0, test_budget_nano=100_000_000,
        test_prior_cost_nano=PRIOR, openrouter_key="mock-review-key",
    ))
    owner, operation = str(uuid4()), str(uuid4())
    store.account(owner, consent="fixture-consent")
    store.admin_grant(owner, 500, "once")
    quote = store.quote(owner, "failed-request", 400, max_cost, route)
    store.reserve(owner, operation, "failed-request", quote, 400)
    with store.transaction() as db:
        created = db.execute("SELECT created FROM operations WHERE id=?", (operation,)).fetchone()[0]
    evidence = {
        "operation": operation, "generation_id_transcribed": f"gen-{math.ceil(created)}-ABC123",
        "http_status": 429, "attempts": 1, "screenshot_sha256": "a" * 64,
        "expected_cost_nano": actual, "expected_max_cost_nano": max_cost,
        "expected_fingerprint": "failed-request",
    }
    tenant = store.config.root / "tenants" / owner / "data.db"
    tenant.parent.mkdir(parents=True)
    with closing(sqlite3.connect(tenant)) as db:
        db.execute("CREATE TABLE generations(generation_id TEXT PRIMARY KEY, status TEXT, result_json TEXT)")
        db.execute("INSERT INTO generations VALUES(?,'failed',?)", (operation, json.dumps({
            "error": "provider_usage_unavailable",
            "cloud_accounting": {"cost": actual, "review_required": True},
        })))
        db.commit()
    return store, owner, operation, evidence, tenant


def snapshot(store, tenant):
    with store.transaction() as db, closing(sqlite3.connect(tenant)) as con:
        return tuple(db.iterdump()), tuple(con.iterdump())


def billing_transport(store, calls, response=None):
    if response is None:
        response = httpx.Response(200, text='{"data":{"usage":0.050727290,"label":"mock-review-key"}}')

    def respond(request):
        assert request.method == "GET"
        assert str(request.url) == "https://openrouter.ai/api/v1/key"
        assert request.headers["Authorization"] == "Bearer " + store.config.openrouter_key
        calls.append((request.method, str(request.url)))
        return response
    return httpx.MockTransport(respond)


def update_accounting(tenant, operation, **changes):
    with closing(sqlite3.connect(tenant)) as db:
        result = json.loads(db.execute(
            "SELECT result_json FROM generations WHERE generation_id=?", (operation,)
        ).fetchone()[0])
        result["cloud_accounting"].update(changes)
        db.execute("UPDATE generations SET result_json=? WHERE generation_id=?",
                   (json.dumps(result), operation))
        db.commit()


@pytest.mark.parametrize("reason", [None, "missing_cost", "missing_usage"])
def test_retain_full_cost_and_replay_after_restart(admin, review_case, capsys, reason):
    store, owner, operation, evidence, tenant = review_case
    store.settle(owner, operation, ACTUAL, success=False, review_required=True)
    if reason:
        update_accounting(tenant, operation, review_reason=reason, provider_error="provider_rate_limited")
    assert store.private_budget()["available_nano"] == 0
    with store.transaction() as db:
        original = dict(db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchone())
        credits = tuple(db.execute("SELECT * FROM credit_lots").fetchall())
    tenant_before = tenant.read_bytes()
    calls = []
    transport = billing_transport(store, calls)
    result = admin.retain_failed_reservation(store, operation, evidence, transport=transport)
    assert result == {
        "reviewed": True, "replayed": False, "cost_basis": "worst_case_reservation",
        "retained_cost_nano": MAX_COST, "provider_total_nano": PROVIDER_TOTAL,
        "accounted_nano": ACCOUNTED, "remaining_nano": 100_000_000 - ACCOUNTED,
    }
    assert len(calls) == 1
    with store.transaction() as db:
        assert dict(db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchone()) == {
            **original, "actual_cost": MAX_COST, "review_required": 0,
        }
        assert tuple(db.execute("SELECT * FROM credit_lots").fetchall()) == credits
        audit = dict(db.execute("SELECT * FROM provider_cost_reviews").fetchone())
        assert db.execute("SELECT COUNT(*) FROM provider_cost_reviews").fetchone()[0] == 1
    assert audit.pop("created") > 0
    assert audit == {
        "operation": operation, "evidence_hash": fingerprint(evidence),
        "old_cost": ACTUAL, "retained_cost": MAX_COST, "provider_total": PROVIDER_TOTAL,
        "operation_fingerprint": original["fingerprint"],
        "key_fingerprint": hashlib.sha256(store.config.openrouter_key.encode()).hexdigest(),
        "basis": "429_full_reservation_retained_receipt_unavailable",
    }
    assert store.balance(owner) == 500
    assert store.private_budget()["available_nano"] == 100_000_000 - ACCOUNTED
    before = snapshot(store, tenant)
    for restarted in (store, CloudStore(store.config)):
        restarted.recover()
        replay = admin.retain_failed_reservation(
            restarted, operation, dict(reversed(list(evidence.items()))), transport=transport
        )
        assert replay == {"reviewed": True, "replayed": True, "retained_cost_nano": MAX_COST}
        assert snapshot(restarted, tenant) == before
        assert restarted.balance(owner) == 500
    assert len(calls) == 1
    assert tenant.read_bytes() == tenant_before
    assert store.config.openrouter_key not in json.dumps(result)
    assert store.config.openrouter_key not in "\n".join(before[0])
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


@pytest.mark.parametrize("field,value,error", [
    ("operation", str(uuid4()), "private_failed_request_evidence_required"),
    ("http_status", 503, "private_failed_request_evidence_required"),
    ("attempts", True, "private_failed_request_evidence_required"),
    ("screenshot_sha256", "invalid", "private_failed_request_evidence_required"),
    ("expected_cost_nano", None, "private_failed_request_evidence_required"),
    ("generation_id_transcribed", "invalid", "provider_request_id_required"),
    ("generation_id_transcribed", "gen-1-ABC123", "provider_request_operation_mismatch"),
    ("expected_cost_nano", ACTUAL + 1, "failed_reservation_not_reviewable"),
    ("expected_max_cost_nano", MAX_COST + 1, "failed_reservation_not_reviewable"),
    ("expected_fingerprint", "different-request", "failed_reservation_not_reviewable"),
])
def test_invalid_evidence_rejected_before_get(admin, review_case, field, value, error, capsys):
    store, owner, operation, evidence, tenant = review_case
    store.settle(owner, operation, ACTUAL, success=False, review_required=True)
    evidence[field] = value
    before, calls = snapshot(store, tenant), []
    with pytest.raises(ValueError, match=error) as rejected:
        admin.retain_failed_reservation(store, operation, evidence,
                                        transport=billing_transport(store, calls))
    assert snapshot(store, tenant) == before
    assert calls == []
    assert store.config.openrouter_key not in str(rejected.value)
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


@pytest.mark.parametrize("case,error", [
    ("not-private", "private_failed_request_evidence_required"),
    ("other-backend", "private_failed_request_evidence_required"),
    ("runtime-running", "runtime_already_running_or_lock_unavailable"),
    ("max-overrun", "failed_reservation_not_reviewable"),
    ("pending", "unsettled_liability_blocks_review"),
    ("budget-debt", "unsettled_liability_blocks_review"),
    ("provider-total-high", "provider_billing_exceeds_retained_budget"),
    ("budget-equal", "provider_billing_exceeds_retained_budget"),
    ("budget-insufficient", "provider_billing_exceeds_retained_budget"),
])
def test_review_rejection_preserves_ledgers(admin, review_case, case, error):
    store, owner, operation, evidence, tenant = review_case
    if case == "pending":
        with store.transaction() as db:
            db.execute("INSERT INTO operations(owner,id,fingerprint,state,route,max_credits,max_cost,created) "
                       "VALUES(?,?,?,'pending',?,1,1,0)",
                       (str(uuid4()), str(uuid4()), "pending-request", "cloud-deepseek-baidu"))
    cost = MAX_COST + 1 if case == "max-overrun" else ACTUAL
    store.settle(owner, operation, cost, success=False, review_required=True)
    if case == "max-overrun":
        evidence["expected_cost_nano"] = cost
        update_accounting(tenant, operation, cost=cost)
    elif case == "not-private":
        store.config = replace(store.config, private_test=False)
    elif case == "other-backend":
        store.config = replace(store.config, private_test=False, operator_backend="deepseek")
    elif case == "budget-debt":
        with store.transaction() as db:
            db.execute("INSERT INTO budget_debt VALUES('fixture-debt',1)")
    elif case in {"budget-equal", "budget-insufficient"}:
        store.config = replace(store.config, test_budget_nano=ACCOUNTED - int(case == "budget-insufficient"))
    response = (httpx.Response(200, text='{"data":{"usage":0.0549792831}}')
                if case == "provider-total-high" else None)
    before, calls = snapshot(store, tenant), []
    lock = RuntimeLock(store.config.root) if case == "runtime-running" else nullcontext()
    with lock, pytest.raises(ValueError, match=error):
        admin.retain_failed_reservation(store, operation, evidence,
                                        transport=billing_transport(store, calls, response))
    assert snapshot(store, tenant) == before
    assert len(calls) <= 1
    if case in {"not-private", "other-backend", "runtime-running"}:
        assert calls == []


@pytest.mark.parametrize("status,body,error", [
    (503, '{"error":"mock-review-key"}', "provider_billing_snapshot_unavailable"),
    (200, '{"data":{"usage":null}}', "provider_billing_snapshot_invalid"),
    (200, '{"data":{"usage":true}}', "provider_billing_snapshot_invalid"),
    (200, '{"data":{"usage":"0.05"}}', "provider_billing_snapshot_invalid"),
    (200, '{"data":{"usage":-0.01}}', "provider_billing_snapshot_invalid"),
    (200, '{"data":{"usage":NaN}}', "provider_billing_snapshot_invalid"),
    (200, '{"data":[]}', "provider_billing_snapshot_invalid"),
])
def test_unavailable_or_invalid_provider_snapshot(admin, review_case, status, body, error, capsys):
    store, owner, operation, evidence, tenant = review_case
    store.settle(owner, operation, ACTUAL, success=False, review_required=True)
    before, calls = snapshot(store, tenant), []
    with pytest.raises(ValueError, match=error) as rejected:
        admin.retain_failed_reservation(store, operation, evidence,
            transport=billing_transport(store, calls, httpx.Response(status, text=body)))
    assert snapshot(store, tenant) == before
    assert len(calls) == 1
    assert store.config.openrouter_key not in str(rejected.value)
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


@pytest.mark.parametrize("accounting", [
    {"review_reason": "per_call_overrun"},
    {"review_reason": "invalid_usage"},
    {"review_reason": "invalid_cost"},
    {"review_reason": "decreasing_cost"},
    {"review_reason": "missing_cost", "provider_error": "provider_unavailable"},
    {"cost": ACTUAL + 1},
])
def test_review_refuses_tenant_evidence_even_below_operation_max(admin, review_case, accounting):
    store, owner, operation, evidence, tenant = review_case
    store.settle(owner, operation, ACTUAL, success=False, review_required=True)
    update_accounting(tenant, operation, **accounting)
    before, calls = snapshot(store, tenant), []
    with pytest.raises(ValueError, match="failed_generation_not_a_missing_429_bill"):
        admin.retain_failed_reservation(store, operation, evidence,
                                        transport=billing_transport(store, calls))
    assert snapshot(store, tenant) == before
    assert len(calls) <= 1


@pytest.mark.parametrize("field,value", [
    ("evidence", "b" * 64), ("state", "completed"), ("actual_cost", MAX_COST - 1),
    ("max_cost", MAX_COST + 1), ("fingerprint", "changed-request"),
    ("review_required", 1), ("charged_credits", 1),
])
def test_replay_conflicts_do_not_mutate_audit_or_get(admin, review_case, field, value):
    store, owner, operation, evidence, tenant = review_case
    store.settle(owner, operation, ACTUAL, success=False, review_required=True)
    calls = []
    transport = billing_transport(store, calls)
    admin.retain_failed_reservation(store, operation, evidence, transport=transport)
    if field == "evidence":
        evidence["screenshot_sha256"] = value
    else:
        with store.transaction() as db:
            db.execute(f"UPDATE operations SET {field}=? WHERE id=?", (value, operation))
    before = snapshot(store, tenant)
    with pytest.raises(ValueError, match="provider_review_conflict"):
        admin.retain_failed_reservation(CloudStore(store.config), operation, evidence, transport=transport)
    assert snapshot(store, tenant) == before
    assert len(calls) == 1


def test_update_failure_rolls_back_audit_table_and_operation(admin, review_case):
    store, owner, operation, evidence, tenant = review_case
    store.settle(owner, operation, ACTUAL, success=False, review_required=True)
    with store.transaction() as db:
        assert not db.execute(
            "SELECT 1 FROM sqlite_master WHERE name='provider_cost_reviews'"
        ).fetchone()
        db.execute("CREATE TRIGGER reject_review_update BEFORE UPDATE ON operations "
                   "BEGIN SELECT RAISE(ABORT, 'synthetic_update_failure'); END")
    before, calls = snapshot(store, tenant), []
    with pytest.raises(sqlite3.IntegrityError, match="synthetic_update_failure"):
        admin.retain_failed_reservation(store, operation, evidence,
                                        transport=billing_transport(store, calls))
    assert len(calls) == 1
    assert snapshot(store, tenant) == before
    with store.transaction() as db:
        assert not db.execute(
            "SELECT 1 FROM sqlite_master WHERE name='provider_cost_reviews'"
        ).fetchone()
        row = db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchone()
        assert row["actual_cost"] == ACTUAL and row["review_required"] == 1
    assert store.balance(owner) == 500


def test_disaster_restore_preserves_review_and_replays_without_get(admin, review_case, tmp_path):
    store, owner, operation, evidence, tenant = review_case
    store.settle(owner, operation, ACTUAL, success=False, review_required=True)
    calls = []
    transport = billing_transport(store, calls)
    admin.retain_failed_reservation(store, operation, evidence, transport=transport)
    assert len(calls) == 1
    assert store.private_budget()["available_nano"] == 100_000_000 - ACCOUNTED
    before = snapshot(store, tenant)
    with store.transaction() as db:
        audit = dict(db.execute("SELECT * FROM provider_cost_reviews").fetchone())
    backup = tmp_path / "review.kybackup"
    admin.disaster_backup(store, backup)
    target = CloudStore(replace(store.config, root=tmp_path / "restored-cloud",
                                backup_root=tmp_path / "restored-backups"))
    admin.disaster_restore(target, backup)
    restored = CloudStore(target.config)
    restored_tenant = restored.config.root / "tenants" / owner / "data.db"
    assert snapshot(restored, restored_tenant) == before
    with restored.transaction() as db:
        assert dict(db.execute("SELECT * FROM provider_cost_reviews").fetchone()) == audit
        row = db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchone()
        assert row["state"] == "failed" and row["charged_credits"] == 0
        assert row["actual_cost"] == MAX_COST and row["review_required"] == 0
    assert restored.balance(owner) == 500
    assert restored.private_budget()["available_nano"] == 100_000_000 - ACCOUNTED
    calls.clear()
    assert admin.retain_failed_reservation(restored, operation, evidence, transport=transport) == {
        "reviewed": True, "replayed": True, "retained_cost_nano": MAX_COST,
    }
    assert calls == []
    assert snapshot(restored, restored_tenant) == before
    assert snapshot(store, tenant) == before


@pytest.fixture
def native_failure_case(review_case, request):
    store, owner, operation, evidence, tenant = review_case
    status, reason = getattr(request, "param", (404, "missing_cost"))
    actual = evidence["expected_cost_nano"]
    store.settle(owner, operation, actual, success=False, review_required=True)
    result = {
        "error": "provider_rate_limited" if status == 429 else "safety_route_unavailable",
        "cloud_accounting": {"cost": actual, "review_required": True,
                             "review_reason": reason,
                             "provider_error": "provider_rate_limited" if status == 429 else None},
    }
    with closing(sqlite3.connect(tenant)) as db:
        db.execute("UPDATE generations SET result_json=? WHERE generation_id=?",
                   (json.dumps(result), operation))
        db.commit()
    evidence["http_status"] = status
    evidence["failure_record_sha256"] = fingerprint(result)
    del evidence["screenshot_sha256"]
    del evidence["generation_id_transcribed"]
    return (*review_case, result)


@pytest.mark.parametrize("review_case", [
    pytest.param((NATIVE_ACTUAL, NATIVE_MAX_COST, route), id=route)
    for route, contract in ROUTES.items() if contract.payer == "operator"
], indirect=True)
@pytest.mark.parametrize("native_failure_case", [
    (404, "missing_cost"), (429, "missing_cost"), (429, "missing_usage"),
], indirect=True)
def test_native_review_retains_max_and_replays_without_get(admin, native_failure_case, capsys):
    store, owner, operation, evidence, tenant, _ = native_failure_case
    assert "screenshot_sha256" not in evidence and "generation_id_transcribed" not in evidence
    assert store.private_budget()["available_nano"] == 0
    with store.transaction() as db:
        original = dict(db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchone())
    tenant_before = snapshot(store, tenant)[1]
    calls = []
    transport = billing_transport(store, calls, httpx.Response(200, text='{"data":{"usage":0.049818447}}'))
    result = admin.retain_failed_reservation(store, operation, evidence, transport=transport)
    accounted = PRIOR + NATIVE_MAX_COST
    assert result == {
        "reviewed": True, "replayed": False, "cost_basis": "worst_case_reservation",
        "retained_cost_nano": NATIVE_MAX_COST, "provider_total_nano": PRIOR + NATIVE_ACTUAL,
        "accounted_nano": accounted, "remaining_nano": 100_000_000 - accounted,
    }
    assert len(calls) == 1
    with store.transaction() as db:
        assert dict(db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchone()) == {
            **original, "actual_cost": NATIVE_MAX_COST, "review_required": 0,
        }
        audit = dict(db.execute("SELECT * FROM provider_cost_reviews").fetchone())
        assert db.execute("SELECT COUNT(*) FROM provider_cost_reviews").fetchone()[0] == 1
    assert audit.pop("created") > 0
    assert audit == {
        "operation": operation, "evidence_hash": fingerprint(evidence),
        "old_cost": NATIVE_ACTUAL, "retained_cost": NATIVE_MAX_COST,
        "provider_total": PRIOR + NATIVE_ACTUAL,
        "operation_fingerprint": "failed-request",
        "key_fingerprint": hashlib.sha256(store.config.openrouter_key.encode()).hexdigest(),
        "basis": str(evidence["http_status"]) + "_full_reservation_retained_receipt_unavailable",
    }
    assert store.balance(owner) == 500
    assert store.private_budget()["available_nano"] == 100_000_000 - accounted
    before = snapshot(store, tenant)
    assert before[1] == tenant_before
    for restarted in (store, CloudStore(store.config)):
        replay = admin.retain_failed_reservation(restarted, operation, evidence, transport=transport)
        assert replay == {"reviewed": True, "replayed": True, "retained_cost_nano": NATIVE_MAX_COST}
        assert snapshot(restarted, tenant) == before
        assert restarted.balance(owner) == 500
    assert len(calls) == 1
    assert store.config.openrouter_key not in json.dumps(result)
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


@pytest.mark.parametrize("review_case", [
    (NATIVE_ACTUAL, NATIVE_MAX_COST, "cloud-deepseek-inferencenet"),
], indirect=True)
@pytest.mark.parametrize("native_failure_case", [
    (404, "missing_cost"), (429, "missing_cost"),
], indirect=True)
@pytest.mark.parametrize("fault", [
    "native-hash", "tenant-error", "invalid_cost", "invalid_usage", "per_call_overrun",
])
def test_native_rejection_preserves_ledgers(admin, native_failure_case, fault):
    store, owner, operation, evidence, tenant, result = native_failure_case
    if fault == "native-hash":
        evidence["failure_record_sha256"] = "b" * 64
    else:
        if fault == "tenant-error":
            result["error"] = "provider_usage_unavailable"
        else:
            result["cloud_accounting"]["review_reason"] = fault
        with closing(sqlite3.connect(tenant)) as db:
            db.execute("UPDATE generations SET result_json=? WHERE generation_id=?",
                       (json.dumps(result), operation))
            db.commit()
        evidence["failure_record_sha256"] = fingerprint(result)
    before, calls = snapshot(store, tenant), []
    with pytest.raises(ValueError, match="failed_generation_not_a_missing_429_bill"):
        admin.retain_failed_reservation(store, operation, evidence,
                                        transport=billing_transport(store, calls))
    assert snapshot(store, tenant) == before
    assert store.balance(owner) == 500
    assert len(calls) <= 1


@pytest.mark.parametrize("native_failure_case", [(429, "missing_cost")], indirect=True)
@pytest.mark.parametrize("fault", [
    "missing-provider-error", "other-provider-error", "missing-reason", "decreasing_cost",
    "cost-mismatch", "malformed-accounting", "byok-route", "unrecognized-route",
    "hash-format", "fingerprint", "max-cost", "overrun", "provider-total-high",
    "snapshot-invalid", "replay-result-changed",
])
def test_native_429_strict_evidence_and_billing_guards(admin, native_failure_case, fault):
    store, owner, operation, evidence, tenant, result = native_failure_case
    calls = []
    response = None
    error = "failed_generation_not_a_missing_429_bill"
    if fault == "missing-provider-error":
        result["cloud_accounting"].pop("provider_error")
    elif fault == "other-provider-error":
        result["cloud_accounting"]["provider_error"] = "provider_unavailable"
    elif fault == "missing-reason":
        result["cloud_accounting"].pop("review_reason")
    elif fault == "decreasing_cost":
        result["cloud_accounting"]["review_reason"] = fault
    elif fault == "cost-mismatch":
        result["cloud_accounting"]["cost"] += 1
    elif fault == "malformed-accounting":
        result["cloud_accounting"] = []
    elif fault in {"byok-route", "unrecognized-route", "overrun"}:
        with store.transaction() as db:
            if fault == "overrun":
                db.execute("UPDATE operations SET actual_cost=max_cost+1 WHERE id=?", (operation,))
                evidence["expected_cost_nano"] = evidence["expected_max_cost_nano"] + 1
            else:
                route = "byok-deepseek" if fault == "byok-route" else "unknown"
                db.execute("UPDATE operations SET route=? WHERE id=?", (route, operation))
        error = "failed_reservation_not_reviewable"
    elif fault == "hash-format":
        evidence["failure_record_sha256"] = "invalid"
        error = "private_failed_request_evidence_required"
    elif fault in {"fingerprint", "max-cost"}:
        field = "expected_fingerprint" if fault == "fingerprint" else "expected_max_cost_nano"
        evidence[field] = "different-request" if fault == "fingerprint" else MAX_COST + 1
        error = "failed_reservation_not_reviewable"
    elif fault == "provider-total-high":
        response = httpx.Response(200, text='{"data":{"usage":0.1}}')
        error = "provider_billing_exceeds_retained_budget"
    elif fault == "snapshot-invalid":
        response = httpx.Response(200, text='{"data":{"usage":null}}')
        error = "provider_billing_snapshot_invalid"
    elif fault == "replay-result-changed":
        admin.retain_failed_reservation(store, operation, evidence,
                                       transport=billing_transport(store, calls))
        result["error"] = "provider_usage_unavailable"
        error = "provider_review_conflict"
    with closing(sqlite3.connect(tenant)) as db:
        db.execute("UPDATE generations SET result_json=? WHERE generation_id=?",
                   (json.dumps(result), operation))
        db.commit()
    if fault != "hash-format" and fault != "replay-result-changed":
        evidence["failure_record_sha256"] = fingerprint(result)
    before = snapshot(store, tenant)
    with pytest.raises(ValueError, match=error):
        admin.retain_failed_reservation(store, operation, evidence,
                                       transport=billing_transport(store, calls, response))
    assert snapshot(store, tenant) == before
    assert store.balance(owner) == 500
    assert len(calls) <= 1
