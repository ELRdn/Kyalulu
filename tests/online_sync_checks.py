"""Replay an installed client's pending conflict against disposable real Cloud storage."""
import asyncio
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from browser_storage import READ_ENTITIES_JS
from fastapi.responses import JSONResponse, Response


async def upgrade_conflict(page, owner, state, apply_update, *, already_received):
    from python.cloud.config import CloudConfig
    from python.cloud.store import CloudStore
    from python.cloud.unified import UnifiedService

    change = json.loads((Path(__file__).parent / "fixtures/unified-history.json").read_text(encoding="utf-8"))
    remote = deepcopy(change)
    remote["payload"]["messages"][-1]["content"] = "Fixture server continuation"
    request_id = str(uuid4())
    with TemporaryDirectory() as temporary:
        service = UnifiedService(CloudStore(CloudConfig(root=Path(temporary), origin="https://app.test",
            secret="fixture-" * 6, unified_enabled=True, legal_approved=True)))
        service.store.account(owner, consent="fixture")
        service.push(owner, "fixture-server-change", [remote])
        await page.evaluate("""([owner,change,id]) => new Promise((resolve,reject) => {
          const open=indexedDB.open('kyalulu-app-v1');
          open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{
            const db=open.result, tx=db.transaction(['entities','meta'],'readwrite'), meta=tx.objectStore('meta');
            tx.objectStore('entities').put({owner,id:change.id,kind:change.kind,payload:change.payload,revision:1,
              serverRevision:0,dirty:true,deleted:false,pinned:false,opened:Date.now()});
            meta.put(100,'message-sequence:'+owner);
            meta.put(true,'sync:'+owner+':consent');
            meta.put({request_id:id,withdrawn:0,revisions:{[change.id]:1},changes:[change]},'sync:'+owner+':outbox');
            tx.oncomplete=()=>{db.close();resolve(true);}; tx.onabort=()=>reject(tx.error);
          };
        })""", [owner, change, request_id])
        attempts = []
        visits = {"identity": 0, "pull": 0}
        branch_id = None

        async def sync(request):
            nonlocal branch_id
            if request.url.path == "/api/mobile/status":
                visits["identity"] += 1
                if already_received and state["release"] == 0 and len(attempts)>=2:
                    return Response(status_code=503)
                return JSONResponse({"authenticated": True, "cloud_mode": True, "owner_scope": owner})
            assert request.headers.get("x-kyalulu-owner") == owner
            if request.method == "GET":
                visits["pull"] += 1
                return JSONResponse(service.pull(owner, int(request.query_params.get("cursor", 0)), paged=True))
            body = await request.json()
            assert body["request_id"] == request_id and body["changes"] == [change]
            result = service.push(owner, request_id, body["changes"])
            ack, = result["changes"]
            assert ack["branched"] and ack["source_id"] == change["id"]
            assert branch_id is None or ack["id"] == branch_id
            branch_id = ack["id"]
            attempts.append(request_id)
            if len(attempts) == 1:
                return Response(status_code=503)
            return JSONResponse(result)

        try:
            if already_received:
                state["sync"] = sync
                async with asyncio.timeout(40):
                    while len(attempts)<2:
                        await page.evaluate("window.dispatchEvent(new Event('online'))")
                        await asyncio.sleep(.5)
                old_rows = {r["id"]:r for r in await page.evaluate(READ_ENTITIES_JS, ["conversation"])}
                assert branch_id in old_rows and old_rows[change["id"]]["dirty"]
                old_message_ids = [m["id"] for m in old_rows[branch_id]["payload"]["messages"]]
                del state["sync"]
            state["release"] = 1
            await apply_update(page)
            await page.locator('meta[name="kyalulu-document"][content="next-device"]').wait_for(state="attached")
            state["sync"] = sync
            expected_attempts = 3 if already_received else 2
            async with asyncio.timeout(70):
                while True:
                    await page.evaluate("window.dispatchEvent(new Event('online'))")
                    await asyncio.sleep(.5)
                    rows = {r["id"]:r for r in await page.evaluate(READ_ENTITIES_JS, ["conversation"])}
                    if len(attempts) == expected_attempts and branch_id in rows and rows[change["id"]]["payload"]["messages"][-1]["content"] == remote["payload"]["messages"][-1]["content"]:
                        break
                    if len(attempts)>expected_attempts+1:
                        raise AssertionError("Replayed branch still pending after its acknowledgment")
            for id, expected in ((branch_id, change), (change["id"], remote)):
                row = rows[id]
                assert row["owner"] == owner and not row["dirty"]
                assert [m["content"] for m in row["payload"]["messages"]] == [m["content"] for m in expected["payload"]["messages"]]
            assert len(service.pull(owner)["changes"]) == 2
            if already_received:
                assert [m["id"] for m in rows[branch_id]["payload"]["messages"]] == old_message_ids
        except TimeoutError:
            raise AssertionError({"sync_requests": visits, "pushes": len(attempts), "local_branch": branch_id in rows,
                                  "source_dirty": rows[change["id"]]["dirty"]}) from None
        finally:
            state.pop("sync", None)
    print("Verified pending old-client sync, lost acknowledgment, one conflict branch, and both histories.",
          "Preexisting branch:" , already_received)
