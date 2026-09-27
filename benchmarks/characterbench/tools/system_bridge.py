"""Reference KCB System adapter, NOT integration with the actual Kyalulu app.

Exposes a loopback-only session/reset contract. Forwards FULL visible history.
No RAG, summarizer, autonomous tools, or secret evaluator data are involved.
"""
from __future__ import annotations
import argparse
from contextlib import closing
import json
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from kcb.config import load_config,check_network
from kcb.providers import Provider
from kcb.util import dumps,digest


def make_server(config,port=8766,db_path='runs/system-bridge.sqlite3'):
    Path(db_path).parent.mkdir(parents=True,exist_ok=True)
    with closing(sqlite3.connect(db_path)) as db:
        db.execute('CREATE TABLE IF NOT EXISTS sessions(session_id TEXT PRIMARY KEY, turn_index INTEGER, request_hash TEXT, response_json TEXT)')
        db.commit()
    lock=threading.Lock()
    client=Provider(config)
    if config['model']=='auto': client.resolve_model()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):
            pass
        def send_json(self,obj,status=200):
            raw=dumps(obj).encode('utf-8');self.send_response(status)
            self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
        def do_GET(self):
            if self.path!='/kcb/v1/models':self.send_json({'error':'not found'},404);return
            self.send_json({'data':[{'id':config['model']}]})
        def do_POST(self):
            if self.path!='/kcb/v1/step':self.send_json({'error':'not found'},404);return
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=16*1024*1024:raise ValueError('invalid length')
                body=json.loads(self.rfile.read(length))
                sid=body['session_id'];turn=body['turn_index'];reset=body['reset'];messages=body['messages']
                if body.get('protocol')!='kcb-system-step-0.1' or not isinstance(sid,str) or len(sid)>300:
                    raise ValueError('invalid protocol or session')
                if type(turn)is not int or turn<1 or type(reset)is not bool or reset!=(turn==1):
                    raise ValueError('invalid turn/reset contract')
                if not isinstance(messages,list) or not messages or messages[-1].get('role')!='user':
                    raise ValueError('invalid visible messages')
                request_hash=digest(body)
                # This small reference adapter serializes session updates intentionally.
                # It is not a production throughput implementation.
                with lock,closing(sqlite3.connect(db_path)) as db:
                    old=db.execute('SELECT turn_index,request_hash,response_json FROM sessions WHERE session_id=?',(sid,)).fetchone()
                    if old and old[0]==turn and old[1]==request_hash:
                        cached=json.loads(old[2]);cached['replayed_response']=True;self.send_json(cached);return
                    if old and not reset and old[0]!=turn-1:raise ValueError('out-of-order session; use a fresh run or explicit recovery')
                    if not old and not reset:raise ValueError('missing session; start/reset with turn 1')
                    effective=dict(config)
                    generation=body.get('generation',{})
                    for key in ('temperature','top_p','max_tokens','extra_body'):
                        if key in generation: effective[key]=generation[key]
                    from kcb.config import validate_config
                    effective=validate_config(effective)
                    reply=Provider(effective).generate(messages)
                    result={'session_id':sid,'reset_ack':reset,'text':reply.text,'usage':reply.usage,
                            'finish_reason':reply.finish_reason,'model':reply.server_model,
                            'runtime_id':'reference-full-history-bridge-v0.1','replayed_response':False,'mock':reply.mock}
                    db.execute('INSERT INTO sessions VALUES (?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET turn_index=excluded.turn_index,request_hash=excluded.request_hash,response_json=excluded.response_json',
                               (sid,turn,request_hash,dumps(result)))
                    db.commit()
                self.send_json(result)
            except Exception as exc:
                self.send_json({'error':type(exc).__name__,'detail':'Invalid step, inconsistent session, or backend failure; no automatic state repair.'},409)
    return ThreadingHTTPServer(('127.0.0.1',port),Handler)


def main():
    p=argparse.ArgumentParser();p.add_argument('--backend-config',required=True);p.add_argument('--port',type=int,default=8766)
    p.add_argument('--db',default='runs/system-bridge.sqlite3');p.add_argument('--allow-remote',action='store_true')
    args=p.parse_args();config=load_config(args.backend_config)
    if config['provider']=='system_http':p.error('bridge backend cannot itself be system_http')
    check_network(config,args.allow_remote)
    server=make_server(config,args.port,args.db)
    print(f'Reference bridge: http://127.0.0.1:{server.server_port}/kcb/v1 (full history, NOT actual Kyalulu)',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=='__main__':main()
