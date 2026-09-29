from __future__ import annotations
import json
import threading
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from kcb.config import validate_config
from kcb.providers import Provider


class FakeAPI:
    """Loopback HTTP/SSE protocol simulator. Never an actual language model."""
    def __init__(self, *, models=None, transport='auto', fail_at=None, text=None,
                 malformed=False, incomplete=False, usage=True, reasoning=False,
                 role_delay=0.0, finish='stop', duplicate_json=False, error_object=False):
        self.ids=['fixture-http'] if models is None else models
        self.transport=transport;self.fail_at=fail_at;self.text=text;self.malformed=malformed
        self.incomplete=incomplete;self.include_usage=usage;self.reasoning=reasoning
        self.role_delay=role_delay;self.finish=finish;self.duplicate_json=duplicate_json;self.error_object=error_object
        self.requests=[];self.count=0;self.lock=threading.Lock()
        self.fixture=Provider(validate_config({'provider':'mock','model':'fixture'}))
    def __enter__(self):
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_GET(self):
                if self.path!='/v1/models':self.send_error(404);return
                data={'data':[{'id':x} for x in owner.ids]}
                raw=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                with owner.lock:
                    owner.count+=1;number=owner.count;owner.requests.append(body)
                if owner.fail_at==number:
                    self.send_response(503);self.end_headers();self.wfile.write(b'fake-secret-123 MUST NOT APPEAR IN CLIENT LOGS');return
                text=owner.text if owner.text is not None else owner.fixture.generate(body['messages']).text
                streaming=(body.get('stream') and owner.transport!='json') or owner.transport=='sse'
                if owner.malformed:
                    self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'not JSON');return
                usage={'prompt_tokens':37,'completion_tokens':11,'total_tokens':48,'completion_tokens_details':{'reasoning_tokens':2 if owner.reasoning else 0},'prompt_tokens_details':{'cached_tokens':3}}
                if not streaming:
                    obj={'model':'fixture-http','choices':[{'message':{'content':text},'finish_reason':owner.finish}]}
                    if owner.reasoning:obj['choices'][0]['message']['reasoning_content']='not retained reasoning'
                    if owner.include_usage:obj['usage']=usage
                    if owner.error_object:obj={'error':{'message':'simulated error'}}
                    raw=json.dumps(obj,ensure_ascii=False).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
                self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
                def event(obj):
                    self.wfile.write(('data: '+json.dumps(obj,ensure_ascii=False)+'\n\n').encode());self.wfile.flush()
                event({'choices':[{'index':0,'delta':{'role':'assistant'},'finish_reason':None}]})
                if owner.reasoning:event({'choices':[{'delta':{'reasoning_content':'not retained reasoning'},'finish_reason':None}]})
                if owner.role_delay:time.sleep(owner.role_delay)
                for chunk in (text[:max(1,len(text)//2)],text[max(1,len(text)//2):]):
                    event({'model':'fixture-http','choices':[{'index':0,'delta':{'content':chunk},'finish_reason':None}]})
                if owner.error_object:event({'error':{'message':'simulated stream failure'}});return
                if not owner.incomplete:
                    event({'choices':[{'index':0,'delta':{},'finish_reason':owner.finish}]})
                    if owner.include_usage:event({'choices':[],'usage':usage})
                    self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.server.server_port}/v1'
        return self
    def config(self,**changes):
        return validate_config({'base_url':self.url,'model':'fixture-http','label':'HTTP TRANSPORT FIXTURE - NOT LLM','timeout_seconds':3,**changes})
    def __exit__(self,*args):
        self.server.shutdown();self.server.server_close();self.thread.join(timeout=3)
