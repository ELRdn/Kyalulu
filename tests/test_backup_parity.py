import sqlite3
import json

import httpx
import pytest
from python.api.main import app
from python.local_backup import backup, restore
from python.storage import db as storage, conversation


@pytest.mark.asyncio
async def test_restore_scrubs_source_snapshot_even_when_memory_rows_were_cleared(isolated):
    await storage.init_db()
    result = {'reply':'keep reply','memory':{'candidates':[{'id':'gone','source_session_id':'source','content':'private quote'}],
        'injected':['gone'],'evidenced':['gone'],'decisions':[{'memory_id':'gone'}]}, 'raw_prompt':'private quote'}
    with sqlite3.connect(storage.DB_PATH) as db:
        db.execute("INSERT INTO generations(generation_id,session_id,fingerprint,status,result_json) VALUES('retained','other','','completed',?)",
                   (json.dumps(result),))
    archive = isolated/'before-source-erasure.zip'
    backup(isolated, archive)
    await conversation.purge('source')
    restore(isolated, archive)
    with sqlite3.connect(storage.DB_PATH) as db:
        redacted = json.loads(db.execute("SELECT result_json FROM generations WHERE generation_id='retained'").fetchone()[0])
    assert redacted['reply'] == 'keep reply'
    assert 'private quote' not in json.dumps(redacted) and 'gone' not in json.dumps(redacted)


@pytest.mark.asyncio
async def test_local_restore_keeps_permanent_erasure_but_restores_other_sessions(isolated):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://test") as client:
        for sid in ("erase-me","keep-me"):
            response=await client.post("/api/chat",json={"model_id":"mock-echo","session_id":sid,
                "messages":[{"role":"user","content":"hello"}]})
            assert response.json()["status"]=="completed"
    archive=isolated/"before-erase.zip"
    backup(isolated,archive)
    await conversation.purge("erase-me")
    restore(isolated,archive)
    with sqlite3.connect(storage.DB_PATH) as db:
        assert db.execute("SELECT COUNT(*) FROM chat_history WHERE session_id='erase-me'").fetchone()[0]==0
        assert db.execute("SELECT COUNT(*) FROM generations WHERE session_id='erase-me'").fetchone()[0]==0
        assert db.execute("SELECT COUNT(*) FROM session_deletions WHERE session_id='erase-me'").fetchone()[0]==1
        assert db.execute("SELECT COUNT(*) FROM chat_history WHERE session_id='keep-me'").fetchone()[0]==2
