"""Durable entity synchronization for an explicitly enrolled native PC."""
import json
import sqlite3
import base64
import hashlib
import math
import re
from copy import deepcopy
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit, quote
from uuid import UUID, uuid4

import httpx
from python.cloud.store import CloudError, fingerprint
from . import entity_bridge as bridge


class NativeSync:
    def __init__(self,path,origin,owner,token,*,transport=None):
        parsed=urlsplit(origin)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or origin!='https://'+parsed.netloc:
            raise ValueError('Invalid unified Cloud origin')
        if not isinstance(token,str) or not 20<=len(token)<=256 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in token):raise ValueError('Invalid entity sync token')
        self.path,self.origin,self.owner,self.token=Path(path),origin,str(UUID(owner)) if owner else None,token
        self.namespace=fingerprint([origin,self.owner]) if self.owner else None;self.transport=transport

    @contextmanager
    def transaction(self,*,allow_generation=False):
        if not self.namespace:raise CloudError('sync_not_enrolled',403)
        # All durable changes live in the single attached runtime file, including WAL.
        db=sqlite3.connect(':memory:',timeout=10);db.row_factory=sqlite3.Row
        try:
            db.execute('ATTACH DATABASE ? AS runtime',(str(self.path),))
            db.execute('BEGIN IMMEDIATE')
            if allow_generation:bridge.Links(db,self.namespace).prepare()
            else:bridge.prepare(db,self.namespace)
            db.execute('CREATE TABLE IF NOT EXISTS runtime.native_sync_meta(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key))')
            db.execute('CREATE TABLE IF NOT EXISTS runtime.native_sync_received(namespace TEXT,id TEXT,revision INTEGER,deleted INTEGER,PRIMARY KEY(namespace,id))')
            # SQL keeps guards current even when a legacy writer changes the original row.
            if not db.execute("SELECT 1 FROM runtime.sqlite_master WHERE name='native_sync_outbox_sources'").fetchone():
                db.execute('CREATE TABLE runtime.native_sync_outbox_sources(namespace TEXT,session_id TEXT,deleted INTEGER,PRIMARY KEY(namespace,session_id))')
                db.execute("CREATE INDEX runtime.native_sync_outbox_header ON native_sync_meta(namespace,json_extract(value,'$.request_id'),COALESCE(json_extract(value,'$.withdrawn'),0),json_array_length(value,'$.captures'),json_array_length(value,'$.changes'),json_type(value)) WHERE key='outbox'")
                sources = "SELECT json_extract(c.value,'$.native_session_id'),COALESCE(json_extract(p.value,'$.deleted'),0) FROM json_each(NEW.value,'$.captures') c JOIN json_each(NEW.value,'$.changes') p ON c.key=p.key"
                for name, event in [('insert','INSERT'),('update','UPDATE OF value')]:
                    db.execute(f"CREATE TRIGGER runtime.native_sync_outbox_{name} AFTER {event} ON native_sync_meta WHEN NEW.key='outbox' BEGIN "
                        "DELETE FROM native_sync_outbox_sources WHERE namespace=NEW.namespace; "
                        f"INSERT INTO native_sync_outbox_sources SELECT NEW.namespace,* FROM ({sources}); END")
                db.execute("CREATE TRIGGER runtime.native_sync_outbox_delete AFTER DELETE ON native_sync_meta WHEN OLD.key='outbox' BEGIN DELETE FROM native_sync_outbox_sources WHERE namespace=OLD.namespace; END")
                db.execute("INSERT INTO runtime.native_sync_outbox_sources SELECT m.namespace,json_extract(c.value,'$.native_session_id'),COALESCE(json_extract(p.value,'$.deleted'),0) "
                    "FROM runtime.native_sync_meta m,json_each(m.value,'$.captures') c JOIN json_each(m.value,'$.changes') p ON c.key=p.key WHERE m.key='outbox'")
            yield db
            db.commit()
        except BaseException:
            db.rollback();raise
        finally:db.close()

    def meta(self,db,key,default=None):
        row=db.execute('SELECT value FROM runtime.native_sync_meta WHERE namespace=? AND key=?',(self.namespace,key)).fetchone()
        return json.loads(row[0]) if row else default

    def save(self,db,key,value):
        db.execute('INSERT INTO runtime.native_sync_meta VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value',(self.namespace,key,json.dumps(value)))

    def outbox_header(self, db):
        # The covering expression index reads flags/counts without loading the body.
        return db.execute("SELECT json_extract(value,'$.request_id') AS request_id,COALESCE(json_extract(value,'$.withdrawn'),0) AS withdrawn,"
            "json_array_length(value,'$.captures') AS captures,json_array_length(value,'$.changes') AS changes,json_type(value) AS type "
            "FROM runtime.native_sync_meta INDEXED BY native_sync_outbox_header WHERE namespace=? AND key='outbox'", (self.namespace,)).fetchone()

    def configure(self,selected,enabled,*,consent=False):
        if type(enabled) is not bool or enabled and consent is not True:raise CloudError('sync_consent_required')
        if not isinstance(selected,list) or len(selected)>1000 or any(not isinstance(s,str) or not 0<len(s)<=200 or s.startswith('__') for s in selected) or len(set(selected))!=len(selected):raise CloudError('invalid_sync_selection')
        with self.transaction(allow_generation=not enabled) as db:
            before=self.meta(db,'selected',[]);excluded=set(self.meta(db,'excluded',[]));links=bridge.Links(db,self.namespace)
            if enabled:bridge.capture(db,selected,self.namespace)
            for sid in set(before)-set(selected):
                link=links.session(sid)
                if link:excluded.add(link['entity_id'])
            for sid in set(selected)-set(before):
                link=links.session(sid)
                if link and link['entity_id'] in excluded:
                    excluded.remove(link['entity_id'])
                    db.execute('DELETE FROM runtime.native_sync_received WHERE namespace=? AND id=?',(self.namespace,link['entity_id']))
                    self.save(db,'cursor',0)
            self.save(db,'selected',selected);self.save(db,'enabled',enabled);self.save(db,'excluded',sorted(excluded))
            pending=self.meta(db,'outbox')
            if pending and (not enabled or any(c['native_session_id'] not in selected for c in pending['captures'])):
                pending['withdrawn']=True;self.save(db,'outbox',pending)

    def status(self):
        with self.transaction(allow_generation=True) as db:
            pending = self.outbox_header(db)
            return {'enabled':self.meta(db,'enabled',False),'selected':self.meta(db,'selected',[]),'pending':bool(pending and pending['type']!='null'),'cursor':self.meta(db,'cursor',0)}

    async def remote(self,path,*,body=None):
        if path == '/sync' and body is not None:
            raw = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
            if len(raw) > 1_500_000: return await self._upload(body['request_id'], raw)
        if path.startswith('/sync?cursor=') or path.startswith('/entities/'):
            path += '&paged=1' if '?' in path else '?paged=1'
        result = await self._request(path, body=body)
        if path.startswith('/sync?cursor=') and isinstance(result.get('changes'), list):
            for entity in result['changes']:
                if isinstance(entity, dict) and 'payload_ref' in entity:
                    if entity.get('kind') != 'conversation': continue
                    if not isinstance(entity.get('id'), str) or type(entity.get('revision')) is not int or entity['revision'] < 1:
                        raise CloudError('invalid_sync_response')
                    with self.transaction() as db:
                        known = db.execute('SELECT revision FROM runtime.native_sync_received WHERE namespace=? AND id=?', (self.namespace, entity.get('id'))).fetchone()
                        if entity.get('id') in self.meta(db, 'excluded', []) or known and type(entity.get('revision')) is int and known[0] >= entity['revision']:
                            continue
                    await self._expand(entity)
        return result

    async def _request(self,path,*,body=None):
        if not (path in {'/sync','/sync/device','/sync/transfers'} or path.startswith('/sync?cursor=') or path.startswith('/sync/cancel/') or path.startswith('/entities/')
                or re.fullmatch(r'/sync/transfers/[0-9a-f-]{36}/(?:parts/\d+|commit)', path)):raise ValueError('Invalid sync path')
        if not self.owner and path!='/sync/device':raise CloudError('sync_not_enrolled',403)
        headers={'Authorization':'Bearer '+self.token,'Origin':self.origin}
        if self.owner:headers['X-Kyalulu-Owner']=self.owner
        async with httpx.AsyncClient(transport=self.transport,timeout=30,follow_redirects=False) as client:
            response=await client.request('POST' if body is not None else 'GET',self.origin+'/api/cloud/app'+path,
                json=body,headers=headers)
        if len(response.content)>16_000_000:raise CloudError('sync_response_too_large',413)
        try:value=response.json()
        except ValueError as exc:raise CloudError('invalid_sync_response') from exc
        if not response.is_success:raise CloudError(value.get('error','sync_request_failed') if isinstance(value,dict) else 'sync_request_failed',response.status_code)
        if not isinstance(value,dict):raise CloudError('invalid_sync_response')
        return value

    def _transfer_active(self, request_id=None):
        with self.transaction() as db:
            if not self.meta(db, 'enabled', False): raise CloudError('sync_request_canceled' if request_id is not None else 'sync_consent_required', 409)
            if request_id is None: return
            pending = self.outbox_header(db)
            if not pending or pending['request_id'] != request_id or pending['withdrawn']:
                raise CloudError('sync_request_canceled', 409)
            sources = db.execute('SELECT session_id,deleted FROM runtime.native_sync_outbox_sources WHERE namespace=?', (self.namespace,)).fetchall()
            if not pending['captures'] or pending['captures'] != pending['changes'] or len(sources) != pending['captures']:
                raise CloudError('invalid_sync_outbox', 409)
            selected = set(self.meta(db, 'selected', []))
            if any(row['session_id'] not in selected or not row['deleted'] and db.execute('SELECT 1 FROM runtime.session_deletions WHERE session_id=?', (row['session_id'],)).fetchone() for row in sources):
                raise CloudError('sync_request_canceled', 409)

    async def _upload(self, request_id, raw):
        from python.cloud.entity_transfers import CHUNK_BYTES
        self._transfer_active(request_id)
        opened = await self._request('/sync/transfers', body={'request_id': request_id, 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        if opened.get('inline_receipt_required') is True:
            self._transfer_active(request_id)
            return await self._request('/sync', body=json.loads(raw))
        if 'result' in opened: return opened['result']
        transfer, next_part = opened.get('transfer_id'), opened.get('next')
        if (not isinstance(transfer, str) or not re.fullmatch('[0-9a-f-]{36}', transfer) or type(next_part) is not int
            or not 0 <= next_part <= math.ceil(len(raw) / CHUNK_BYTES) or opened.get('chunk_bytes') != CHUNK_BYTES):
            raise CloudError('invalid_sync_response')
        for index in range(next_part, math.ceil(len(raw) / CHUNK_BYTES)):
            self._transfer_active(request_id)
            chunk = raw[index * CHUNK_BYTES:(index + 1) * CHUNK_BYTES]
            received = await self._request(f'/sync/transfers/{transfer}/parts/{index}', body={
                'data': base64.b64encode(chunk).decode(), 'sha256': hashlib.sha256(chunk).hexdigest()})
            if type(received.get('next')) is not int or received['next'] != index + 1: raise CloudError('invalid_sync_response')
        self._transfer_active(request_id)
        return await self._request(f'/sync/transfers/{transfer}/commit', body={})

    async def _expand(self, entity):
        from python.cloud.entity_transfers import CHUNK_BYTES
        ref = entity['payload_ref']
        if (not isinstance(ref, dict) or ref.get('id') != entity.get('id') or ref.get('revision') != entity.get('revision')
            or type(ref.get('size')) is not int or not 0 < ref['size'] <= 1_000_000_000
            or not isinstance(ref.get('transfer_id'), str) or not re.fullmatch('[0-9a-f-]{36}', ref['transfer_id'])
            or ref.get('chunk_bytes') != CHUNK_BYTES or type(ref.get('chunks')) is not int or ref['chunks'] != math.ceil(ref['size'] / CHUNK_BYTES)
            or not isinstance(ref.get('sha256'), str) or not re.fullmatch('[a-f0-9]{64}', ref['sha256'])):
            raise CloudError('invalid_sync_response')
        raw = bytearray()
        for index in range(ref['chunks']):
            self._transfer_active()
            part = await self._request(f"/sync/transfers/{ref['transfer_id']}/parts/{index}")
            data = part.get('data')
            if not isinstance(data, str) or len(data) > 4 * math.ceil(CHUNK_BYTES / 3): raise CloudError('invalid_sync_response')
            try: chunk = base64.b64decode(data, validate=True)
            except ValueError as exc: raise CloudError('invalid_sync_response') from exc
            if len(chunk) != min(CHUNK_BYTES, ref['size'] - len(raw)) or hashlib.sha256(chunk).hexdigest() != part.get('sha256'):
                raise CloudError('transfer_hash_mismatch', 409)
            raw.extend(chunk)
        if len(raw) != ref['size'] or hashlib.sha256(raw).hexdigest() != ref['sha256']:
            raise CloudError('transfer_hash_mismatch', 409)
        try: payload = json.loads(raw)
        except (ValueError, UnicodeError) as exc: raise CloudError('invalid_sync_response') from exc
        if not isinstance(payload, dict): raise CloudError('invalid_sync_response')
        self._transfer_active()
        entity['payload'] = payload
        entity.pop('payload_ref')

    async def verify(self):
        value=await self.remote('/sync/device')
        try:owner=str(UUID(value.get('owner')))
        except (ValueError,TypeError,AttributeError) as exc:raise CloudError('sync_account_changed',403) from exc
        if self.owner and owner!=self.owner or value.get('protocol')!='entity-v1':raise CloudError('sync_account_changed',403)
        self.owner=owner;self.namespace=fingerprint([self.origin,owner])
        return value

    async def deletion_reviews(self):
        with self.transaction() as db:pending=self.meta(db,'outbox')
        result=[]
        for change in (pending or {}).get('changes',[]):
            if not change.get('deleted'):continue
            current=await self.remote('/entities/'+quote(change['id'],safe=''))
            if current.get('id')!=change['id'] or type(current.get('revision')) is not int or current['revision']<1:raise CloudError('invalid_sync_entity')
            result.append({'id':change['id'],'revision':current['revision'],'deleted':current.get('deleted') is True,'count':current.get('message_count',len(current.get('payload',{}).get('messages',[])))})
        return result

    async def confirm_deletion(self,entity_id,expected_revision):
        if not isinstance(entity_id,str) or not 0<len(entity_id)<=200 or type(expected_revision) is not int or expected_revision<1:raise CloudError('invalid_sync_confirmation')
        current=await self.remote('/entities/'+quote(entity_id,safe=''))
        if current.get('id')!=entity_id or current.get('revision')!=expected_revision:raise CloudError('sync_delete_reconfirmation_required',409)
        with self.transaction() as db:
            pending=self.meta(db,'outbox')
            if not pending:raise CloudError('sync_outbox_changed',409)
            if pending.get('withdrawn'):raise CloudError('sync_outbox_withdrawn',409)
            matched=False
            for change,capture in zip(pending['changes'],pending['captures'],strict=True):
                if change['id']!=entity_id:continue
                if not change.get('deleted') or not db.execute('SELECT 1 FROM runtime.session_deletions WHERE session_id=?',(capture['native_session_id'],)).fetchone():raise CloudError('sync_delete_confirmation_required',409)
                change['base_revision']=expected_revision;capture['base_revision']=expected_revision;matched=True
            if not matched:raise CloudError('sync_outbox_changed',409)
            pending['request_id']=str(uuid4());self.save(db,'outbox',pending)

    async def settle_withdrawn(self):
        with self.transaction(allow_generation=True) as db:pending=self.meta(db,'outbox')
        if not pending or not pending.get('withdrawn'):return
        result=await self.remote('/sync/cancel/'+quote(pending['request_id'],safe=''),body={})
        if result.get('state')=='applied':
            if result.get('hash')!=fingerprint(pending['changes']):raise CloudError('sync_request_conflict',409)
            self.acknowledge(pending,result['result'])
        elif result.get('state')=='canceled':
            with self.transaction(allow_generation=True) as db:
                stored=self.meta(db,'outbox')
                if not stored or fingerprint(stored)!=fingerprint(pending):raise CloudError('sync_outbox_changed',409)
                self.save(db,'outbox',None)
        else:raise CloudError('invalid_sync_receipt')

    def stage(self):
        with self.transaction() as db:
            if not self.meta(db,'enabled',False):return None
            selected=self.meta(db,'selected',[])
            pending=self.meta(db,'outbox')
            if pending:
                if any(c['native_session_id'] not in selected or not change.get('deleted') and db.execute('SELECT 1 FROM runtime.session_deletions WHERE session_id=?',(c['native_session_id'],)).fetchone() for c,change in zip(pending['captures'],pending['changes'],strict=True)):
                    pending['withdrawn']=True;self.save(db,'outbox',pending)
                return pending
            links=bridge.Links(db,self.namespace)
            changes=[]
            for sid in selected:
                deleted=db.execute('SELECT 1 FROM runtime.session_deletions WHERE session_id=?',(sid,)).fetchone()
                link=links.session(sid)
                if deleted and link:
                    known=db.execute('SELECT deleted FROM runtime.native_sync_received WHERE namespace=? AND id=?',(self.namespace,link['entity_id'])).fetchone()
                    if not known or not known[0]:changes.append({'id':link['entity_id'],'kind':'conversation','base_revision':link['revision'],'payload':{},'deleted':True,'delete_confirmed':True,'native_session_id':sid,'mapping':json.loads(link['mapping'])})
            if not changes:
                for start in range(0,len(selected),1000):
                    changes.extend(bridge.capture(db,selected[start:start+1000],self.namespace))
                    if len(changes)>=50:break
            changes=changes[:50]
            if not changes:return None
            wire=[];accepted=[]
            for change in changes:
                candidate={key:change[key] for key in ('id','kind','base_revision','payload')}
                if change.get('deleted'):candidate.update(deleted=True,delete_confirmed=True)
                if len(json.dumps(wire+[candidate],ensure_ascii=False).encode())>1_990_000:
                    if wire:break
                wire.append(candidate);accepted.append(change)
            result={'request_id':str(uuid4()),'changes':wire,'captures':accepted}
            self.save(db,'outbox',result);return result

    def acknowledge(self,pending,result):
        values=result.get('changes')
        if not isinstance(values,list) or len(values)!=len(pending['changes']):raise CloudError('invalid_sync_receipt')
        indexed={}
        for value in values:
            if not isinstance(value,dict) or not isinstance(value.get('id'),str) or not 0<len(value['id'])<=200 or type(value.get('revision')) is not int or value['revision']<1:raise CloudError('invalid_sync_receipt')
            source=value.get('source_id',value['id'])
            if source in indexed:raise CloudError('invalid_sync_receipt')
            indexed[source]=value
        if set(indexed)!={c['id'] for c in pending['changes']}:raise CloudError('invalid_sync_receipt')
        with self.transaction() as db:
            stored=self.meta(db,'outbox')
            if not stored or fingerprint(stored)!=fingerprint(pending):raise CloudError('sync_outbox_changed',409)
            selected=self.meta(db,'selected',[])
            for capture in pending['captures']:
                receipt=indexed[capture['id']]
                if receipt.get('deleted'):
                    _,recovered=bridge.apply_tombstones(db,[{'id':receipt['id']}],self.namespace)
                    selected=[sid for sid in selected if sid not in recovered]
                    db.execute('INSERT INTO runtime.native_sync_received VALUES(?,?,?,1) ON CONFLICT(namespace,id) DO UPDATE SET revision=MAX(revision,excluded.revision),deleted=1',(self.namespace,receipt['id'],receipt['revision']))
                else:
                    payload = deepcopy(capture['payload'])
                    if receipt.get('branched'):
                        payload.update(branch_of=capture['id'], fork_revision=capture['base_revision'])
                    if 'lineage' in receipt: payload['lineage'] = receipt['lineage']
                    for snapshot in [payload, *[value for message in payload['messages'] for value in (message.get('before'),message.get('after')) if value]]:
                        for key in ('settings','state'):
                            if snapshot.get(key): snapshot[key]['session_id'] = receipt['id']
                    normalized={**capture,'payload':payload}
                    bridge.acknowledge_capture(db,normalized,receipt['id'],receipt['revision'],self.namespace)
            self.save(db,'selected',selected);self.save(db,'outbox',None)

    def receive(self,page):
        cursor,changes=page.get('cursor'),page.get('changes')
        if type(cursor) is not int or cursor<0 or not isinstance(changes,list) or len(changes)>100:raise CloudError('invalid_sync_page')
        with self.transaction() as db:
            if not self.meta(db,'enabled',False):return
            if cursor<self.meta(db,'cursor',0):raise CloudError('stale_sync_page')
            selected=self.meta(db,'selected',[]);excluded=set(self.meta(db,'excluded',[]));links=bridge.Links(db,self.namespace)
            for remote in changes:
                if not isinstance(remote,dict) or not isinstance(remote.get('id'),str) or not 0<len(remote['id'])<=200 or type(remote.get('revision')) is not int or remote['revision']<1 or type(remote.get('deleted')) is not bool:raise CloudError('invalid_sync_entity')
                if remote.get('kind')!='conversation':continue
                known=db.execute('SELECT revision,deleted FROM runtime.native_sync_received WHERE namespace=? AND id=?',(self.namespace,remote['id'])).fetchone()
                if known and known['revision']>=remote['revision']:continue
                if known and known['deleted'] and not remote['deleted']:raise CloudError('sync_deleted_entity_cannot_return')
                if remote['deleted']:
                    _,recovered=bridge.apply_tombstones(db,[remote],self.namespace)
                    selected=[sid for sid in selected if sid not in recovered]
                elif remote['id'] not in excluded:
                    payload=remote.get('payload');value=bridge.validate(payload);documents={}
                    snapshots=payload.get('library_snapshots',{})
                    for ref in bridge.all_references(value):
                        document=snapshots.get(ref['id']+'@'+str(ref['revision']))
                        if not document:raise CloudError('sync_library_revision_missing',409)
                        documents[(ref['id'],ref['revision'])]=document
                    sid=bridge.import_copy(db,remote['id'],remote['revision'],payload,documents,self.namespace)
                    if sid not in selected:selected.append(sid)
                db.execute('INSERT INTO runtime.native_sync_received VALUES(?,?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted',(self.namespace,remote['id'],remote['revision'],int(remote['deleted'])))
            self.save(db,'selected',selected);self.save(db,'cursor',cursor)

    async def run(self):
        if not self.status()['enabled']:return {'phase':'off'}
        with self.transaction():pass
        await self.verify()
        await self.settle_withdrawn()
        pending=self.stage()
        if pending and pending.get('withdrawn'):
            await self.settle_withdrawn();pending=self.stage()
        if pending:
            try:result=await self.remote('/sync',body={key:pending[key] for key in ('request_id','changes')})
            except CloudError as exc:
                if exc.code=='sync_revision_conflict' and any(c.get('deleted') for c in pending['changes']):raise CloudError('sync_delete_reconfirmation_required',409) from exc
                raise
            self.acknowledge(pending,result)
        for _ in range(20):
            status=self.status()
            if not status['enabled']:return {'phase':'off'}
            page=await self.remote('/sync?cursor='+str(status['cursor']))
            self.receive(page)
            if not page.get('has_more'):break
        return {'phase':'saved',**self.status()}
