"""Encrypted account preferences shared by authenticated Web devices."""

import json
import unicodedata

from .store import CloudError


class AccountProfile:
    def __init__(self, store):
        self.store = store

    def _read(self, db, owner):
        row = db.execute("SELECT value FROM secrets WHERE owner=? AND kind='account-profile'",
                         (owner,)).fetchone()
        if row:
            return json.loads(self.store.decrypt(row[0]))
        identity = db.execute("SELECT value FROM secrets WHERE owner=? AND kind='identity'",
                              (owner,)).fetchone()
        identity = json.loads(self.store.decrypt(identity[0])) if identity else {}
        name = identity.get("display_name")
        name = name.strip()[:80] if isinstance(name, str) else ""
        return {"revision": 0, "display_name": name or "Traveler",
                "saved_characters": [], "pinned_sessions": []}

    def read(self, owner):
        with self.store.transaction() as db:
            return self._read(db, owner)

    def update(self, owner, body):
        if (not isinstance(body, dict) or set(body) != {"revision", "change"}
                or type(body["revision"]) is not int or body["revision"] < 0
                or not isinstance(body["change"], dict) or len(body["change"]) != 1):
            raise CloudError("invalid_account_profile")
        key, value = next(iter(body["change"].items()))
        if not isinstance(value, str):
            raise CloudError("invalid_account_profile")
        if key == "display_name":
            value = unicodedata.normalize("NFC", value).strip()
            if (not value or len(value) > 80
                    or any(unicodedata.category(c) in {"Cc", "Cs"} for c in value)):
                raise CloudError("invalid_display_name")
        elif key in {"toggle_saved", "toggle_pin"}:
            if not value or len(value) > 200 or any(unicodedata.category(c).startswith("C") for c in value):
                raise CloudError("invalid_account_profile")
        else:
            raise CloudError("invalid_account_profile")
        with self.store.transaction() as db:
            if not db.execute("SELECT 1 FROM accounts WHERE id=? AND suspended=0", (owner,)).fetchone():
                raise CloudError("account_unavailable", 403)
            profile = self._read(db, owner)
            if body["revision"] != profile["revision"]:
                raise CloudError("profile_conflict", 409)
            if key == "display_name":
                profile[key] = value
            else:
                field = "saved_characters" if key == "toggle_saved" else "pinned_sessions"
                items = profile[field]
                if value in items:
                    profile[field] = [item for item in items if item != value]
                elif len(items) >= 500:
                    raise CloudError("profile_item_limit")
                else:
                    profile[field] = [value, *items]
            profile["revision"] += 1
            db.execute("INSERT INTO secrets VALUES(?,'account-profile',?) ON CONFLICT(owner,kind) "
                       "DO UPDATE SET value=excluded.value",
                       (owner, self.store.encrypt(json.dumps(profile, ensure_ascii=False))))
            return profile
