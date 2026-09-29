"""SQLite routing identities and single-use enrollment tickets."""

import hashlib
import secrets
import sqlite3
import time
import uuid
from contextlib import closing, contextmanager
from pathlib import Path

from fastapi import HTTPException


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def uid() -> str:
    return str(uuid.uuid4())


class Store:
    def __init__(self, path: str):
        self.path = str(Path(path))
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS devices(
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id),
                    host TEXT, role TEXT NOT NULL CHECK(role IN ('host','client')),
                    name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
                    expires REAL, revoked INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS tickets(
                    id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE,
                    kind TEXT NOT NULL, owner TEXT, host TEXT, expires REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS devices_owner ON devices(owner,role);
                CREATE INDEX IF NOT EXISTS tickets_host ON tickets(host);
            """)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    @contextmanager
    def transaction(self):
        db = self.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM tickets WHERE expires<=?", (time.time(),))
            db.execute("DELETE FROM devices WHERE role='client' AND expires<=?", (time.time(),))
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def auth(db, token, role=None):
        row = db.execute(
            "SELECT * FROM devices WHERE hash=? AND revoked=0 AND (expires IS NULL OR expires>?)",
            (digest(token), time.time()),
        ).fetchone()
        if not row:
            raise HTTPException(401, "invalid credentials")
        if role and row["role"] != role:
            raise HTTPException(403, "wrong role")
        return dict(row)

    def authenticate(self, token, role=None):
        with self.transaction() as db:
            return self.auth(db, token, role)

    def alive(self, device):
        with self.transaction() as db:
            return (
                db.execute("SELECT 1 FROM devices WHERE id=? AND revoked=0", (device,)).fetchone()
                is not None
            )

    def invite(self, ttl=300, owner=None):
        if type(ttl) is not int or not 1 <= ttl <= 300:
            raise ValueError("TTL must be 1..300")
        with self.transaction() as db:
            if owner and not db.execute("SELECT 1 FROM owners WHERE id=?", (owner,)).fetchone():
                raise ValueError("unknown owner")
            if db.execute("SELECT count(*) FROM tickets WHERE kind='invite'").fetchone()[0] >= 100:
                raise ValueError("invitation limit")
            token = secrets.token_urlsafe(32)
            db.execute(
                "INSERT INTO tickets VALUES(?,?,?,?,?,?)",
                (uid(), digest(token), "invite", owner, None, time.time() + ttl),
            )
            return token

    def redeem_invite(self, token, name):
        with self.transaction() as db:
            ticket = db.execute(
                "SELECT * FROM tickets WHERE hash=? AND kind='invite'", (digest(token),)
            ).fetchone()
            if not ticket:
                raise HTTPException(401, "invalid invitation")
            owner = ticket["owner"]
            if owner is None:
                if db.execute("SELECT count(*) FROM owners").fetchone()[0] >= 10:
                    raise HTTPException(409, "owner quota")
                owner = uid()
                db.execute("INSERT INTO owners VALUES(?)", (owner,))
            if (
                db.execute(
                    "SELECT count(*) FROM devices WHERE owner=? AND role='host' AND revoked=0",
                    (owner,),
                ).fetchone()[0]
                >= 2
            ):
                raise HTTPException(409, "host quota")
            host, secret = uid(), secrets.token_urlsafe(32)
            db.execute(
                "INSERT INTO devices(id,owner,role,name,hash) VALUES(?,?,?,?,?)",
                (host, owner, "host", name, digest(secret)),
            )
            db.execute("DELETE FROM tickets WHERE id=?", (ticket["id"],))
            return dict(owner_id=owner, host_id=host, host_token=secret)

    def pairing(self, token, ttl):
        with self.transaction() as db:
            host = self.auth(db, token, "host")
            if (
                db.execute("SELECT count(*) FROM tickets WHERE host=?", (host["id"],)).fetchone()[0]
                >= 10
            ):
                raise HTTPException(409, "ticket quota")
            ident, secret, expires = uid(), secrets.token_urlsafe(32), time.time() + ttl
            db.execute(
                "INSERT INTO tickets VALUES(?,?,?,?,?,?)",
                (ident, digest(secret), "pair", host["owner"], host["id"], expires),
            )
            return dict(pairing_id=ident, token=secret, expires_at=expires)

    def redeem_pairing(self, ident, token, name):
        with self.transaction() as db:
            ticket = db.execute(
                "SELECT * FROM tickets WHERE id=? AND hash=? AND kind='pair'",
                (ident, digest(token)),
            ).fetchone()
            if (
                not ticket
                or not db.execute(
                    "SELECT 1 FROM devices WHERE id=? AND revoked=0", (ticket["host"],)
                ).fetchone()
            ):
                raise HTTPException(401, "invalid ticket")
            if (
                db.execute(
                    "SELECT count(*) FROM devices WHERE owner=? AND role='client' "
                    "AND revoked=0 AND expires IS NOT NULL",
                    (ticket["owner"],),
                ).fetchone()[0]
                >= 5
            ):
                raise HTTPException(409, "pending quota")
            device, secret, expires = uid(), secrets.token_urlsafe(32), time.time() + 300
            db.execute(
                "INSERT INTO devices(id,owner,host,role,name,hash,expires) VALUES(?,?,?,?,?,?,?)",
                (device, ticket["owner"], ticket["host"], "client", name, digest(secret), expires),
            )
            db.execute("DELETE FROM tickets WHERE id=?", (ident,))
            return dict(
                owner_id=ticket["owner"],
                host_id=ticket["host"],
                device_id=device,
                device_token=secret,
                pending=True,
                expires_at=expires,
            )

    def approve(self, token, ident):
        with self.transaction() as db:
            host = self.auth(db, token, "host")
            row = db.execute(
                "SELECT * FROM devices WHERE id=? AND host=? AND role='client' AND revoked=0",
                (ident, host["id"]),
            ).fetchone()
            if not row:
                raise HTTPException(404, "unknown device")
            if row["expires"] is not None:
                if (
                    db.execute(
                        "SELECT count(*) FROM devices WHERE owner=? AND role='client' "
                        "AND revoked=0 AND expires IS NULL",
                        (host["owner"],),
                    ).fetchone()[0]
                    >= 5
                ):
                    raise HTTPException(409, "client quota")
                db.execute("UPDATE devices SET expires=NULL WHERE id=?", (ident,))
            return dict(device_id=ident, pending=False)

    def hosts(self, token):
        with self.transaction() as db:
            device = self.auth(db, token)
            rows = db.execute(
                "SELECT id,name FROM devices WHERE owner=? AND role='host' AND revoked=0",
                (device["owner"],),
            ).fetchall()
            return [
                dict(host_id=r["id"], name=r["name"])
                for r in rows
                if device["role"] == "host" or r["id"] == device["host"]
            ]

    def revoke(self, token, ident):
        with self.transaction() as db:
            host = self.auth(db, token, "host")
            row = db.execute(
                "SELECT 1 FROM devices WHERE id=? AND owner=?", (ident, host["owner"])
            ).fetchone()
            if not row:
                raise HTTPException(404, "unknown device")
            ids = [
                r[0]
                for r in db.execute("SELECT id FROM devices WHERE id=? OR host=?", (ident, ident))
            ]
            db.execute("UPDATE devices SET revoked=1 WHERE id=? OR host=?", (ident, ident))
            db.execute("DELETE FROM tickets WHERE host=?", (ident,))
            return ids
