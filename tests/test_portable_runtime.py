import pytest
from python.core.portable_schema import PortableDocument, PortableProfile, PortableHistory, ImportCommit
from python.core.portable_prompt import compile_portable, select_lore
from python.core.prompt_compiler import compile_prompt
from python.core.schemas import RuntimeState
from python.core.generation import generate_events
from python.storage import library
from python.storage.db import init_db


def character(**changes):
    return PortableDocument(name='シアン', data={'description': '日本語で簡潔に話す案内人',
        'system_prompt': '{{original}}\nStay in character as {{char}}.',
        'post_history_instructions': 'Remember {{user}}.',
        'creator_notes': 'CREATOR_ONLY', 'extensions': {'unknown': {'keep': [1, 2]}},
        'character_book': {'entries': [{'keys': ['鍵'], 'content': '鍵は青い。', 'enabled': True}]},
        **changes})


@pytest.mark.asyncio
async def test_versions_fixed_per_session_and_settings_preserved(isolated):
    from python.api.chat import _save_settings, _load_settings, prepare_generation, ChatRequest
    await init_db()
    first = library.save_item(character())
    await _save_settings('portable', '', 0.6, first.id, _has_char=True)
    saved = await _load_settings('portable')
    assert saved.library_binding.character.revision == 1
    newer = character(description='NEW_REVISION')
    library.save_item(newer, first.id, 1)
    await _save_settings('portable', 'changed global', 0.5)
    prepared = await prepare_generation(ChatRequest(model_id='mock-echo', session_id='portable',
        messages=[{'role': 'user', 'content': '鍵は？'}]))
    compiled = prepared[3]
    assert 'NEW_REVISION' not in compiled.system_prompt
    assert 'Zeta' not in compiled.system_prompt and '獣人' not in compiled.system_prompt
    assert 'CREATOR_ONLY' not in compiled.system_prompt
    assert 'changed global' in compiled.system_prompt


@pytest.mark.asyncio
async def test_conflict_idempotent_import_atomic_rollback_history_origin(isolated):
    await init_db()
    doc = character()
    doc.histories = [PortableHistory(name='以前の会話', messages=[{'role': 'user', 'content': 'こんにちは', 'created_at': '2026-01-01T00:00:00Z'}, {'role': 'assistant', 'content': 'やあ'}])]
    preview = library.preview('original.json', b'original bytes', [doc], {})
    body = ImportCommit(request_id='import-one', selections=[{'index': 0, 'document': doc, 'history_indices': [0]}])
    result = library.commit(preview['preview_id'], body)
    assert library.commit(preview['preview_id'], body) == result
    assert len(library.list_items()) == 1
    sid = result['sessions'][0]['session_id']
    with library.connect() as con:
        assert con.execute('SELECT COUNT(*) FROM chat_history WHERE session_id=?', (sid,)).fetchone()[0] == 2
        assert con.execute('SELECT COUNT(*) FROM generations').fetchone()[0] == 0
        assert con.execute('SELECT COUNT(*) FROM runtime_states').fetchone()[0] == 0
        assert con.execute('SELECT COUNT(*) FROM imported_history').fetchone()[0] == 2
    with pytest.raises(library.LibraryConflict):
        library.commit(preview['preview_id'], body.model_copy(update={'selections': []}))
    bad = ImportCommit(request_id='bad', selections=[{'index': 0, 'document': doc, 'history_indices': [100]}])
    with pytest.raises(ValueError):
        library.commit(preview['preview_id'], bad)
    assert len(library.list_items()) == 1
    with pytest.raises(library.LibraryConflict):
        library.save_item(doc, result['items'][0]['id'], 88)
    assert library.original(preview['source_hash'])[1] == b'original bytes'


def test_lore_recursive_conditions_budget_and_no_loop():
    entries = [
        {'keys': ['鍵'], 'content': '扉', 'insertion_order': 2},
        {'keys': ['扉'], 'content': '鍵', 'insertion_order': 1},
        {'keys': ['鍵'], 'content': 'secret', 'selective': True, 'secondary_keys': ['合言葉']},
        {'keys': ['鍵'], 'content': 'regex', 'use_regex': True},
        {'constant': True, 'content': 'X' * 100, 'priority': -1},
    ]
    selected, audit = select_lore([{'entries': entries, 'recursive_scanning': True, 'token_budget': 10}], [{'content': '鍵'}])
    assert [s['content'] for s in selected] == ['鍵', '扉']
    assert len(audit) == len(entries)
    assert any(a['reason'] == 'unsupported condition' for a in audit)
    assert any(a['reason'] == 'budget exceeded' for a in audit)
    assert select_lore([{'entries': [{'keys': ['HELLO'], 'case_sensitive': True, 'content': 'case'}]}], [{'content': 'hello'}])[0] == []


@pytest.mark.asyncio
async def test_dynamic_lore_same_runtime_snapshots_and_order(isolated):
    from python.providers.mock import MockProvider
    from python.api.chat import _save_settings, prepare_generation, ChatRequest
    await init_db()
    item = library.save_item(character())
    await _save_settings('dynamic', '', .8, item.id, _has_char=True)
    compiled = compile_prompt(item.id)
    results = []
    for question in ('こんにちは', '鍵は？'):
        async for ev in generate_events(MockProvider(), model='echo', messages=[{'role': 'user', 'content': question}],
                                        compiled=compiled, state=RuntimeState(), requested={}):
            if ev['type'] == 'result':
                results.append(ev['result'])
    first, second = results
    assert first['validation']['ok'] and second['validation']['ok']
    assert '鍵は青い。' not in first['raw_prompt']
    assert '鍵は青い。' in second['raw_prompt']
    wire = second['attempts'][0]['messages']
    assert wire[-2] == {'role': 'user', 'content': '鍵は？'}
    assert wire[-1]['content'] == 'Remember User.'
    request = ChatRequest(model_id='mock-echo', session_id='dynamic', messages=[{'role': 'user', 'content': '鍵は？'}])
    prepared = await prepare_generation(request)
    assert prepared[3].sections['portable_snapshot']['document'] == compiled.sections['portable_snapshot']['document']


def test_prompt_manager_macros_overrides_examples_unknown():
    doc = character(mes_example='<START>\n{{user}}: hi\n{{char}}: hello')
    doc.profile = PortableProfile(system_prompt='ORIGINAL', prompts=[
        {'identifier': 'main', 'content': 'GLOBAL'}, {'identifier': 'dialogueExamples', 'marker': True},
        {'identifier': 'custom', 'content': '{{char}} {{getvar::color}} {{unsupported}}', 'role': 'user'},
        {'identifier': 'chatHistory', 'marker': True}, {'identifier': 'jailbreak'}], variables={'color': 'blue'})
    compiled = compile_portable({'document': doc.model_dump()})
    assert compiled.ordered_messages[0]['content'] == 'ORIGINAL\nStay in character as シアン.'
    assert compiled.ordered_messages[1:3] == [{'role': 'user', 'content': 'hi'}, {'role': 'assistant', 'content': 'hello'}]
    assert compiled.ordered_messages[3]['content'] == 'シアン blue {{unsupported}}'
    assert any(n['path'] == 'macro.unsupported' for n in compiled.sections['compatibility'])


@pytest.mark.asyncio
async def test_profile_binding_and_replay_source_survives_edit(isolated):
    from python.core.experiment import run_single
    from python.core.schemas import ScenarioCard
    await init_db()
    item = library.save_item(character())
    scenario = ScenarioCard(id='portable-check', character=item.id, turns=[{'turn': 1, 'user': '鍵は？'}, {'turn': 2, 'user': 'こんにちは'}])
    meta, turns, _ = await run_single(scenario, 'mock-echo')
    assert meta.status == 'completed' and not meta.official
    library.save_item(character(description='CHANGED'), item.id, 1)
    _, rerun, _ = await run_single(scenario, 'mock-echo', compiled_snapshot=turns[0]['compiled'])
    # Each run allocates a new session identity in its runtime contract.
    assert [t['attempts'][0]['messages'][1:] for t in turns] == [t['attempts'][0]['messages'][1:] for t in rerun]
    assert [t['compiled'] for t in turns] == [t['compiled'] for t in rerun]
