"""Append-only Runtime projections. Sync never replaces an existing conversation."""
import json
import re
from copy import deepcopy
from uuid import uuid4
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from python.cloud.store import CloudError, fingerprint
from python.core.portable_schema import LibraryBinding, PortableDocument
from python.core.schemas import RuntimeState


class WireMessage(BaseModel):
    model_config = ConfigDict(extra='allow', strict=True)
    id: int = Field(gt=0, le=2**53 - 1)
    uuid: str = Field(min_length=1, max_length=200)
    revision: int = Field(default=1, ge=1)
    role: Literal['user', 'assistant', 'system']
    content: str = Field(max_length=128000)
    model_id: str | None = Field(default=None, max_length=200)
    created_at: str = Field(default='', max_length=100)
    before: 'WireSnapshot | None' = None
    after: 'WireSnapshot | None' = None


class WireSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    session_id: str = Field(max_length=200)
    system_prompt: str = Field(default='', max_length=128000)
    temperature: float = Field(default=.8, ge=0, le=2, allow_inf_nan=False)
    character_id: str | None = Field(default=None, max_length=200)
    persona_id: str | None = Field(default=None, max_length=200)
    world_id: str | None = Field(default=None, max_length=200)
    intro: str = Field(default='', max_length=32000)
    library_binding: LibraryBinding | None = None


class WireMemory(BaseModel):
    model_config = ConfigDict(extra='allow', strict=True)
    id: str = Field(min_length=1, max_length=200)
    uuid: str | None = Field(default=None, min_length=1, max_length=200)
    type: Literal['semantic', 'episodic', 'relationship']
    content: str = Field(min_length=1, max_length=200)
    version: int = Field(default=1, ge=1)
    status: Literal['active', 'deleted'] = 'active'
    origin: str = Field(default='manual', max_length=100)
    supported: bool | None = None
    source_session_id: str | None = Field(default=None, max_length=200)
    source_turn: int | None = Field(default=None, ge=0)
    source_message_ids: list[int] = Field(default_factory=list, max_length=1000)
    source_kind: Literal['user_statement', 'user_correction', 'work_setting', 'story_event'] = 'user_statement'
    source_quote: str = Field(default='', max_length=128000)
    confirmation: str = Field(default='unverified', max_length=100)


class WireSnapshot(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    state: RuntimeState
    memories: list[WireMemory] = Field(default_factory=list, max_length=50000)
    settings: WireSettings | None = None


WireMessage.model_rebuild()


class WireSummary(BaseModel):
    model_config = ConfigDict(extra='allow')
    id: str = Field(min_length=1, max_length=300)
    kind: Literal['chapter', 'arc']
    ordinal: int = Field(ge=0)
    text: str = Field(max_length=128000)
    revision: int = Field(default=1, ge=1)
    source_message_ids: list[int] = Field(max_length=50000)
    method: str = Field(default='extractive', max_length=100)


class WireConversation(BaseModel):
    model_config = ConfigDict(extra='allow', strict=True)
    storage_policy: Literal['sync']
    rating: Literal['general'] = 'general'
    settings: WireSettings
    messages: list[WireMessage] = Field(default_factory=list, max_length=50000)
    memories: list[WireMemory] = Field(default_factory=list, max_length=50000)
    summaries: list[WireSummary] = Field(default_factory=list, max_length=5000)
    state: RuntimeState
    memory_enabled: bool = False


def validate(payload):
    try:
        value = WireConversation.model_validate(payload)
    except ValidationError as exc:
        raise CloudError('invalid_sync_conversation') from exc
    ids = {m.id for m in value.messages}
    if len(ids) != len(value.messages) or len({m.uuid for m in value.messages}) != len(ids):
        raise CloudError('duplicate_sync_message')
    if len({m.id for m in value.memories}) != len(value.memories):
        raise CloudError('duplicate_sync_memory')
    if len({(s.kind, s.ordinal) for s in value.summaries}) != len(value.summaries):
        raise CloudError('duplicate_sync_summary')
    if any(set(item.source_message_ids) - ids for item in [*value.memories, *value.summaries]):
        raise CloudError('invalid_sync_sources')
    positions = {message.id: index for index, message in enumerate(value.messages)}
    for index, message in enumerate(value.messages):
        if message.before is None and message.after is None:continue
        if message.role!='assistant' or message.before is None or message.after is None:
            raise CloudError('invalid_sync_history_snapshot')
        if message.before.state.turn<0 or message.after.state.turn!=message.before.state.turn+1:
            raise CloudError('invalid_sync_history_snapshot')
        for name,snapshot in [('before',message.before),('after',message.after)]:
            if len({memory.uuid or memory.id for memory in snapshot.memories})!=len(snapshot.memories):
                raise CloudError('duplicate_sync_memory')
            if any(source not in positions or positions[source]>(index-1 if name=='before' else index) for memory in snapshot.memories for source in memory.source_message_ids):
                raise CloudError('invalid_sync_sources')
            if any(memory.source_turn is not None and memory.source_turn>snapshot.state.turn for memory in snapshot.memories):
                raise CloudError('invalid_sync_sources')
    return value


class Links:
    """A native PC shares one DB, so each enrolled account needs its own mapping."""
    def __init__(self, db, namespace=None):
        if namespace is not None and not re.fullmatch(r'[a-f0-9]{64}',namespace):
            raise CloudError('invalid_sync_namespace')
        self.db,self.namespace=db,namespace
        self.table='runtime.unified_native_links' if namespace else 'runtime.unified_runtime_links'
        self.clause=' AND namespace=?' if namespace else ''
        self.args=(namespace,) if namespace else ()

    def prepare(self):
        if self.namespace:
            self.db.execute('CREATE TABLE IF NOT EXISTS runtime.unified_native_links(namespace TEXT,session_id TEXT,entity_id TEXT,revision INTEGER,baseline TEXT,mapping TEXT,PRIMARY KEY(namespace,session_id),UNIQUE(namespace,entity_id,revision))')
            self.db.execute('CREATE TABLE IF NOT EXISTS runtime.unified_native_owners(session_id TEXT PRIMARY KEY,namespace TEXT NOT NULL)')
        else:
            self.db.execute('CREATE TABLE IF NOT EXISTS runtime.unified_runtime_links(session_id TEXT PRIMARY KEY,entity_id TEXT,revision INTEGER,baseline TEXT,mapping TEXT,UNIQUE(entity_id,revision))')

    def session(self,sid):
        return self.db.execute(f'SELECT * FROM {self.table} WHERE session_id=?'+self.clause,(sid,)+self.args).fetchone()

    def version(self,entity_id,revision):
        return self.db.execute(f'SELECT * FROM {self.table} WHERE entity_id=? AND revision=?'+self.clause,(entity_id,revision)+self.args).fetchone()

    def entity(self,entity_id):
        return self.db.execute(f'SELECT * FROM {self.table} WHERE entity_id=?'+self.clause,(entity_id,)+self.args).fetchall()

    def put(self,sid,entity_id,revision,baseline,mapping):
        self.claim(sid)
        columns='namespace,session_id,entity_id,revision,baseline,mapping' if self.namespace else 'session_id,entity_id,revision,baseline,mapping'
        conflict='namespace,session_id' if self.namespace else 'session_id'
        values=self.args+(sid,entity_id,revision,baseline,json.dumps(mapping))
        self.db.execute(f'INSERT INTO {self.table}({columns}) VALUES('+','.join('?' for _ in values)+f') ON CONFLICT({conflict}) DO UPDATE SET entity_id=excluded.entity_id,revision=excluded.revision,baseline=excluded.baseline,mapping=excluded.mapping',values)

    def claim(self,sid):
        if not self.namespace:return
        row=self.db.execute('SELECT namespace FROM runtime.unified_native_owners WHERE session_id=?',(sid,)).fetchone()
        if row and row[0]!=self.namespace:raise CloudError('sync_account_copy_required',409)
        self.db.execute('INSERT OR IGNORE INTO runtime.unified_native_owners VALUES(?,?)',(sid,self.namespace))


def prepare(db,namespace=None):
    Links(db,namespace).prepare()
    if db.execute("SELECT 1 FROM runtime.generations WHERE status='pending' LIMIT 1").fetchone():
        raise CloudError('stop_generation_before_sync', 409)


def apply_tombstones(db, tombstones,namespace=None):
    """Confirmed erasures affect unchanged copies; unexported edits stay local."""
    from python.local_backup import erase_conversations
    deleted, recovered = [], []
    links=Links(db,namespace)
    for tombstone in tombstones:
        for link in links.entity(tombstone['id']):
            sid = link['session_id']
            already = db.execute('SELECT 1 FROM runtime.session_deletions WHERE session_id=?', (sid,)).fetchone()
            mapping = json.loads(link['mapping'])
            if not already and fingerprint(export_session(db, sid, link['entity_id'], mapping)) != link['baseline']:
                mapping.update(recovery_from=link['entity_id'], projection=False)
                links.put(sid,str(uuid4()),0,'',mapping)
                recovered.append(sid)
            else:
                deleted.append(sid)
    erase_conversations(db, deleted, schema='runtime')
    return deleted, recovered


def references(settings):
    binding = settings.get('library_binding') or {}
    return [ref for key, value in binding.items() for ref in (value if key == 'lorebooks' else [value])
            if isinstance(ref, dict) and 'id' in ref]


def all_references(value):
    settings = [value.settings] + [snapshot.settings for message in value.messages
        for snapshot in (message.before,message.after) if snapshot and snapshot.settings]
    return list({(ref['id'],ref['revision']):ref for item in settings for ref in references(item.model_dump())}.values())


def creator_references(settings):
    from .creator import REF
    for kind in ('persona', 'world'):
        reference = settings.get(kind + '_id')
        if not reference or not reference.startswith('created_'):
            continue
        match = REF.fullmatch(reference)
        if not match or not 1 <= int(match[2]) <= 2**53 - 1:
            raise CloudError('invalid_sync_setting_reference')
        yield kind, reference, match[1], int(match[2])


async def copy_branch_links(db, source, target, message_ids, memory_ids, summary_ids):
    """Retain canonical identities without enrolling a new branch for upload."""
    for table in ('unified_runtime_links', 'unified_native_links'):
        if not await (await db.execute("SELECT 1 FROM sqlite_master WHERE name=?", (table,))).fetchone():
            continue
        rows = await (await db.execute(f'SELECT * FROM {table} WHERE session_id=?', (source,))).fetchall()
        for row in rows:
            parent = json.loads(row['mapping'])
            mapped = parent.setdefault('messages', {})
            next_id = max((item['id'] for item in mapped.values()), default=0)
            for old in message_ids:
                if str(old) not in mapped:
                    message = await (await db.execute('SELECT role,content,model_id FROM chat_history WHERE id=? AND session_id=?', (old, source))).fetchone()
                    next_id += 1
                    mapped[str(old)] = {'id': next_id, 'uuid': str(uuid4()), 'revision': 1, 'digest': fingerprint(list(message))}
            mapped_memories = parent.setdefault('memories', {})
            for old in memory_ids:
                if old in mapped_memories:
                    continue
                memory = await (await db.execute('SELECT source_revision FROM memories WHERE id=?', (old,))).fetchone()
                try: provenance = json.loads(memory[0] or 'null') if memory else None
                except (ValueError, TypeError): provenance = None
                provenance = provenance if isinstance(provenance, dict) else {}
                stable = provenance.get('memory_uuid') or provenance.get('memory_id') or str(uuid4())
                mapped_memories[old] = {'id': provenance.get('memory_id', stable), 'uuid': stable,
                    'source_session_id': provenance.get('source_session_id', row['entity_id'])}
            mapped_summaries = parent.setdefault('summaries', {})
            for old in summary_ids:
                mapped_summaries.setdefault(old, str(uuid4()))
            copied = deepcopy(parent)
            copied['messages'] = {str(new): deepcopy(mapped[str(old)]) for old, new in message_ids.items()}
            copied['memories'] = {new: deepcopy(mapped_memories[old]) for old, new in memory_ids.items()}
            copied['summaries'] = {new: mapped_summaries[old] for old, new in summary_ids.items()}
            copied['lineage'] = {'branch_of': row['entity_id'], 'fork_revision': row['revision'],
                'fork_message_uuid': mapped[str(next(reversed(message_ids)))]['uuid']}
            namespace = row['namespace'] if table == 'unified_native_links' else None
            clause, args = (' AND namespace=?', (namespace,)) if namespace else ('', ())
            await db.execute(f'UPDATE {table} SET mapping=? WHERE session_id=?' + clause, (json.dumps(parent), source) + args)
            entity_id = str(uuid4())
            if namespace:
                await db.execute('INSERT INTO unified_native_owners VALUES(?,?)', (target, namespace))
                await db.execute(f'INSERT INTO {table} VALUES(?,?,?,?,?,?)', (namespace, target, entity_id, 0, '', json.dumps(copied)))
            else:
                await db.execute(f'INSERT INTO {table} VALUES(?,?,?,?,?)', (target, entity_id, 0, '', json.dumps(copied)))


def creator_document(snapshot, kind):
    from python.api.creator import Document
    try:
        if not isinstance(snapshot, dict) or snapshot.get('kind') != kind:
            raise ValueError('kind')
        return Document.model_validate(snapshot.get('document')).model_dump()
    except (ValidationError, ValueError) as exc:
        raise CloudError('invalid_sync_setting') from exc


def import_copy(db, entity_id, revision, payload, documents,namespace=None):
    """Insert a separate, replay-safe copy; original rows and IDs remain unchanged."""
    value = validate(payload)
    links=Links(db,namespace)
    old = links.version(entity_id,revision)
    if old:
        return old['session_id']
    sid = 'sync_' + uuid4().hex
    settings = value.settings.model_dump()
    historical_settings = {(message.id,name):snapshot.settings.model_dump() for message in value.messages
        for name,snapshot in [('before',message.before),('after',message.after)] if snapshot and snapshot.settings}
    setting_sources=[settings,*historical_settings.values()]
    library_map = {}
    for source in setting_sources:
        for ref in references(source):
            key = (ref['id'], ref['revision'])
            if key not in documents:
                raise CloudError('sync_library_revision_missing', 409)
            document = PortableDocument.model_validate(documents[key])
            if document.assets or document.nsfw:
                raise CloudError('sync_media_or_adult_adapter_required', 503)
            native = library_map.setdefault(ref['id'], 'lib_' + uuid4().hex)
            db.execute('INSERT OR IGNORE INTO runtime.library_versions(id,revision,document_json) VALUES(?,?,?)',
                       (native, ref['revision'], document.model_dump_json()))
            if source['character_id'] == ref['id']:
                source['character_id'] = native
            ref['id'] = native
    creators = {}
    snapshots = payload.get('creator_snapshots', {})
    if not isinstance(snapshots, dict):
        raise CloudError('invalid_sync_setting')
    historical_states = [snapshot.state.model_dump() for message in value.messages for snapshot in (message.before,message.after) if snapshot]
    seen_creators, creator_kinds = set(), {}
    for source in [*setting_sources,*historical_states]:
        for kind, reference, asset_id, source_revision in list(creator_references(source)):
            if asset_id in creator_kinds and creator_kinds[asset_id]!=kind:
                raise CloudError('invalid_sync_setting_identity')
            if reference not in seen_creators:
                seen_creators.add(reference)
                if reference not in snapshots:
                    raise CloudError('sync_setting_revision_missing', 409)
                document = creator_document(snapshots[reference], kind)
                creator_kinds[asset_id]=kind
                native = creators.setdefault(asset_id, 'created_' + uuid4().hex)
                db.execute('INSERT INTO runtime.creator_versions(asset_id,revision,kind,document_json) VALUES(?,?,?,?)',
                           (native, source_revision, kind, json.dumps(document, ensure_ascii=False)))
            if any(source is item for item in setting_sources):source[kind + '_id'] = creators[asset_id] + '@' + str(source_revision)
    db.execute('INSERT INTO runtime.session_settings(session_id,system_prompt,temperature,character_id,persona_id,world_id,intro,library_binding) VALUES(?,?,?,?,?,?,?,?)',
               (sid, settings['system_prompt'], settings['temperature'], settings['character_id'], settings['persona_id'], settings['world_id'], settings['intro'], json.dumps(settings['library_binding'])))
    ids, message_map = {}, {}
    for message in value.messages:
        cursor = db.execute('INSERT INTO runtime.chat_history(session_id,role,content,model_id,created_at) VALUES(?,?,?,?,?)',
                            (sid, message.role, message.content, message.model_id, message.created_at))
        ids[message.id] = cursor.lastrowid
        message_map[str(cursor.lastrowid)] = {'id': message.id, 'uuid': message.uuid, 'revision': message.revision,
                                             'digest': fingerprint([message.role, message.content, message.model_id])}
        db.execute('INSERT INTO runtime.imported_history VALUES(?,?)', (cursor.lastrowid, json.dumps({'format': 'unified', 'entity_id': entity_id, 'message_uuid': message.uuid, 'legacy_id': message.id})))
    state = value.state.model_dump(); state['session_id'] = sid
    for field in ('character_id', 'persona_id', 'world_id'):
        if settings.get(field):
            state[field] = settings[field]
    db.execute('INSERT INTO runtime.runtime_states VALUES(?,?)', (sid, json.dumps(state)))
    db.execute('INSERT INTO runtime.session_memory(session_id,enabled) VALUES(?,?)', (sid, int(value.memory_enabled)))
    db.execute("INSERT INTO runtime.session_scopes VALUES(?,?,'branch','{}')", (sid, 'session:' + sid))
    memory_map = {}
    for memory in value.memories:
        mid = 'mem_' + uuid4().hex[:12]
        provenance = json.dumps({'entity_id': entity_id, 'memory_id': memory.id, 'memory_uuid': memory.uuid or memory.id, 'source_session_id': memory.source_session_id})
        db.execute('INSERT INTO runtime.memories(id,scope,type,content,origin,supported,source_session_id,source_turn,version,status,source_kind,source_quote,source_revision,source_message_ids,confirmation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                   (mid, 'session:' + sid, memory.type, memory.content, memory.origin, memory.supported, sid, memory.source_turn,
                    memory.version, memory.status, memory.source_kind, memory.source_quote, provenance,
                    json.dumps([ids[i] for i in memory.source_message_ids]), memory.confirmation))
        memory_map[mid] = {'id': memory.id, 'uuid': memory.uuid or memory.id, 'source_session_id': memory.source_session_id}
    summary_map = {}
    for summary in value.summaries:
        native_id = 'sum_' + uuid4().hex
        text = re.sub(r'\[(\d+):', lambda match: '[' + str(ids.get(int(match[1]), int(match[1]))) + ':', summary.text) if summary.method == 'extractive' else summary.text
        db.execute('INSERT INTO runtime.conversation_summaries VALUES(?,?,?,?,?,?,?,?)',
                   (native_id, sid, summary.kind, text, summary.revision,
                    json.dumps([ids[i] for i in summary.source_message_ids]), summary.method, summary.ordinal))
        summary_map[native_id] = summary.id
    mapping = {'messages': message_map, 'memories': memory_map, 'summaries': summary_map, 'library': library_map, 'creators': creators, 'projection': True,
               'lineage': {key:deepcopy(payload[key]) for key in ('branch_of','fork_revision','fork_message_uuid','lineage') if key in payload}}
    historical_memories = {item['uuid']: native for native,item in memory_map.items()}
    previous_user=None;source_generations={}
    for message in value.messages:
        if message.role=='user':previous_user=ids[message.id]
        if message.before is None:continue
        generation_id='sync_gen_'+uuid4().hex
        source_generations[ids[message.id]]=generation_id
        if previous_user is not None:source_generations[previous_user]=generation_id
        saved = {}
        for name,snapshot in [('before',message.before),('after',message.after)]:
            snapshot_state = snapshot.state.model_dump();snapshot_state['session_id']=sid
            if snapshot_state.get('character_id') in library_map:snapshot_state['character_id']=library_map[snapshot_state['character_id']]
            for field in ('persona_id','world_id'):
                reference=snapshot_state.get(field)
                if reference and reference.startswith('created_'):
                    asset,version=reference.rsplit('@',1);snapshot_state[field]=creators[asset]+'@'+version
            items=[]
            for memory in snapshot.memories:
                stable=memory.uuid or memory.id
                native=historical_memories.setdefault(stable,'mem_'+uuid4().hex[:12])
                memory_map.setdefault(native,{'id':memory.id,'uuid':stable,'source_session_id':memory.source_session_id})
                sources=[ids[i] for i in memory.source_message_ids]
                origins={source_generations.get(i) for i in sources}
                origin=next(iter(origins)) if memory.origin=='model' and len(origins)==1 else None
                items.append({**memory.model_dump(),'id':native,'scope':'session:'+sid,'source_session_id':sid,
                              'source_revision':json.dumps({'entity_id':entity_id,'memory_id':memory.id,'memory_uuid':stable,'source_session_id':memory.source_session_id}),
                              'source_generation_id':origin,'source_message_ids':sources})
            saved[name]={'state':snapshot_state,'memories':items}
            if (message.id,name) in historical_settings:
                saved[name]['settings']={**historical_settings[(message.id,name)],'session_id':sid}
        assistant=ids[message.id]
        record={'generation_id':generation_id,'session_id':sid,'status':'completed','reply':message.content,'full':message.content,
                'user_id':previous_user,'assistant_id':assistant,'state_before':saved['before']['state'],'state':saved['after']['state'],
                'sync_snapshots':saved,'mode':'immersion','reasoning_summary_status':'unsupported'}
        db.execute("INSERT INTO runtime.generations(generation_id,session_id,fingerprint,status,result_json,user_id,assistant_id) VALUES(?,?,'','completed',?,?,?)",
                   (generation_id,sid,json.dumps(record,ensure_ascii=False),previous_user,assistant))
        for memory in value.memories:
            if memory.origin=='model' and memory.source_turn==saved['after']['state']['turn'] and memory.source_message_ids and all(ids[i] in (previous_user,assistant) for i in memory.source_message_ids):
                native=historical_memories[memory.uuid or memory.id]
                db.execute('UPDATE runtime.memories SET source_generation_id=? WHERE id=?',(generation_id,native))
    links.put(sid,entity_id,revision,'',mapping)
    baseline = fingerprint(export_session(db, sid, entity_id, mapping))
    links.put(sid,entity_id,revision,baseline,mapping)
    return sid


def export_session(db, sid, entity_id, mapping):
    settings = {'session_id': entity_id, 'system_prompt': '', 'temperature': .8}
    row = db.execute("SELECT * FROM runtime.session_settings WHERE session_id IN (?, '__global__') ORDER BY CASE WHEN session_id=? THEN 0 ELSE 1 END LIMIT 1", (sid, sid)).fetchone()
    if row:
        settings.update({key: row[key] for key in ('system_prompt', 'temperature', 'character_id', 'persona_id', 'world_id', 'intro')})
        settings['library_binding'] = json.loads(row['library_binding'] or 'null')
    inverse = {native: stable for stable, native in mapping.get('library', {}).items()}
    creator_inverse = {native: stable for stable, native in mapping.get('creators', {}).items()}
    history = {row['assistant_id']:json.loads(row['result_json']) for row in db.execute("SELECT assistant_id,result_json FROM runtime.generations WHERE session_id=? AND valid=1 AND status='completed' AND result_json IS NOT NULL ORDER BY rowid",(sid,))}
    historical_settings = {(mid,name):deepcopy(snapshot['settings']) for mid,result in history.items()
        for name,snapshot in result.get('sync_snapshots',{}).items() if snapshot.get('settings')}
    setting_sources=[settings,*historical_settings.values()]
    historical_states = [snapshot['state'] for result in history.values() for snapshot in result.get('sync_snapshots',{}).values()]
    creator_snapshots, creator_ids = {}, {}
    for source in [*setting_sources,*historical_states]:
        for kind, reference, asset_id, source_revision in list(creator_references(source)):
            if reference not in creator_ids:
                row = db.execute('SELECT kind,document_json FROM runtime.creator_versions WHERE asset_id=? AND revision=?', (asset_id, source_revision)).fetchone()
                if not row or row['kind'] != kind:
                    raise CloudError('sync_setting_revision_missing', 409)
                stable = creator_inverse.get(asset_id, asset_id) + '@' + str(source_revision)
                creator_snapshots[stable] = {'kind': kind, 'document': creator_document({'kind': kind, 'document': json.loads(row['document_json'])}, kind)}
                creator_ids[reference] = stable
            if any(source is item for item in setting_sources):source[kind + '_id'] = creator_ids[reference]
    documents = {}
    for source in setting_sources:
        for ref in references(source):
            row = db.execute('SELECT document_json FROM runtime.library_versions WHERE id=? AND revision=?', (ref['id'], ref['revision'])).fetchone()
            if not row:
                raise CloudError('sync_library_revision_missing', 409)
            stable = inverse.get(ref['id'], ref['id'])
            document = json.loads(row[0])
            if document.get('assets') or document.get('nsfw'):
                raise CloudError('sync_media_or_adult_adapter_required', 503)
            documents[stable + '@' + str(ref['revision'])] = document
            if source.get('character_id') == ref['id']:
                source['character_id'] = stable
            ref['id'] = stable
    messages, ids = [], {}
    mapped = mapping.setdefault('messages', {})
    next_id = max((m['id'] for m in mapped.values()), default=0)
    for row in db.execute('SELECT * FROM runtime.chat_history WHERE session_id=? ORDER BY id', (sid,)).fetchall():
        item = mapped.get(str(row['id']))
        digest = fingerprint([row['role'], row['content'], row['model_id']])
        if not item:
            next_id += 1
            item = {'id': next_id, 'uuid': str(uuid4()), 'revision': 1, 'digest': digest}
        elif item['digest'] != digest:
            item = {**item, 'revision': item['revision'] + 1, 'digest': digest}
        mapped[str(row['id'])] = item
        ids[row['id']] = item['id']
        messages.append({**{k: row[k] for k in ('role', 'content', 'model_id', 'created_at')},
                         **{k: item[k] for k in ('id', 'uuid', 'revision')}})
    memories, memory_map = [], mapping.setdefault('memories', {})
    def wire_memory(row):
        item = dict(row)
        try:provenance=json.loads(item.get('source_revision') or 'null')
        except (ValueError,TypeError):provenance=None
        if not isinstance(provenance,dict) or 'memory_id' not in provenance:provenance={}
        original = memory_map.setdefault(row['id'], {'id':provenance.get('memory_id') or str(uuid4()),
            'uuid':provenance.get('memory_uuid') or provenance.get('memory_id') or item.get('uuid') or str(uuid4()),
            'source_session_id':provenance.get('source_session_id',entity_id)})
        sources=json.loads(row['source_message_ids']) if isinstance(row['source_message_ids'],str) else row['source_message_ids']
        item.update(id=original['id'], uuid=original.get('uuid', original['id']), scope=entity_id, source_session_id=original['source_session_id'],
                    supported=None if row['supported'] is None else bool(row['supported']),
                    source_message_ids=[ids[i] for i in sources if i in ids])
        item.pop('source_generation_id',None)
        return item
    for row in db.execute('SELECT * FROM runtime.memories WHERE source_session_id=? OR (source_session_id IS NULL AND scope=?) ORDER BY rowid', (sid, 'session:' + sid)).fetchall():
        memories.append(wire_memory(row))
    for native,wire in zip(ids,messages):
        for name,snapshot in history.get(native,{}).get('sync_snapshots',{}).items():
            snapshot_state=dict(snapshot['state']);snapshot_state['session_id']=entity_id
            if snapshot_state.get('character_id') in inverse:snapshot_state['character_id']=inverse[snapshot_state['character_id']]
            for field in ('persona_id','world_id'):
                if snapshot_state.get(field) in creator_ids:snapshot_state[field]=creator_ids[snapshot_state[field]]
            wire[name]={'state':snapshot_state,'memories':[wire_memory(memory) for memory in snapshot['memories']]}
            if (native,name) in historical_settings:
                wire[name]['settings']={**historical_settings[(native,name)],'session_id':entity_id}
    summaries, summary_map = [], mapping.setdefault('summaries', {})
    for row in db.execute('SELECT * FROM runtime.conversation_summaries WHERE session_id=? ORDER BY kind,ordinal', (sid,)):
        summaries.append({k: row[k] for k in ('id', 'kind', 'text', 'revision', 'method', 'ordinal')} |
                         {'id': summary_map.setdefault(row['id'], str(uuid4())),
                          'text': re.sub(r'\[(\d+):', lambda match: '[' + str(ids.get(int(match[1]), int(match[1]))) + ':', row['text']) if row['method'] == 'extractive' else row['text'],
                          'source_message_ids': [ids[i] for i in json.loads(row['source_message_ids']) if i in ids]})
    state = db.execute('SELECT state_json FROM runtime.runtime_states WHERE session_id=?', (sid,)).fetchone()
    wire_state = json.loads(state[0]) if state else RuntimeState().model_dump()
    wire_state['session_id'] = entity_id
    if wire_state.get('character_id') in inverse:
        wire_state['character_id'] = inverse[wire_state['character_id']]
    for field in ('persona_id', 'world_id'):
        if wire_state.get(field) in creator_ids:
            wire_state[field] = creator_ids[wire_state[field]]
    enabled = db.execute('SELECT enabled FROM runtime.session_memory WHERE session_id=?', (sid,)).fetchone()
    return {**mapping.get('lineage', {}), 'storage_policy': 'sync', 'rating': 'general', 'settings': settings, 'messages': messages, 'memories': memories,
            'summaries': summaries, 'state': wire_state,
            'memory_enabled': bool(enabled and enabled[0]), 'library_snapshots': documents, 'creator_snapshots': creator_snapshots}


def capture(db, selected,namespace=None):
    """Read only explicitly consented session IDs; there is no all-session fallback."""
    if (not isinstance(selected, list) or len(selected) > 1000 or len(set(selected)) != len(selected)
            or any(not isinstance(sid, str) or not 0 < len(sid) <= 200 or sid.startswith('__') for sid in selected)):
        raise CloudError('invalid_sync_selection')
    result = []
    for sid in selected:
        if db.execute('SELECT 1 FROM runtime.session_deletions WHERE session_id=?', (sid,)).fetchone():
            continue
        if not db.execute('SELECT 1 FROM runtime.session_settings WHERE session_id=? UNION SELECT 1 FROM runtime.chat_history WHERE session_id=? UNION SELECT 1 FROM runtime.runtime_states WHERE session_id=?', (sid, sid, sid)).fetchone():
            raise CloudError('sync_selected_session_missing', 409)
        Links(db,namespace).claim(sid)
        link = Links(db,namespace).session(sid)
        entity_id, revision = (link['entity_id'], link['revision']) if link else (str(uuid4()), 0)
        mapping = json.loads(link['mapping']) if link else {}
        if mapping.get('restored_from_snapshot'):
            raise CloudError('sync_restored_session_confirmation_required', 409)
        payload = export_session(db, sid, entity_id, mapping)
        digest = fingerprint(payload)
        if not link or digest != link['baseline']:
            result.append({'id': entity_id, 'base_revision': revision, 'kind': 'conversation', 'payload': payload,
                           'native_session_id': sid, 'mapping': mapping})
    return result


def acknowledge_capture(db, change, entity_id, revision,namespace=None):
    mapping = deepcopy(change['mapping'])
    mapping['lineage'] = {key:deepcopy(change['payload'][key]) for key in ('branch_of','fork_revision','fork_message_uuid','lineage') if key in change['payload']}
    Links(db,namespace).put(change['native_session_id'],entity_id,revision,fingerprint(change['payload']),mapping)
