"""Opt-in shared works. Only explicit, screened public snapshots enter this DB."""
import hashlib
import json
import sqlite3
import time
from contextlib import contextmanager, closing
from uuid import uuid4
from .store import CloudError

PUBLIC_KEYS = {"name", "description", "personality", "scenario", "first_mes",
               "mes_example", "alternate_greetings", "tags", "creator_notes"}


def public_document(document):
    """Never publish profiles, original files, histories, memories or private asset URLs."""
    raw = document.model_dump(mode="json") if hasattr(document, "model_dump") else document
    if raw.get("kind") != "character" or raw.get("nsfw"):
        raise CloudError("public_work_must_be_sfw_character", 403)
    result = {"schema_version": 1, "kind": "character", "name": raw["name"],
              "nsfw": False, "speaking_style": raw.get("speaking_style", ""),
              "data": {k: v for k, v in raw.get("data", {}).items() if k in PUBLIC_KEYS}}
    if len(json.dumps(result, ensure_ascii=False).encode()) > 40_000:
        raise CloudError("public_work_too_large", 413)
    return result


class Community:
    def __init__(self, path):
        self.path = path

    @contextmanager
    def db(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=15)) as db, db:
            db.row_factory = sqlite3.Row
            db.executescript("""
            CREATE TABLE IF NOT EXISTS authors(id TEXT PRIMARY KEY,owner TEXT UNIQUE,name TEXT);
            CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY,owner TEXT,item TEXT,revision INTEGER,
                document TEXT,created REAL,UNIQUE(owner,item,revision));
            CREATE TABLE IF NOT EXISTS reactions(owner TEXT,work TEXT,kind TEXT,PRIMARY KEY(owner,work,kind));
            CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,owner TEXT,work TEXT,text TEXT,created REAL);
            CREATE TABLE IF NOT EXISTS follows(owner TEXT,author TEXT,PRIMARY KEY(owner,author));
            CREATE TABLE IF NOT EXISTS blocks(owner TEXT,author TEXT,PRIMARY KEY(owner,author));
            CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,owner TEXT,work TEXT,reason TEXT,created REAL);
            """)
            if "request_id" not in {r[1] for r in db.execute("PRAGMA table_info(comments)")}:
                db.execute("ALTER TABLE comments ADD COLUMN request_id TEXT")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS comment_requests ON comments(owner,request_id) WHERE request_id IS NOT NULL")
            yield db

    @staticmethod
    def author_id(owner):
        return hashlib.sha256(("kyalulu-author:" + owner).encode()).hexdigest()[:24]

    def _visible(self, db, owner, work_id):
        row = db.execute("SELECT w.*,a.id author_id,a.name author_name FROM works w JOIN authors a ON a.owner=w.owner WHERE w.id=?", (work_id,)).fetchone()
        if not row or db.execute("SELECT 1 FROM blocks WHERE (owner=? AND author=?) OR (owner=? AND author=?)", (owner,row["author_id"],row["owner"],self.author_id(owner))).fetchone():
            raise CloudError("public_work_not_found", 404)
        return row

    def _view(self, db, row, owner):
        doc = json.loads(row["document"])
        counts = {r[0]: r[1] for r in db.execute("SELECT kind,COUNT(*) FROM reactions WHERE work=? GROUP BY kind", (row["id"],))}
        mine = [r[0] for r in db.execute("SELECT kind FROM reactions WHERE work=? AND owner=?", (row["id"],owner))]
        tags = doc["data"].get("tags", [])
        return {"id":row["id"],"name":doc["name"],"description":doc["data"].get("description", ""),
            "tags":tags if isinstance(tags,list) else [],"revision":row["revision"],
            "author_id":row["author_id"],"author_name":row["author_name"],
            "likes":counts.get("like",0),"saves":counts.get("save",0),
            "comments":db.execute("SELECT COUNT(*) FROM comments WHERE work=?",(row["id"],)).fetchone()[0],
            "document":doc,"reactions":mine,"owned":row["owner"]==owner,
            "following":bool(db.execute("SELECT 1 FROM follows WHERE owner=? AND author=?",(owner,row["author_id"])).fetchone())}

    def publish(self, owner, name, item, revision, document):
        snapshot = public_document(document)
        with self.db() as db:
            existing = db.execute("SELECT id FROM works WHERE owner=? AND item=? AND revision=?",(owner,item,revision)).fetchone()
            if not existing and db.execute("SELECT COUNT(*) FROM works WHERE owner=?",(owner,)).fetchone()[0] >= 100:
                raise CloudError("public_work_limit", 429)
            author = self.author_id(owner)
            db.execute("INSERT INTO authors VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET name=excluded.name",(author,owner,name[:80]))
            work = existing[0] if existing else uuid4().hex
            if not existing:
                db.execute("INSERT INTO works VALUES(?,?,?,?,?,?)",(work,owner,item,revision,json.dumps(snapshot,ensure_ascii=False),time.time()))
            return self._view(db,self._visible(db,owner,work),owner)

    def publication(self, owner, item, revision):
        with self.db() as db:
            row = db.execute("SELECT id FROM works WHERE owner=? AND item=? AND revision=?", (owner,item,revision)).fetchone()
            return self._view(db,self._visible(db,owner,row[0]),owner) if row else None

    def list(self, owner, q="", tag=""):
        with self.db() as db:
            works = []
            for row in db.execute("SELECT id FROM works ORDER BY created DESC LIMIT 500").fetchall():
                try:
                    work = self._view(db,self._visible(db,owner,row[0]),owner)
                except CloudError:
                    continue
                if q.casefold() not in (work["name"]+" "+str(work["description"])+" "+" ".join(str(t) for t in work["tags"])).casefold():
                    continue
                if tag and tag not in work["tags"]:
                    continue
                works.append(work)
            return {"works":works}

    def detail(self, owner, work):
        with self.db() as db:
            return self._view(db,self._visible(db,owner,work),owner)

    def withdraw(self, owner, work):
        with self.db() as db:
            row = self._visible(db,owner,work)
            if row["owner"] != owner:
                raise CloudError("public_work_not_owned",403)
            for table in ("comments","reactions","reports"):
                db.execute(f"DELETE FROM {table} WHERE work=?",(work,))
            db.execute("DELETE FROM works WHERE id=?",(work,))
        return {"ok":True}

    def reaction(self, owner, work, kind, active):
        if kind not in {"like","save"} or type(active) is not bool:
            raise CloudError("invalid_reaction")
        with self.db() as db:
            row = self._visible(db,owner,work)
            if active:
                db.execute("INSERT OR IGNORE INTO reactions VALUES(?,?,?)",(owner,work,kind))
            else:
                db.execute("DELETE FROM reactions WHERE owner=? AND work=? AND kind=?",(owner,work,kind))
            return self._view(db,row,owner)

    def comment_replay(self, owner, work, text, request_id):
        with self.db() as db:
            self._visible(db,owner,work)
            old=db.execute("SELECT work,text FROM comments WHERE owner=? AND request_id=?",(owner,request_id)).fetchone()
            if old and tuple(old)!=(work,text.strip()):
                raise CloudError("comment_request_conflict",409)
            return bool(old)

    def comment(self, owner, work, text=None, request_id=None):
        with self.db() as db:
            self._visible(db,owner,work)
            if text is not None:
                if not isinstance(text,str) or not 1 <= len(text.strip()) <= 2000:
                    raise CloudError("invalid_comment")
                old=db.execute("SELECT work,text FROM comments WHERE owner=? AND request_id=?",(owner,request_id)).fetchone() if request_id else None
                if old and tuple(old)!=(work,text.strip()):
                    raise CloudError("comment_request_conflict",409)
                if not old and db.execute("SELECT COUNT(*) FROM comments WHERE owner=? AND created>?",(owner,time.time()-60)).fetchone()[0] >= 5:
                    raise CloudError("comment_rate_limit",429)
                if not old:
                    db.execute("INSERT INTO comments(id,owner,work,text,created,request_id) VALUES(?,?,?,?,?,?)",(uuid4().hex,owner,work,text.strip(),time.time(),request_id))
            rows = db.execute("SELECT c.id,c.text,c.created,a.id author_id,a.name author_name FROM comments c JOIN authors a ON a.owner=c.owner WHERE c.work=? ORDER BY c.created LIMIT 200",(work,)).fetchall()
            return {"comments":[dict(r) for r in rows if not db.execute("SELECT 1 FROM blocks WHERE (owner=? AND author=?) OR (owner=(SELECT owner FROM authors WHERE id=?) AND author=?)",(owner,r["author_id"],r["author_id"],self.author_id(owner))).fetchone()]}

    def register(self, owner, name):
        with self.db() as db:
            db.execute("INSERT INTO authors VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET name=excluded.name",(self.author_id(owner),owner,name[:80]))

    def author(self, owner, author):
        with self.db() as db:
            row = db.execute("SELECT id,name FROM authors WHERE id=?",(author,)).fetchone()
            if not row or db.execute("SELECT 1 FROM blocks WHERE (owner=? AND author=?) OR (owner=(SELECT owner FROM authors WHERE id=?) AND author=?)",
                                     (owner,author,author,self.author_id(owner))).fetchone():
                raise CloudError("author_not_found",404)
            return {**dict(row),"followers":db.execute("SELECT COUNT(*) FROM follows WHERE author=?",(author,)).fetchone()[0]}

    def relation(self, owner, author, active, *, block=False):
        if type(active) is not bool or author==self.author_id(owner):
            raise CloudError("invalid_author_relation")
        table = "blocks" if block else "follows"
        with self.db() as db:
            if not db.execute("SELECT 1 FROM authors WHERE id=?",(author,)).fetchone():
                raise CloudError("author_not_found",404)
            if not block and active and db.execute("SELECT 1 FROM blocks WHERE (owner=? AND author=?) OR (owner=(SELECT owner FROM authors WHERE id=?) AND author=?)",
                                                  (owner,author,author,self.author_id(owner))).fetchone():
                raise CloudError("author_not_found",404)
            if active:
                db.execute(f"INSERT OR IGNORE INTO {table} VALUES(?,?)",(owner,author))
            else:
                db.execute(f"DELETE FROM {table} WHERE owner=? AND author=?",(owner,author))
            if block and active:
                db.execute("DELETE FROM follows WHERE owner=? AND author=?",(owner,author))
                db.execute("DELETE FROM follows WHERE owner=(SELECT owner FROM authors WHERE id=?) AND author=?", (author,self.author_id(owner)))
        return {"active":active}

    def report(self, owner, work, reason):
        if not isinstance(reason,str) or not 1 <= len(reason.strip()) <= 1000:
            raise CloudError("invalid_report")
        with self.db() as db:
            self._visible(db,owner,work)
            if db.execute("SELECT COUNT(*) FROM reports WHERE owner=? AND created>?", (owner,time.time()-60)).fetchone()[0] >= 5:
                raise CloudError("report_rate_limit",429)
            db.execute("INSERT INTO reports VALUES(?,?,?,?,?)",(uuid4().hex,owner,work,reason.strip(),time.time()))
        return {"accepted":True}
