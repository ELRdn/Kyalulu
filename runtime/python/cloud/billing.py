"""Stripe's signed events trigger retrieval of current settled payment state."""

import hashlib
import hmac
import json
import time
import asyncio
import httpx
from .contracts import PLANS, PACKS
from .store import CloudError, fingerprint


class StripeBilling:
    def __init__(self, store, backups, transport=None):
        self.store, self.config, self.backups = store, store.config, backups
        self.transport = transport

    async def call(self, path, *, method="GET", data=None, params=None, key=None):
        if not self.config.stripe_key:
            raise CloudError("billing_not_configured", 503)
        headers = {"Authorization": "Bearer " + self.config.stripe_key}
        if key:
            headers["Idempotency-Key"] = key
        async with httpx.AsyncClient(timeout=20, transport=self.transport) as client:
            try:
                response = await client.request(
                    method,
                    "https://api.stripe.com/v1/" + path,
                    headers=headers,
                    data=data,
                    params=params,
                )
                response.raise_for_status()
                result = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise CloudError("billing_unavailable", 503) from exc
        if not isinstance(result, dict):
            raise CloudError("invalid_billing_response", 503)
        return result

    async def checkout(self, owner, sku, request_id):
        if not self.config.billing_enabled or not self.config.legal_approved:
            raise CloudError("billing_awaiting_acceptance", 503)
        from .router import backend_block

        error = backend_block(self.config)
        if error:
            raise CloudError(error, 503)
        prices = dict(self.config.stripe_prices)
        if sku not in {"plus", "pro", *PACKS} or not prices.get(sku):
            raise CloudError("invalid_billing_sku")
        self.backups.admission(
            owner, PLANS[sku] if sku in PLANS else self.store.entitlements(owner),
            hold_until=time.time() + 35 * 60,
        )
        account = self.store.account(owner)
        if sku in PLANS and account["plan"] != "free":
            raise CloudError("manage_existing_subscription_in_portal", 409)
        data = {
            "mode": "subscription" if sku in PLANS else "payment",
            "line_items[0][price]": prices[sku],
            "line_items[0][quantity]": "1",
            "client_reference_id": owner,
            "metadata[owner]": owner,
            "metadata[sku]": sku,
            "billing_address_collection": "required",
            "success_url": self.config.origin + "/#/profile?checkout=success",
            "cancel_url": self.config.origin + "/#/profile?checkout=cancelled",
            "consent_collection[terms_of_service]": "required",
            "expires_at": str(int(time.time() + 30 * 60)),
        }
        if account["customer"]:
            data["customer"] = account["customer"]
        else:
            customer = await self.call(
                "customers", method="POST", data={"metadata[owner]": owner}, key="customer:" + owner
            )
            with self.store.transaction() as db:
                db.execute("UPDATE accounts SET customer=? WHERE id=?", (customer["id"], owner))
            data["customer"] = customer["id"]
        if sku in PLANS:
            data["subscription_data[metadata][owner]"] = owner
        else:
            data["payment_intent_data[metadata][sku]"] = sku
        session = await self.call(
            "checkout/sessions",
            method="POST",
            data=data,
            key="checkout:" + owner + ":" + request_id,
        )
        url = session.get("url", "")
        if not isinstance(url, str) or not url.startswith("https://checkout.stripe.com/"):
            raise CloudError("invalid_checkout_url", 503)
        return {"url": url}

    async def portal(self, owner):
        customer = self.store.account(owner)["customer"]
        if not customer:
            raise CloudError("billing_customer_missing", 409)
        session = await self.call(
            "billing_portal/sessions",
            method="POST",
            data={"customer": customer, "return_url": self.config.origin + "/#/profile"},
        )
        url = session.get("url", "")
        if not isinstance(url, str) or not url.startswith("https://billing.stripe.com/"):
            raise CloudError("invalid_portal_url", 503)
        return {"url": url}

    def verify(self, raw, signature):
        if not self.config.stripe_webhook_secret:
            raise CloudError("billing_webhook_not_configured", 503)
        try:
            pairs = [p.split("=", 1) for p in signature.split(",")]
            timestamp = next(v for k, v in pairs if k == "t")
            if abs(time.time() - int(timestamp)) > 300:
                raise ValueError()
            expected = hmac.new(
                self.config.stripe_webhook_secret.encode(),
                timestamp.encode() + b"." + raw,
                hashlib.sha256,
            ).hexdigest()
            if not any(k == "v1" and hmac.compare_digest(v, expected) for k, v in pairs):
                raise ValueError()
            event = json.loads(raw)
            if not isinstance(event.get("id"), str) or not event["id"].startswith("evt_"):
                raise ValueError()
            return event
        except (ValueError, KeyError, StopIteration, TypeError) as exc:
            raise CloudError("invalid_webhook_signature", 400) from exc

    def owner_for(self, customer):
        with self.store.transaction() as db:
            row = db.execute("SELECT id FROM accounts WHERE customer=?", (customer,)).fetchone()
        if not row:
            raise CloudError("billing_customer_unknown", 409)
        return row[0]

    async def subscription(self, subscription_id):
        sub = await self.call("subscriptions/" + subscription_id)
        owner = self.owner_for(sub["customer"])
        items = sub.get("items", {}).get("data", [])
        reverse = {price: sku for sku, price in self.config.stripe_prices if price}
        sku = reverse.get(items[0].get("price", {}).get("id")) if len(items) == 1 else None
        until = items[0].get("current_period_end", sub.get("current_period_end", 0)) if items else 0
        active = (
            sub.get("status") in {"active", "trialing"}
            and sku in {"plus", "pro"}
            and until > time.time()
        )
        with self.store.transaction() as db:
            funded = db.execute(
                "SELECT 1 FROM receipts WHERE owner=? AND sku=? AND expires=? AND revoked=0",
                (owner, sku, until),
            ).fetchone()
            active = active and bool(funded)
            db.execute(
                "INSERT OR IGNORE INTO billing_subscriptions VALUES(?,?)", (subscription_id, owner)
            )
            db.execute(
                "UPDATE accounts SET plan=?,plan_until=? WHERE id=?",
                (sku if active else "free", until if active else 0, owner),
            )
        return owner

    async def webhook(self, raw, signature):
        event = self.verify(raw, signature)
        event_hash = fingerprint(event)
        with self.store.transaction() as db:
            old = db.execute("SELECT hash FROM billing_jobs WHERE id=?", (event["id"],)).fetchone()
            if old and old[0] != event_hash:
                raise CloudError("webhook_conflict", 409)
            if not old:
                if (
                    db.execute(
                        "SELECT COUNT(*) FROM billing_jobs WHERE state='pending'"
                    ).fetchone()[0]
                    >= 1000
                ):
                    raise CloudError("billing_queue_full", 503)
                db.execute(
                    "INSERT INTO billing_jobs(id,hash,payload,due) VALUES(?,?,?,?)",
                    (event["id"], event_hash, self.store.encrypt(json.dumps(event)), time.time()),
                )
        return {"received": True}

    async def work_once(self):
        with self.store.transaction() as db:
            row = db.execute(
                "SELECT * FROM billing_jobs WHERE state='pending' AND due<=? ORDER BY due LIMIT 1",
                (time.time(),),
            ).fetchone()
        if not row:
            return False
        try:
            await self.process(json.loads(self.store.decrypt(row["payload"])), row["hash"])
            with self.store.transaction() as db:
                db.execute(
                    "UPDATE billing_jobs SET state='completed',payload='',error=NULL WHERE id=?",
                    (row["id"],),
                )
        except Exception as exc:
            with self.store.transaction() as db:
                db.execute(
                    "UPDATE billing_jobs SET attempts=attempts+1,due=?,state=?,error=? WHERE id=?",
                    (
                        time.time() + min(3600, 60 * 2 ** min(row["attempts"], 6)),
                        "manual_review" if row["attempts"] >= 168 else "pending",
                        exc.code if isinstance(exc, CloudError) else "billing_processing_failed",
                        row["id"],
                    ),
                )
        return True

    async def worker(self):
        while True:
            if not await self.work_once():
                await asyncio.sleep(30)

    async def process(self, event, event_hash):
        with self.store.transaction() as db:
            prior = db.execute(
                "SELECT hash FROM webhook_events WHERE id=?", (event["id"],)
            ).fetchone()
            if prior:
                if prior[0] != event_hash:
                    raise CloudError("webhook_conflict", 409)
        obj, kind = event["data"]["object"], event["type"]
        if kind.startswith("customer.subscription."):
            await self.subscription(obj["id"])
        elif kind in {
            "invoice.paid",
            "checkout.session.completed",
            "checkout.session.async_payment_succeeded",
        }:
            if kind == "invoice.paid":
                invoice = await self.call(
                    "invoices/" + obj["id"], params={"expand[]": "lines.data.price"}
                )
                if invoice.get("status") != "paid" or not invoice.get("paid"):
                    raise CloudError("payment_not_settled", 409)
                subscription_id = invoice.get("subscription") or invoice.get("parent", {}).get(
                    "subscription_details", {}
                ).get("subscription")
                await self.subscription(subscription_id)
                line = invoice.get("lines", {}).get("data", [])
                # Proration/upgrades do not create another full monthly grant.
                if invoice.get("billing_reason") not in {
                    "subscription_create",
                    "subscription_cycle",
                }:
                    return {"received": True}
                if len(line) != 1:
                    raise CloudError("invoice_manual_review_required", 409)
                price_id = line[0].get("price", {}).get("id") or line[0].get("pricing", {}).get(
                    "price_details", {}
                ).get("price")
                sku = dict((v, k) for k, v in self.config.stripe_prices).get(price_id)
                expires = line[0]["period"]["end"]
                intent_id = invoice.get("payment_intent")
                if not intent_id:
                    payments = await self.call(
                        "invoice_payments", params={"invoice": invoice["id"], "limit": 10}
                    )
                    settled = [
                        p
                        for p in payments.get("data", [])
                        if p.get("status") == "paid"
                        and p.get("payment", {}).get("type") == "payment_intent"
                    ]
                    if len(settled) != 1:
                        raise CloudError("invoice_payment_manual_review_required", 409)
                    intent_id = settled[0]["payment"]["payment_intent"]
                    if isinstance(intent_id, dict):
                        intent_id = intent_id.get("id")
            else:
                session = await self.call("checkout/sessions/" + obj["id"])
                if session.get("mode") == "subscription":
                    return {"received": True}  # invoice.paid is the only monthly grant source
                if session.get("payment_status") != "paid":
                    raise CloudError("payment_not_settled", 409)
                sku = session.get("metadata", {}).get("sku")
                if sku not in PACKS:
                    raise CloudError("invalid_billing_sku")
                expires = time.time() + 180 * 86400
                intent_id = session["payment_intent"]
            intent = await self.call(
                "payment_intents/" + intent_id,
                params={"expand[]": "latest_charge.balance_transaction"},
            )
            charge = intent.get("latest_charge")
            if not isinstance(charge, dict):
                raise CloudError("payment_not_settled", 409)
            country = charge.get("billing_details", {}).get("address", {}).get("country")
            if country not in {"JP", "US"}:
                raise CloudError("unsupported_sales_country", 409)
            balance = charge.get("balance_transaction")
            if (
                intent.get("status") != "succeeded"
                or charge.get("refunded")
                or charge.get("disputed")
                or not isinstance(balance, dict)
                or balance.get("currency") != "usd"
                or balance.get("status") != "available"
            ):
                raise CloudError("payment_not_settled", 409)
            owner = self.owner_for(intent["customer"])
            # Automatic-tax selling stays disabled pending accountant/provider acceptance.
            # This launch uses tax-exclusive configured prices; tax liability must be
            # subtracted through the approved tax reserve below before accepting sales.
            reserve = int(__import__("os").getenv("KYALULU_TAX_RESERVE_PERCENT", "30"))
            if not 0 <= reserve <= 100:
                raise CloudError("tax_reserve_invalid", 503)
            net = balance["net"] * 10_000_000 * (100 - reserve) // 100
            if sku in {"plus", "pro"}:
                self.backups.admission(owner, PLANS[sku],
                    hold_until=expires + PLANS[sku].restore_days * 86400)
            self.store.receipt(
                owner, intent_id, sku, net, expires, event_id=event["id"], event_hash=event_hash
            )
            if kind == "invoice.paid":
                await self.subscription(subscription_id)
            return {"received": True}
        elif kind in {"charge.refunded", "charge.dispute.created", "charge.dispute.closed"}:
            charge_id = obj.get("charge") if kind.startswith("charge.dispute") else obj["id"]
            charge = await self.call("charges/" + charge_id)
            if charge.get("refunded") or charge.get("amount_refunded", 0) or charge.get("disputed"):
                self.store.revoke_receipt(
                    charge["payment_intent"],
                    suspend=bool(charge.get("disputed")),
                    owner=self.owner_for(charge["customer"]),
                )
                owner = self.owner_for(charge["customer"])
                with self.store.transaction() as db:
                    subscriptions = [
                        r[0]
                        for r in db.execute(
                            "SELECT id FROM billing_subscriptions WHERE owner=?", (owner,)
                        )
                    ]
                for subscription_id in subscriptions:
                    await self.subscription(subscription_id)
        with self.store.transaction() as db:
            db.execute(
                "INSERT OR IGNORE INTO webhook_events VALUES(?,?,?)",
                (event["id"], event_hash, time.time()),
            )
        return {"received": True}
