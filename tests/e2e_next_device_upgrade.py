"""Upgrade and roll back a disposable installed PWA. Optional verified GGUF fixtures run real offline inference."""
import argparse
import asyncio
from contextlib import asynccontextmanager
import hashlib
import json
from pathlib import Path
import socket
import sys
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI, Request
import httpx
from fastapi.responses import FileResponse, HTMLResponse, Response
from playwright.async_api import TimeoutError as BrowserTimeout, async_playwright, expect
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))
from python.api.mobile import WebDist
from browser_storage import READ_ENTITIES_JS

OWNER = str(uuid4())
MODEL = next(m for m in json.loads((ROOT / "apps/web/src/mobile/catalog.generated.json").read_text(encoding="utf-8"))
             if m["id"] == "kyalulu-iq3m")


def verified_shards(directory):
    if directory is None:
        return {}
    expected = {f["bytes"]: f["sha256"] for f in MODEL["files"]}
    found = {}
    for file in directory.iterdir():
        if not file.is_file() or file.is_symlink() or file.stat().st_size not in expected:
            continue
        with file.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest == expected[file.stat().st_size]:
            found[digest] = file
    assert len(found) == len(MODEL["files"]), "The fixture needs every catalog shard at its pinned digest"
    return found


@asynccontextmanager
async def serving(old, new, weights, rollback):
    releases = [WebDist(directory=path, html=True) for path in (old, new, rollback or old)]
    state = {"release": 0, "api_writes": 0}
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/_fixture/setup")
    async def setup():
        return HTMLResponse("<!doctype html><title>Device upgrade fixture</title>")

    @app.get("/_fixture/weights/{digest}")
    async def shard(digest: str):
        if digest not in weights:
            return Response(status_code=404)
        return FileResponse(weights[digest], media_type="application/octet-stream")

    @app.api_route("/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "DELETE"])
    async def web(path: str, request: Request):
        if path.startswith("api/"):
            state["api_writes"] += int(request.method not in ("GET", "HEAD"))
            if state.get("sync") and path in {"api/mobile/status", "api/cloud/app/sync"}:
                return await state["sync"](request)
            return Response(status_code=503)
        return await releases[state["release"]].get_response(path, request.scope)

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False, timeout_graceful_shutdown=2))
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            while not server.started:
                if task.done():
                    await task
                    raise RuntimeError("Fixture server exited")
                await asyncio.sleep(.02)
            yield "http://127.0.0.1:" + str(listener.getsockname()[1]), state
        finally:
            server.should_exit = True
            await task


async def seed_model(page):
    # The input files have been SHA-256 checked before serving. Recreate the representation
    # of an already installed model in a fresh profile without opening the source profile.
    await page.evaluate("""async m => {
      const root = await navigator.storage.getDirectory();
      const models = await root.getDirectoryHandle('kyalulu-mobile-models', {create:true});
      const dir = await models.getDirectoryHandle(m.id, {create:true});
      for (const f of m.files) {
        const response = await fetch('/_fixture/weights/' + f.sha256);
        if (!response.ok) throw Error('Missing fixture shard');
        const file = await dir.getFileHandle(f.sha256, {create:true});
        await response.body.pipeTo(await file.createWritable());
        if ((await file.getFile()).size !== f.bytes) throw Error('Incomplete shard');
      }
      await new Promise((resolve,reject) => {
        const req = indexedDB.open('kyalulu-mobile-v1',1);
        req.onupgradeneeded = () => { req.result.createObjectStore('data'); req.result.createObjectStore('models',{keyPath:'id'}); };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result, tx = db.transaction('models','readwrite');
          tx.objectStore('models').put({id:m.id,verifiedAt:new Date().toISOString(),
            fingerprint:JSON.stringify([m.runtime,m.revision,m.distributionRevision,m.files.map(f=>[f.path,f.bytes,f.sha256])])});
          tx.oncomplete = () => {db.close();resolve(true);}; tx.onabort = () => reject(tx.error);
        };
      });
    }""", MODEL)


async def worker_ready(page):
    await asyncio.wait_for(page.evaluate("""() => navigator.serviceWorker.controller ? true :
        new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(true),{once:true}))"""), 120)


async def apply_update(page):
    await asyncio.wait_for(page.evaluate("""async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
      if (reg.waiting) return;
      const worker = reg.installing;
      if (!worker) throw Error('Expected a changed release');
      await new Promise((resolve,reject) => {
        const changed = () => {
          if (worker.state === 'installed') resolve(true);
          if (worker.state === 'redundant') reject(Error('Worker failed integrity installation'));
        };
        worker.addEventListener('statechange',changed); changed();
      });
    }"""), 120)
    await page.evaluate("""async () => {
      const reg = await navigator.serviceWorker.ready;
      const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(true),{once:true}));
      reg.waiting.postMessage({type:'APPLY_UPDATE'});
      await changed;
    }""")
    await page.reload()


OUTBOX = """async ([owner, seed]) => new Promise((resolve,reject)=>{
  const req=indexedDB.open('kyalulu-app-v1');
  req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{
    const db=req.result,tx=db.transaction('meta',seed?'readwrite':'readonly'),store=tx.objectStore('meta');
    const key='sync:'+owner+':outbox';
    if(seed){
      const id=crypto.randomUUID();
      store.put(true,'sync:'+owner+':consent');
      store.put({request_id:crypto.randomUUID(),withdrawn:0,revisions:{[id]:1},changes:[{id,kind:'character',
        base_revision:0,deleted:false,payload:{rating:'general',storage_policy:'sync',document:{name:'Fixture pending character'}}}]}, key);
    }
    const read=store.get(key);
    tx.oncomplete=()=>{db.close();resolve(read.result);};tx.onabort=()=>reject(tx.error);
  };
})"""


async def rehearse(old, new, weights, channel=None, sync_conflict=False, rollback=None):
    async with serving(old, new, weights, rollback) as (origin, state), async_playwright() as pw:
        with TemporaryDirectory(dir=ROOT / ".artifacts", prefix="du-") as directory:
            profile = Path(directory) / "browser"
            async def launch(offline=False):
                context = await pw.chromium.launch_persistent_context(profile, channel=channel, locale="ja-JP", offline=offline,
                                                                      args=["--enable-unsafe-webgpu"] if weights else [],
                                                                      viewport={"width": 393, "height": 852})
                await context.add_init_script("""window.blockedDirectives=[];
                    document.addEventListener('securitypolicyviolation', e => {
                      const url = URL.canParse(e.blockedURI) ? new URL(e.blockedURI) : null;
                      const resource = url ? (url.origin === location.origin ? url.pathname : url.protocol) : e.blockedURI;
                      window.blockedDirectives.push([e.effectiveDirective, resource]);
                    });""")
                async def guard(route):
                    if urlsplit(route.request.url).netloc == urlsplit(origin).netloc:
                        await route.continue_()
                    else:
                        await route.abort()
                await context.route("**/*", guard)
                return context

            context = await launch()
            try:
                page = context.pages[0]
                await page.goto(origin + "/_fixture/setup")
                await page.evaluate("""owner => {
                  localStorage.setItem('kyalulu-execution-target','device');
                  localStorage.setItem('kyalulu-app-owner',owner);
                  localStorage.setItem('kyalulu-app-preferences-v1',JSON.stringify({version:1,language:'ja',country:'JP',
                    age:25,accepted:true,genres:[],moods:[],activities:[],favorites:[],dismissed:[]}));
                  localStorage.setItem('kyalulu-first-chat-tutorial-v1','skipped');
                }""", OWNER)
                if weights:
                    print("Importing verified fixture model into disposable OPFS", flush=True)
                    await seed_model(page)
                    await page.evaluate("""([owner,id]) => {
                      for(const key of ['my-zeta-model','kyalulu-explicit-model'])
                        localStorage.setItem(key+':'+encodeURIComponent('device:'+owner),id);
                    }""", [OWNER, MODEL["id"]])
                await page.goto(origin + "/device/#/characters/mocha_sfw")
                await worker_ready(page)
                await page.get_by_role("button", name="会話をはじめる", exact=True).click()
                await page.wait_for_url("**/device/#/chats/chat_*")
                chat = page.url
                editor = page.locator(".k-composer textarea")
                await editor.fill("こんにちは。短く挨拶して。")
                if weights:
                    await expect(page.locator(".k-composer__send"), "Old app must recognize the installed model").to_be_enabled()
                before = await page.evaluate(READ_ENTITIES_JS, ["conversation"])
                assert len(before) == 1 and before[0]["owner"] == OWNER
                outbox = await page.evaluate(OUTBOX, [OWNER, True])
                state["release"] = 1
                await apply_update(page)
                await expect(page.locator('meta[name="kyalulu-document"]')).to_have_attribute("content", "next-device")
                open_chunk = await page.locator('script[src^="/_next/static/"]').first.get_attribute("src")
                assert open_chunk
                await expect(editor).to_have_value("こんにちは。短く挨拶して。")
                assert await page.evaluate("crossOriginIsolated && !!navigator.serviceWorker.controller")
                actual = await page.evaluate(OUTBOX, [OWNER, False])
                assert actual == outbox, {"before_keys": list(outbox or {}), "after_keys": list(actual or {}),
                                         "same_request": actual and actual.get("request_id") == outbox["request_id"]}
                assert (await page.evaluate(READ_ENTITIES_JS, ["conversation"]))[0]["id"] == before[0]["id"]
                await context.close()
                context = await launch(offline=True)
                page = context.pages[0]
                # Open the installed app's original root/hash entry with no network.
                await page.goto(origin + "/" + "#" + urlsplit(chat).fragment)
                await page.wait_for_url(chat)
                await expect(page.locator('meta[name="kyalulu-document"]')).to_have_attribute("content", "next-device")
                await expect(page.locator(".k-composer textarea")).to_have_value("こんにちは。短く挨拶して。")
                assert await page.evaluate("crossOriginIsolated && !!navigator.serviceWorker.controller")
                assert not (violations := await page.evaluate("window.blockedDirectives")), violations
                if weights:
                    print("Running offline GGUF turn", flush=True)
                    workers = []
                    page.on("worker", lambda worker: workers.append(urlsplit(worker.url).path))
                    # Observe only protocol stages and counts. Never record user or model text.
                    await page.evaluate("""() => {
                      const counts = window.fixtureInference = {load:0,generate:0,admission:0,window:0,context:0,delta:0,done:0,error:0};
                      window.Worker = class extends Worker {
                        constructor(...args) {
                          super(...args);
                          this.addEventListener('message', ({data}) => {
                            if (['delta','done','error','context'].includes(data.type)) counts[data.type]++;
                            if (['WebGPU','WASM CPU'].includes(data.backend)) counts.backend=data.backend;
                            if (data.type === 'admission-count') counts.admission++;
                          });
                        }
                        postMessage(message, ...rest) {
                          if (message.type === 'load') counts.load++;
                          if (message.type === 'generate-admitted') counts.generate++;
                          if (message.type === 'admission-window') counts.window++;
                          super.postMessage(message,...rest);
                        }
                      };
                    }""")
                    await page.locator(".k-composer__send").click()
                    stop = page.get_by_role("button", name="停止", exact=True)
                    await stop.wait_for()
                    last_stage = None
                    loop = asyncio.get_running_loop()
                    last_progress = loop.time()
                    async with asyncio.timeout(3600):
                        while await stop.is_visible():
                            try:
                                await stop.wait_for(state="hidden", timeout=30000)
                            except BrowserTimeout:
                                stage = await page.evaluate("window.fixtureInference")
                                if stage != last_stage:
                                    print("Offline worker stages", stage, flush=True)
                                    last_stage, last_progress = stage, loop.time()
                                elif loop.time() - last_progress > 900:
                                    raise AssertionError("Offline worker made no stage or token progress for 15 minutes")
                    assert any(path.startswith("/assets/runtime.worker-") for path in workers)
                    assert not await page.locator(".k-chat-error__text").count(), "Device reported a generation error"
                    rows = await page.evaluate(READ_ENTITIES_JS, ["conversation"])
                    receipt = rows[0]["payload"]["last_generation"]
                    assert receipt["status"] == "completed" and receipt["assistant_id"] and receipt["generation_id"]
                    await context.close()
                    context = await launch(offline=True)
                    page = context.pages[0]
                    await page.goto(chat)
                    await expect(page.locator(".k-chat-messages .k-msg--user")).to_have_count(1)
                    rows = await page.evaluate(READ_ENTITIES_JS, ["conversation"])
                    assert rows[0]["payload"]["last_generation"] == receipt and rows[0]["owner"] == OWNER
                    assert any(m["id"] == receipt["assistant_id"] and m["content"].strip() for m in rows[0]["payload"]["messages"])
                    print("Verified a committed offline reply by generation ID", flush=True)
                await page.goto(origin + "/migration/")
                await expect(page.locator('meta[name="kyalulu-document"]')).to_have_attribute("content", "next-migration")
                assert not await page.evaluate("crossOriginIsolated")
                await page.get_by_role("heading", name="以前のMobileから移行").wait_for()
                assert not (violations := await page.evaluate("window.blockedDirectives")), violations
                await context.set_offline(False)
                await page.goto(chat)
                state["release"] = 2 if rollback else 0
                await apply_update(page)
                await expect(page.locator('meta[name="kyalulu-document"]')).to_have_count(0)
                await expect(page.locator(".k-composer textarea")).to_be_visible()
                assert await page.evaluate(OUTBOX, [OWNER, False]) == outbox
                if rollback:
                    async with httpx.AsyncClient(base_url=origin, trust_env=False) as client:
                        worker = await client.get("/sw.js")
                        chunk = await client.get(open_chunk)
                        assert worker.content == (rollback / "sw.js").read_bytes()
                        assert chunk.status_code == 200 and chunk.content == (new / open_chunk.lstrip("/")).read_bytes()
                if weights:
                    rows = await page.evaluate(READ_ENTITIES_JS, ["conversation"])
                    assert len(rows) == 1 and rows[0]["owner"] == OWNER and rows[0]["payload"]["last_generation"] == receipt
                    await expect(page.locator(".k-chat-messages .k-msg--user")).to_have_count(1)
                assert state["api_writes"] == 0
                if sync_conflict:
                    from online_sync_checks import upgrade_conflict
                    await upgrade_conflict(page, OWNER, state, apply_update, already_received=sync_conflict=="previously-received")
            finally:
                await context.close()
    print("Verified installed worker upgrade, isolated offline chat, separate migration document and worker rollback.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--old", type=Path, required=True)
    parser.add_argument("--new", type=Path, required=True)
    parser.add_argument("--rollback", type=Path, help="Companion recovery bundle's extracted web directory")
    parser.add_argument("--weights", type=Path)
    parser.add_argument("--sync-conflict", nargs="?", const="pending", choices=("pending", "previously-received"),
                        help="Reconcile a queued edit with a lost or already downloaded branch acknowledgment")
    parser.add_argument("--channel", choices=("chrome", "chromium"), help="Select the browser for the disposable profile")
    args = parser.parse_args()
    asyncio.run(rehearse(args.old.resolve(), args.new.resolve(), verified_shards(args.weights), args.channel,
                         args.sync_conflict, args.rollback))
