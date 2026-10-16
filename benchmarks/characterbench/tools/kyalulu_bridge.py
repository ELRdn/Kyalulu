"""KCB System adapter for the real Kyalulu API, including durable memory/state.

Run only against an explicitly selected local runtime. This is a benchmark tool,
not a public service; no provider calls are made merely by importing it.
"""
import argparse
import asyncio
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse

RUNTIME_ID = "kyalulu-api-system-v1"


def create_app(api_base="http://127.0.0.1:8000", *, path=Path("runs/kyalulu-bridge.sqlite3"),
               memory=True, mock=False, transport=None):
    host = urlsplit(api_base)
    if host.scheme != "http" or host.hostname not in {"127.0.0.1", "localhost", "::1"} or host.username or host.password or host.query or host.fragment:
        raise ValueError("select a loopback Kyalulu API without credentials")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    lock = asyncio.Lock()
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS turns(session TEXT,turn INTEGER,hash TEXT,result TEXT,PRIMARY KEY(session,turn))")

    @app.get("/kcb/v1/models")
    async def models():
        async with httpx.AsyncClient(base_url=api_base, transport=transport, follow_redirects=False) as client:
            result = await client.get("/api/models")
            result.raise_for_status()
            data = result.json()
            return {"data":[{"id":m["id"]} for m in data.get("models",data.get("data",[]))]}

    @app.post("/kcb/v1/step")
    async def step(body: dict):
        try:
            sid, turn = body["session_id"], body["turn_index"]
            if body.get("protocol") != "kcb-system-step-0.1" or not isinstance(sid,str) or not 1 <= len(sid) <= 300 or type(turn) is not int or turn < 1 or type(body.get("reset")) is not bool:
                raise ValueError("invalid step")
            messages = body["messages"]
            if not isinstance(messages,list) or not messages or len(messages)>200 or any(
                not isinstance(m,dict) or m.get("role") not in {"system","user","assistant"} or not isinstance(m.get("content"),str)
                for m in messages) or messages[-1].get("role") != "user":
                raise ValueError("invalid conversation")
            # Never let benchmark session IDs address the user's real conversations.
            local_sid = "kcb:" + hashlib.sha256(sid.encode()).hexdigest()
            digest = hashlib.sha256(json.dumps(body,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            async with lock:
                with closing(sqlite3.connect(path)) as db, db:
                    old = db.execute("SELECT hash,result FROM turns WHERE session=? AND turn=?",(sid,turn)).fetchone()
                    if old:
                        if old[0] != digest:
                            raise ValueError("edited replay")
                        result = json.loads(old[1]); result["replayed_response"] = True
                        return result
                    count = db.execute("SELECT COALESCE(MAX(turn),0) FROM turns WHERE session=?",(sid,)).fetchone()[0]
                if turn != count+1 or body["reset"] != (turn==1):
                    raise ValueError("invalid turn order")
                generation = body["generation"]
                if not isinstance(generation,dict):
                    raise ValueError("invalid generation settings")
                async with httpx.AsyncClient(base_url=api_base,transport=transport,follow_redirects=False,timeout=330) as client:
                    catalog = await client.get("/api/models"); catalog.raise_for_status()
                    selected = next((m for m in catalog.json().get("models", []) if m["id"] == generation["model"]), None)
                    if not selected or generation.get("extra_body"):
                        raise ValueError("unknown model or unsupported provider settings")
                    if turn==1:
                        existing = await client.get("/api/chat/history",params={"session_id":local_sid})
                        existing.raise_for_status()
                        if existing.json().get("history"):
                            raise ValueError("adapter state was lost; start a new run")
                        settings = {"session_id":local_sid,"system_prompt":"\n".join(m["content"] for m in messages if m.get("role")=="system"),"temperature":generation.get("temperature",0.7)}
                        response = await client.put("/api/chat/settings",json=settings); response.raise_for_status()
                        response = await client.put(f"/api/memory/session/{local_sid}",json={"enabled":memory}); response.raise_for_status()
                    context = await client.get(f"/api/chat/context/{local_sid}"); context.raise_for_status()
                    request = {"model_id":generation["model"],"session_id":local_sid,
                        "generation_id":"kcb:"+hashlib.sha256((sid+":"+str(turn)+":"+digest).encode()).hexdigest(),
                        "context_mode":"stored","history_revision":context.json()["history_revision"],
                        "messages":[messages[-1]],"temperature":generation.get("temperature",0.7),"stream":False}
                    request.update({k:generation[k] for k in ("max_tokens", "top_p", "seed") if k in generation})
                    response = await client.post("/api/chat",json=request); response.raise_for_status()
                    value = response.json()
                    if value.get("status") != "completed":
                        raise ValueError("runtime generation failed")
                    telemetry = value.get("telemetry") or {}
                    result = {"session_id":sid,"reset_ack":body["reset"],"text":value["reply"],
                        "usage":{**{k:telemetry.get(k) for k in ("prompt_tokens", "completion_tokens")},
                            "completion_tokens_details":{"reasoning_tokens":telemetry.get("thinking_tokens")}},
                        "finish_reason":"stop","model":generation["model"],
                        "generation_config":value.get("generation_config"),
                        "runtime_id":RUNTIME_ID,"replayed_response":False,"mock":mock or selected.get("provider_type") == "mock"}
                with closing(sqlite3.connect(path)) as db, db:
                    db.execute("INSERT INTO turns VALUES(?,?,?,?)",(sid,turn,digest,json.dumps(result,ensure_ascii=False)))
                return result
        except (KeyError,TypeError,ValueError,httpx.HTTPError):
            return JSONResponse({"error":"invalid_or_failed_runtime_step"},status_code=409)
    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base",default="http://127.0.0.1:8000")
    parser.add_argument("--db",type=Path,default=Path("runs/kyalulu-bridge.sqlite3"))
    parser.add_argument("--port",type=int,default=8767)
    parser.add_argument("--memory-off",action="store_true")
    parser.add_argument("--mock",action="store_true")
    args = parser.parse_args()
    import uvicorn
    uvicorn.run(create_app(args.api_base,path=args.db,memory=not args.memory_off,mock=args.mock),host="127.0.0.1",port=args.port)
