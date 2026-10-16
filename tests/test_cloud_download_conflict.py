import sqlite3

import pytest
from python.api import cloud_sync
from python.storage import db as storage


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["create", "page"])
async def test_changed_download_leaves_local_workspace_and_baseline_intact(isolated, monkeypatch, stage):
    monkeypatch.setenv('KYALULU_MANAGED_CLOUD_ORIGIN', 'https://cloud.test')
    cloud_sync.save_config({'origin':'https://cloud.test','mode':'all','revision':7,'token':'fixture'})
    await storage.init_db()
    with sqlite3.connect(storage.DB_PATH) as db:
        db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('local','user','local text')")
    calls = []
    async def remote(_config, path, **kwargs):
        calls.append((path, kwargs.get('method', 'GET')))
        if kwargs.get('method') == 'DELETE':
            return {'ok':True}
        if stage == 'create' or '/pages/' in path:
            return {'conflict':True,'error':'source changed'}
        return {'transfer_id':'fixture-transfer','revision':8,'pages':1}
    monkeypatch.setattr(cloud_sync, 'remote', remote)
    result = await cloud_sync.adopt()
    assert result.status_code == 409
    assert cloud_sync.read_config()['revision'] == 7
    with sqlite3.connect(storage.DB_PATH) as db:
        assert db.execute("SELECT content FROM chat_history WHERE session_id='local'").fetchone()[0] == 'local text'
    assert not (isolated/'backups').exists()
    if stage == 'page':
        assert calls[-1] == ('/transfers/fixture-transfer','DELETE')
