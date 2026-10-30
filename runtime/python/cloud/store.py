"""Single-writer hosted control plane: integer balances, funded budgets and sessions.

All admission and settlement use BEGIN IMMEDIATE. No network await occurs inside
transactions. Uncertain work retains its worst-case provider cost on restart.
"""

from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import hashlib
import json
import secrets
import sqlite3
import time
from uuid import UUID

from .contracts import PLANS, TARIFF, ROUTES


class CloudError(ValueError):
    def __init__(self, code, status=400):
        self.code, self.status = code, status
        super().__init__(code)


def period(now=None):
    return datetime.fromtimestamp(now or time.time(), timezone(timedelta(hours=9))).strftime(
        "%Y-%m"
    )


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def fingerprint(value):
    return digest(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")))


DDL = """
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, plan TEXT NOT NULL DEFAULT 'free',
 plan_until REAL NOT NULL DEFAULT 0, customer TEXT UNIQUE, trial_granted INTEGER NOT NULL DEFAULT 0,
 suspended INTEGER NOT NULL DEFAULT 0, consent_version TEXT NOT NULL, sync_mode TEXT NOT NULL DEFAULT 'off');
CREATE TABLE IF NOT EXISTS secrets(owner TEXT, kind TEXT, value TEXT, PRIMARY KEY(owner,kind));
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, owner TEXT, access TEXT, refresh TEXT, expires REAL, checked REAL);
CREATE TABLE IF NOT EXISTS flows(hash TEXT PRIMARY KEY, verifier TEXT, expires REAL);
CREATE TABLE IF NOT EXISTS credit_lots(id TEXT PRIMARY KEY, owner TEXT, remaining INTEGER CHECK(remaining>=0),
 expires REAL, kind TEXT, source TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS credit_owner ON credit_lots(owner,expires);
CREATE TABLE IF NOT EXISTS funds(id TEXT PRIMARY KEY, remaining INTEGER CHECK(remaining>=0), expires REAL, kind TEXT);
CREATE TABLE IF NOT EXISTS quotes(id TEXT PRIMARY KEY, owner TEXT, fingerprint TEXT, max_credits INTEGER,
 max_cost INTEGER, expires REAL, route TEXT, tariff TEXT);
CREATE TABLE IF NOT EXISTS quote_provider_tariffs(id TEXT PRIMARY KEY, version TEXT NOT NULL,
 FOREIGN KEY(id) REFERENCES quotes(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS operations(owner TEXT, id TEXT, fingerprint TEXT, state TEXT, route TEXT,
 max_credits INTEGER, max_cost INTEGER, charged_credits INTEGER NOT NULL DEFAULT 0,
 actual_cost INTEGER NOT NULL DEFAULT 0, created REAL, PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS credit_holds(owner TEXT, operation TEXT, lot TEXT, amount INTEGER,
 PRIMARY KEY(owner,operation,lot));
CREATE TABLE IF NOT EXISTS fund_holds(owner TEXT, operation TEXT, fund TEXT, amount INTEGER,
 PRIMARY KEY(owner,operation,fund));
CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY, hash TEXT, created REAL);
CREATE TABLE IF NOT EXISTS sync_heads(owner TEXT, id TEXT, revision INTEGER, deleted INTEGER,
 payload TEXT, PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS sync_requests(owner TEXT, id TEXT, hash TEXT, result TEXT, PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS ad_tickets(hash TEXT PRIMARY KEY, owner TEXT, expires REAL, day TEXT, used INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, owner TEXT, sku TEXT, net_nano INTEGER, expires REAL, revoked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS receipt_terms(id TEXT PRIMARY KEY, terms TEXT NOT NULL, funded INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS checkout_terms(id TEXT PRIMARY KEY, owner TEXT NOT NULL, sku TEXT NOT NULL, terms TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS billing_subscriptions(id TEXT PRIMARY KEY, owner TEXT);
CREATE TABLE IF NOT EXISTS sync_devices(hash TEXT PRIMARY KEY, owner TEXT, expires REAL, session_hash TEXT);
CREATE TABLE IF NOT EXISTS budget_debt(source TEXT PRIMARY KEY, amount INTEGER CHECK(amount>=0));
CREATE TABLE IF NOT EXISTS receipt_revocations(source TEXT PRIMARY KEY, owner TEXT, suspend INTEGER);
CREATE TABLE IF NOT EXISTS billing_jobs(id TEXT PRIMARY KEY, hash TEXT, payload TEXT, due REAL, attempts INTEGER DEFAULT 0, state TEXT DEFAULT 'pending', error TEXT);
CREATE TABLE IF NOT EXISTS backup_capacity(owner TEXT PRIMARY KEY, storage_bytes INTEGER, restore_days INTEGER, expires REAL);
CREATE TABLE IF NOT EXISTS admin_grants(source TEXT PRIMARY KEY, owner TEXT, amount INTEGER, expires REAL);
CREATE TABLE IF NOT EXISTS private_budgets(id TEXT PRIMARY KEY, prior_cost INTEGER);
CREATE TABLE IF NOT EXISTS operator_fundings(source TEXT PRIMARY KEY, amount INTEGER NOT NULL,
 days INTEGER NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS credit_debts(owner TEXT, operation TEXT, amount INTEGER CHECK(amount>=0),
 PRIMARY KEY(owner,operation));
CREATE TABLE IF NOT EXISTS bounded_cost_retentions(owner TEXT, operation TEXT, reason TEXT,
 observed_cost INTEGER, retained_cost INTEGER, created REAL, PRIMARY KEY(owner,operation));
"""


class CloudStore:
    def __init__(self, config):
        self.config = config
        config.root.mkdir(parents=True, exist_ok=True)
        self.path = config.root / "control.db"
        from cryptography.fernet import Fernet
        import base64

        self.cipher = Fernet(
            base64.urlsafe_b64encode(hashlib.sha256(config.secret.encode()).digest())
        )
        with self.transaction() as db:
            db.executescript(DDL)
            if "markup" not in {r[1] for r in db.execute("PRAGMA table_info(operations)")}:
                db.execute("ALTER TABLE operations ADD COLUMN markup INTEGER NOT NULL DEFAULT 6")
            if "review_required" not in {r[1] for r in db.execute("PRAGMA table_info(operations)")}:
                db.execute("ALTER TABLE operations ADD COLUMN review_required INTEGER NOT NULL DEFAULT 0")
            if "valid_until" not in {r[1] for r in db.execute("PRAGMA table_info(sessions)")}:
                db.execute("ALTER TABLE sessions ADD COLUMN valid_until REAL NOT NULL DEFAULT 0")

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def encrypt(self, value):
        return self.cipher.encrypt(value.encode()).decode()

    def decrypt(self, value):
        return self.cipher.decrypt(value.encode()).decode()

    def account(self, owner, *, consent=None, enroll=False):
        owner = str(UUID(owner))
        with self.transaction() as db:
            if consent:
                is_new = not db.execute("SELECT 1 FROM accounts WHERE id=?", (owner,)).fetchone()
                if is_new:
                    if db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] >= self.config.signup_limit:
                        raise CloudError("cloud_registration_capacity_reached", 503)
                db.execute(
                    "INSERT INTO accounts(id,consent_version) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET consent_version=excluded.consent_version",
                    (owner, consent),
                )
                if is_new and enroll and self.config.trial_credits:
                    self._trial(owner, db, required=True)
            row = db.execute("SELECT * FROM accounts WHERE id=?", (owner,)).fetchone()
            if not row:
                raise CloudError("consent_required", 403)
            account = dict(row)
        account["plan"] = account["plan"] if account["plan_until"] > time.time() else "free"
        return account

    def add_funds(self, amount, source, *, days=45):
        """Offline single contributions; spent funds cannot be replenished by replay."""
        if (type(amount) is not int or not 0 < amount <= 700_000_000
                or not isinstance(source, str) or not source or len(source) > 128
                or type(days) is not int or not 30 <= days <= 180):
            raise CloudError("invalid_operator_funding")
        with self.transaction() as db:
            previous = db.execute("SELECT * FROM operator_fundings WHERE source=?", (source,)).fetchone()
            if previous:
                if previous["amount"] != amount or previous["days"] != days:
                    raise CloudError("operator_funding_conflict", 409)
                return {"funded": False, "amount_nano_usd": amount}
            total = db.execute("SELECT COALESCE(SUM(amount),0) FROM operator_fundings").fetchone()[0]
            if total + amount > 700_000_000:
                raise CloudError("operator_funding_limit", 409)
            expires = time.time() + days * 86400
            db.execute("INSERT INTO operator_fundings VALUES(?,?,?,?)", (source, amount, days, expires))
            db.execute("INSERT INTO funds VALUES(?,?,?,'operator')", ("operator:" + source, amount, expires))
            return {"funded": True, "amount_nano_usd": amount}

    def entitlements(self, owner):
        return PLANS[self.account(owner)["plan"]]

    def secret(self, owner, kind, value=None, delete=False):
        with self.transaction() as db:
            if delete:
                db.execute("DELETE FROM secrets WHERE owner=? AND kind=?", (owner, kind))
                return None
            if value is not None:
                db.execute(
                    "INSERT INTO secrets VALUES(?,?,?) ON CONFLICT(owner,kind) DO UPDATE SET value=excluded.value",
                    (owner, kind, self.encrypt(value)),
                )
            row = db.execute(
                "SELECT value FROM secrets WHERE owner=? AND kind=?", (owner, kind)
            ).fetchone()
            return self.decrypt(row[0]) if row else None

    def balance(self, owner, db=None):
        if db is None:
            with self.transaction() as con:
                return self.balance(owner, con)
        credits = db.execute(
            "SELECT COALESCE(SUM(remaining),0) FROM credit_lots WHERE owner=? AND expires>?",
            (owner, time.time()),
        ).fetchone()[0]
        debt = db.execute("SELECT COALESCE(SUM(amount),0) FROM credit_debts WHERE owner=?", (owner,)).fetchone()[0]
        return max(0, credits - debt)

    def _subsidy(self, db):
        if self.config.private_test:
            # All-time allowance, reconciled against durable usage and pending work.
            spent = db.execute("SELECT COALESCE(SUM(actual_cost),0) FROM operations WHERE state!='pending'").fetchone()[0]
            held = db.execute("SELECT COALESCE(SUM(amount),0) FROM fund_holds").fetchone()[0]
            db.execute("INSERT INTO private_budgets VALUES('initial',?) ON CONFLICT(id) "
                       "DO UPDATE SET prior_cost=MAX(prior_cost,excluded.prior_cost)", (self.config.test_prior_cost_nano,))
            prior = db.execute("SELECT prior_cost FROM private_budgets WHERE id='initial'").fetchone()[0]
            available = max(0, self.config.test_budget_nano - prior - spent - held)
            db.execute("INSERT INTO funds VALUES('private-test-budget',?,253402300799,'private') "
                       "ON CONFLICT(id) DO UPDATE SET remaining=excluded.remaining", (available,))
            return
        now = time.time()
        key = "subsidy:" + period(now)
        end = datetime.fromtimestamp(now, timezone(timedelta(hours=9)))
        end = (end.replace(day=28) + timedelta(days=4)).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        amount = self.config.monthly_subsidy_jpy * 1_000_000_000 // self.config.usd_jpy
        db.execute(
            "INSERT OR IGNORE INTO funds VALUES(?,?,?,'subsidy')", (key, amount, end.timestamp())
        )

    def _available_funds(self, db):
        self._subsidy(db)
        if db.execute("SELECT 1 FROM operations WHERE review_required=1 LIMIT 1").fetchone():
            # A per-call overrun/unknown bill stops admission without inventing debt.
            return 0
        if db.execute("SELECT 1 FROM budget_debt WHERE source LIKE 'provider-overrun:%' AND amount>0 LIMIT 1").fetchone():
            # Unexpected charges require reconciliation before any more sends.
            return 0
        available = db.execute(
            "SELECT COALESCE(SUM(remaining),0) FROM funds WHERE expires>? "
            "AND ((?=1 AND id='private-test-budget') OR (?=0 AND kind!='private'))",
            (time.time(), int(self.config.private_test), int(self.config.private_test))
        ).fetchone()[0]
        debt = db.execute("SELECT COALESCE(SUM(amount),0) FROM budget_debt").fetchone()[0]
        return max(0, available - debt)

    def private_budget(self):
        if not self.config.private_test:
            return None
        with self.transaction() as db:
            available = self._available_funds(db)
            return {"limit_nano": self.config.test_budget_nano,
                    "prior_accounted_nano": db.execute("SELECT prior_cost FROM private_budgets WHERE id='initial'").fetchone()[0],
                    "available_nano": available}

    def admin_grant(self, owner, amount, source, *, days=30):
        """Only offline administration calls this; no grant API is exposed."""
        owner = str(UUID(owner))
        if (type(amount) is not int or amount <= 0 or type(days) is not int or not 1 <= days <= 180
                or not isinstance(source, str) or not source or len(source) > 128):
            raise CloudError("invalid_admin_grant")
        with self.transaction() as db:
            account = db.execute("SELECT suspended FROM accounts WHERE id=?", (owner,)).fetchone()
            if not account or account[0]:
                raise CloudError("account_unavailable", 403)
            key = "admin:" + source
            previous = db.execute("SELECT * FROM admin_grants WHERE source=?", (key,)).fetchone()
            if previous:
                if previous["owner"] != owner or previous["amount"] != amount:
                    raise CloudError("admin_grant_conflict", 409)
                return {"granted": False, "balance": self.balance(owner, db), "credits": amount}
            liability = db.execute("SELECT COALESCE(SUM(remaining),0) FROM credit_lots WHERE expires>?", (time.time(),)).fetchone()[0]
            # Include held credits as an outstanding liability before issuing more.
            liability += db.execute("SELECT COALESCE(SUM(amount),0) FROM credit_holds").fetchone()[0]
            needed = ((liability + amount) * 100_000 + TARIFF.markup - 1) // TARIFF.markup
            if needed > self._available_funds(db):
                raise CloudError("operator_budget_exhausted", 503)
            expires = time.time() + days * 86400
            if db.execute("SELECT 1 FROM credit_lots WHERE source=?", (key,)).fetchone():
                raise CloudError("admin_grant_conflict", 409)
            self.grant(owner, amount, expires, "admin", key, db)
            db.execute("INSERT INTO admin_grants VALUES(?,?,?,?)", (key, owner, amount, expires))
            return {"granted": True, "balance": self.balance(owner, db), "credits": amount}

    def grant(self, owner, amount, expires, kind, source, db=None):
        if type(amount) is not int or amount <= 0 or expires <= time.time():
            raise CloudError("invalid_credit_grant")
        if db is None:
            with self.transaction() as con:
                return self.grant(owner, amount, expires, kind, source, con)
        db.execute(
            "INSERT OR IGNORE INTO credit_lots VALUES(?,?,?,?,?,?)",
            (secrets.token_hex(16), owner, amount, expires, kind, source),
        )

    def trial(self, owner):
        if not self.config.trial_credits:
            return False
        with self.transaction() as db:
            return self._trial(owner, db)

    def _trial(self, owner, db, *, required=False):
        row = db.execute("SELECT trial_granted,suspended FROM accounts WHERE id=?", (owner,)).fetchone()
        if not row or row[1]:
            raise CloudError("account_unavailable", 403)
        if row[0]:
            return False
        if self.config.unified_enabled:
            service = getattr(self, 'unified_service', None)
            if service is None:
                raise CloudError('unified_app_awaiting_acceptance', 503)
            expires = time.time() + 30 * 86400
            source = 'trial:' + owner
            service._reserve_free(db, owner, source, self.config.trial_credits, expires)
            service._grant_reserved(db, owner, source, self.config.trial_credits, expires, 'trial')
            db.execute('UPDATE accounts SET trial_granted=1 WHERE id=?', (owner,))
            return True
        liability = db.execute("SELECT COALESCE(SUM(remaining),0) FROM credit_lots WHERE expires>?",
                               (time.time(),)).fetchone()[0]
        liability += db.execute("SELECT COALESCE(SUM(amount),0) FROM credit_holds").fetchone()[0]
        needed = ((liability + self.config.trial_credits) * 100_000 + TARIFF.markup - 1) // TARIFF.markup
        available = self._available_funds(db)
        expires = time.time() + 30 * 86400
        if not self.config.private_test and self.config.monthly_subsidy_jpy == 0:
            durable = db.execute("SELECT COALESCE(SUM(remaining),0) FROM funds WHERE kind='operator' AND expires>=?",
                                 (expires,)).fetchone()[0]
            available = min(available, durable)
        if available < needed:
            if required:
                raise CloudError("operator_budget_exhausted", 503)
            return False
        self.grant(owner, self.config.trial_credits, expires, "trial", "trial:" + owner, db)
        db.execute("UPDATE accounts SET trial_granted=1 WHERE id=?", (owner,))
        return True

    def quote(self, owner, request_hash, credits, cost, route, *, provider_tariff=""):
        if type(credits) is not int or credits < 0 or type(cost) is not int or cost < 0:
            raise CloudError("invalid_quote")
        quote = secrets.token_urlsafe(24)
        with self.transaction() as db:
            db.execute("DELETE FROM quotes WHERE expires<=?", (time.time(),))
            if (
                db.execute("SELECT COUNT(*) FROM quotes WHERE owner=?", (owner,)).fetchone()[0]
                >= 20
            ):
                raise CloudError("quote_rate_limited", 429)
            db.execute(
                "INSERT INTO quotes VALUES(?,?,?,?,?,?,?,?)",
                (
                    quote,
                    owner,
                    request_hash,
                    credits,
                    cost,
                    time.time() + 120,
                    route,
                    TARIFF.version,
                ),
            )
            db.execute("INSERT INTO quote_provider_tariffs VALUES(?,?)", (quote, provider_tariff))
        return quote

    def reserve(self, owner, operation, request_hash, quote_id, maximum, *, provider_tariff=""):
        with self.transaction() as db:
            account = db.execute("SELECT suspended FROM accounts WHERE id=?", (owner,)).fetchone()
            if not account or account[0]:
                raise CloudError("account_unavailable", 403)
            previous = db.execute(
                "SELECT * FROM operations WHERE owner=? AND id=?", (owner, operation)
            ).fetchone()
            if previous:
                if previous["fingerprint"] != request_hash:
                    raise CloudError("generation_conflict", 409)
                if previous["state"] == "pending":
                    raise CloudError("generation_pending", 409)
                return dict(previous)
            q = db.execute(
                "SELECT q.*, COALESCE(p.version,'') AS provider_tariff FROM quotes q "
                "LEFT JOIN quote_provider_tariffs p ON q.id=p.id WHERE q.id=? AND q.owner=?", (quote_id, owner)
            ).fetchone()
            if (
                not q
                or q["expires"] <= time.time()
                or q["fingerprint"] != request_hash
                or q["tariff"] != TARIFF.version
                or q["provider_tariff"] != provider_tariff
            ):
                raise CloudError("quote_expired", 409)
            if type(maximum) is not int or maximum < q["max_credits"]:
                raise CloudError("quote_not_accepted", 409)
            if q["max_credits"] and self.balance(owner, db) < 1:
                raise CloudError("insufficient_credits", 402)
            if db.execute("SELECT 1 FROM operations WHERE owner=? AND state='pending' LIMIT 1", (owner,)).fetchone():
                raise CloudError("generation_pending", 409)
            if q["max_credits"] > self.balance(owner, db):
                raise CloudError("quote_expired", 409)
            if q["max_cost"] > self._available_funds(db):
                raise CloudError("operator_budget_exhausted", 503)
            # Failed generations still incur provider cost: cap abuse independently of wallet.
            recent = db.execute(
                "SELECT COUNT(*) FROM operations WHERE owner=? AND created>? AND (route='safety')=?",
                (owner, time.time() - 60, int(q["route"] == "safety")),
            ).fetchone()[0]
            if recent >= (60 if q["route"] == "safety" else 6):
                raise CloudError("generation_rate_limited", 429)
            db.execute(
                "INSERT INTO operations(owner,id,fingerprint,state,route,max_credits,max_cost,created,markup) VALUES(?,?,?,'pending',?,?,?,?,?)",
                (
                    owner,
                    operation,
                    request_hash,
                    q["route"],
                    q["max_credits"],
                    q["max_cost"],
                    time.time(),
                    TARIFF.markup,
                ),
            )
            self._hold(db, "funds", "fund_holds", "fund", owner, operation, q["max_cost"])
            db.execute("DELETE FROM quotes WHERE id=?", (quote_id,))
            return None

    def _hold(self, db, table, holds, column, owner, operation, amount):
        if amount == 0:
            return
        query = f"SELECT id,remaining FROM {table} WHERE expires>? AND remaining>0"
        args = [time.time()]
        if table == "credit_lots":
            query += " AND owner=?"
            args.append(owner)
        elif self.config.private_test:
            query += " AND id='private-test-budget'"
        for row in db.execute(query + " ORDER BY expires,id", args).fetchall():
            part = min(amount, row["remaining"])
            db.execute(f"UPDATE {table} SET remaining=remaining-? WHERE id=?", (part, row["id"]))
            db.execute(
                f"INSERT INTO {holds}(owner,operation,{column},amount) VALUES(?,?,?,?)",
                (owner, operation, row["id"], part),
            )
            amount -= part
            if amount == 0:
                return
        if amount:
            raise CloudError("funding_conflict", 409)

    def settle(self, owner, operation, cost, *, success, uncertain=False, review_required=False, review_reason=None):
        with self.transaction() as db:
            op = db.execute(
                "SELECT * FROM operations WHERE owner=? AND id=?", (owner, operation)
            ).fetchone()
            if not op:
                raise CloudError("generation_not_reserved", 409)
            if op["state"] != "pending":
                return dict(op)
            if type(cost) is not int or cost < 0:
                raise CloudError("invalid_provider_cost", 503)
            if uncertain:
                cost = max(cost, op["max_cost"])
            if review_required and review_reason in {"missing_cost", "missing_usage"} and cost <= op["max_cost"]:
                # Retain the entire bound instead of treating a missing invoice as zero.
                db.execute("INSERT INTO bounded_cost_retentions VALUES(?,?,?,?,?,?)",
                           (owner, operation, review_reason, cost, op["max_cost"], time.time()))
                cost = op["max_cost"]
                success = False
                review_required = False
            if review_required:
                success = False
            overrun = max(0, cost - op["max_cost"])
            if overrun:
                success = False
                db.execute("INSERT INTO budget_debt VALUES(?,?)", (
                    "provider-overrun:" + fingerprint({"owner": owner, "operation": operation}), overrun))
            charged = (
                max(1, (cost * op["markup"] + 99_999) // 100_000)
                if success and op["route"] in ROUTES and ROUTES[op["route"]].payer == "operator"
                else 0
            )
            if charged > op["max_credits"]:
                raise CloudError("credit_bound_exceeded", 503)
            if db.execute("SELECT 1 FROM credit_holds WHERE owner=? AND operation=?", (owner, operation)).fetchone():
                # Finish pre-upgrade reservations using their original held lots.
                self._release(db, "credit_lots", "credit_holds", "lot", owner, operation, charged)
            elif charged:
                remaining = charged
                for lot in db.execute("SELECT id,remaining FROM credit_lots WHERE owner=? AND expires>? "
                                      "AND remaining>0 ORDER BY expires,id", (owner, time.time())).fetchall():
                    used = min(remaining, lot["remaining"])
                    db.execute("UPDATE credit_lots SET remaining=remaining-? WHERE id=?", (used, lot["id"]))
                    remaining -= used
                    if not remaining:
                        break
                if remaining:
                    # Expiry/revocation during generation must not lose the settled charge.
                    db.execute("INSERT INTO credit_debts VALUES(?,?,?)", (owner, operation, remaining))
            self._release(db, "funds", "fund_holds", "fund", owner, operation, min(cost, op["max_cost"]))
            db.execute(
                "UPDATE operations SET state=?,charged_credits=?,actual_cost=?,review_required=? WHERE owner=? AND id=?",
                ("completed" if success else "failed", charged, cost, int(review_required), owner, operation),
            )
            return {
                "charged_credits": charged,
                "actual_cost": cost,
                "state": "completed" if success else "failed",
            }

    def _release(self, db, table, holds, column, owner, operation, spent):
        rows = db.execute(
            f"SELECT {column},amount FROM {holds} WHERE owner=? AND operation=? ORDER BY rowid",
            (owner, operation),
        ).fetchall()
        for row in rows:
            used = min(spent, row["amount"])
            spent -= used
            if table == "funds" and row[column].startswith("paid:"):
                source = row[column][5:]
                receipt = db.execute(
                    "SELECT revoked FROM receipts WHERE id=?", (source,)
                ).fetchone()
                if receipt and receipt[0] and used:
                    db.execute(
                        "INSERT INTO budget_debt VALUES(?,?) ON CONFLICT(source) DO UPDATE SET amount=amount+excluded.amount",
                        (source, used),
                    )
            db.execute(
                f"UPDATE {table} SET remaining=remaining+? WHERE id=? AND expires>?",
                (row["amount"] - used, row[column], time.time()),
            )
        db.execute(f"DELETE FROM {holds} WHERE owner=? AND operation=?", (owner, operation))

    def recover(self):
        with self.transaction() as db:
            pending = [
                dict(r) for r in db.execute("SELECT * FROM operations WHERE state='pending'")
            ]
        for op in pending:
            path = self.config.root / "tenants" / op["owner"] / "data.db"
            result = None
            completed = False
            if path.is_file():
                with sqlite3.connect(path) as db:
                    row = db.execute(
                        "SELECT status,result_json FROM generations WHERE generation_id=?",
                        (op["id"],),
                    ).fetchone()
                    if row and row[0] in {"completed", "failed", "cancelled"}:
                        result = json.loads(row[1] or "{}").get("cloud_accounting")
                        completed = row[0] == "completed"
            if (isinstance(result, dict) and type(result.get("cost")) is int and result["cost"] >= 0
                    and type(result.get("review_required", False)) is bool):
                self.settle(op["owner"], op["id"], result["cost"], success=completed,
                            review_required=result.get("review_required", False), review_reason=result.get("review_reason"))
            else:
                # A crash is not proof the provider did no work.
                self.settle(op["owner"], op["id"], op["max_cost"], success=False,
                            uncertain=True, review_required=True)

    def public_wallet(self, owner):
        account = self.account(owner)
        with self.transaction() as db:
            lots = [
                dict(r)
                for r in db.execute(
                    "SELECT remaining,expires,kind FROM credit_lots WHERE owner=? AND expires>? ORDER BY expires",
                    (owner, time.time()),
                )
            ]
            used = db.execute("SELECT COALESCE(SUM(charged_credits),0) FROM operations WHERE owner=?", (owner,)).fetchone()[0]
            reserved = db.execute("SELECT COALESCE(SUM(amount),0) FROM credit_holds WHERE owner=?", (owner,)).fetchone()[0]
            balance = self.balance(owner, db)
            debt = db.execute("SELECT COALESCE(SUM(amount),0) FROM credit_debts WHERE owner=?", (owner,)).fetchone()[0]
            history = [dict(row) for row in db.execute(
                "SELECT state,created,charged_credits,max_credits FROM operations WHERE owner=? "
                "AND route!='safety' ORDER BY created DESC LIMIT 20", (owner,))]
        return {
            "plan": account["plan"],
            "credits": balance,
            "uncovered_credits": debt,
            "credit_reservation": False,
            "lots": lots,
            "credits_per_usd": 10_000,
            "tariff_version": TARIFF.version,
            "used_credits": used,
            "reserved_credits": reserved,
            "usage": history,
        }

    def receipt(self, owner, source, sku, net_nano, expires, *, event_id, event_hash, terms=None):
        """Apply verified settled revenue and back the snapshotted credit liability.

        Stripe fee/tax/net values are retrieved from expanded balance transactions.
        Unsettled or incomplete payment data never funds additional generation.
        """
        from .contracts import purchase_terms

        terms = terms or purchase_terms(sku, subscriber=self.account(owner)["plan"] != "free")
        if (terms.get("sku") != sku or type(terms.get("credits")) is not int
                or terms["credits"] <= 0 or terms.get("days") not in {30, 60, 180}):
            raise CloudError("invalid_purchase_terms")
        credits = terms["credits"]
        credit_expires = expires if terms.get('version') == 'legacy' and sku in PLANS else time.time() + terms["days"] * 86400
        funded = (credits * 100_000 + TARIFF.markup - 1) // TARIFF.markup
        with self.transaction() as db:
            prior = db.execute("SELECT hash FROM webhook_events WHERE id=?", (event_id,)).fetchone()
            if prior:
                if prior[0] != event_hash:
                    raise CloudError("webhook_conflict", 409)
                return
            if type(net_nano) is not int or net_nano <= 0 or expires <= time.time():
                raise CloudError("payment_not_settled", 409)
            if db.execute("SELECT 1 FROM receipt_revocations WHERE source=?", (source,)).fetchone():
                db.execute(
                    "INSERT OR IGNORE INTO webhook_events VALUES(?,?,?)",
                    (event_id, event_hash, time.time()),
                )
                return
            if not db.execute("SELECT 1 FROM receipts WHERE id=?", (source,)).fetchone():
                if net_nano < funded:
                    raise CloudError("payment_funding_insufficient", 409)
                db.execute(
                    "INSERT INTO receipts VALUES(?,?,?,?,?,0)",
                    (source, owner, sku, net_nano, expires),
                )
                db.execute(
                    "INSERT INTO funds VALUES(?,?,?,'paid')",
                    ("paid:" + source, funded, max(expires, credit_expires)),
                )
                db.execute("INSERT INTO receipt_terms VALUES(?,?,?)",
                           (source, json.dumps(terms, sort_keys=True), funded))
                self.grant(
                    owner, credits, credit_expires, "monthly" if sku in PLANS else "purchase", source, db
                )
            db.execute(
                "INSERT INTO webhook_events VALUES(?,?,?)", (event_id, event_hash, time.time())
            )

    def revoke_receipt(self, source, *, suspend=False, owner=None):
        with self.transaction() as db:
            row = db.execute(
                "SELECT owner,net_nano,revoked FROM receipts WHERE id=?", (source,)
            ).fetchone()
            if not row:
                if not owner:
                    raise CloudError("payment_not_processed", 409)
                db.execute(
                    "INSERT OR REPLACE INTO receipt_revocations VALUES(?,?,?)",
                    (source, owner, int(suspend)),
                )
                if suspend:
                    db.execute("UPDATE accounts SET suspended=1 WHERE id=?", (owner,))
                return
            db.execute(
                "INSERT OR REPLACE INTO receipt_revocations VALUES(?,?,?)",
                (source, row["owner"], int(suspend)),
            )
            if not row["revoked"]:
                remaining = db.execute(
                    "SELECT remaining FROM funds WHERE id=?", ("paid:" + source,)
                ).fetchone()[0]
                held = db.execute(
                    "SELECT COALESCE(SUM(amount),0) FROM fund_holds WHERE fund=?",
                    ("paid:" + source,),
                ).fetchone()[0]
                terms = db.execute("SELECT funded FROM receipt_terms WHERE id=?", (source,)).fetchone()
                spent = (terms[0] if terms else row["net_nano"] // 5) - remaining - held
                # Revenue clawbacks cannot erase API bills already incurred.
                # Ring-fence that cost against remaining subsidy/paid funding.
                db.execute("INSERT OR IGNORE INTO budget_debt VALUES(?,?)", (source, spent))
            db.execute("UPDATE receipts SET revoked=1 WHERE id=?", (source,))
            db.execute("UPDATE credit_lots SET remaining=0,expires=0 WHERE source=?", (source,))
            db.execute("UPDATE funds SET remaining=0,expires=0 WHERE id=?", ("paid:" + source,))
            if suspend:
                db.execute("UPDATE accounts SET suspended=1 WHERE id=?", (row[0],))

    def reserve_safety(self, owner, operation, cost):
        """Free CRUD screening uses operator funds, never the user's wallet."""
        from .router import safety_tariff
        version = safety_tariff(self.config).version
        request_hash = digest(operation)
        q = self.quote(owner, request_hash, 0, cost, "safety", provider_tariff=version)
        self.reserve(owner, operation, request_hash, q, 0, provider_tariff=version)
