import sqlite3

import pytest
from python.cloud.app import create_app
from python.cloud.store import CloudError
from python.cloud.transfers import Transfers
from python.storage import db as storage, conversation
from python.storage.context import CloudStorageContext, storage_context
from test_cloud_cost_accounting import config, enroll


@pytest.mark.asyncio
async def test_ready_download_cannot_deliver_pre_erasure_text(tmp_path):
    cfg = config(tmp_path)
    app = create_app(cfg)
    owner = enroll(app)
    transfers = Transfers(app.state.store, app.state.sync)
    ctx = CloudStorageContext.for_owner(cfg.root / 'tenants', owner)
    with storage_context(ctx):
        await storage.init_db()
        path = ctx.directory / 'data.db'
        with sqlite3.connect(path) as db:
            db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('erased','user','private text')")
        download = transfers.download(owner, path, None)
        assert 'private text' in str(transfers.page(owner, download['transfer_id'], 0))
        await conversation.purge('erased', cloud_revision=(app.state.store.path, owner))
        with pytest.raises(CloudError, match='transfer_source_changed_restart_download'):
            transfers.page(owner, download['transfer_id'], 0)
        transfers.delete(owner, download['transfer_id'])
        fresh = transfers.download(owner, path, None)
        pages = [transfers.page(owner, fresh['transfer_id'], index) for index in range(fresh['pages'])]
        assert 'private text' not in str(pages)
        assert any(page['table'] == 'session_deletions' for page in pages)
