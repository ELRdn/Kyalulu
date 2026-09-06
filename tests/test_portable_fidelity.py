"""Regression probes for real layout differences and preservation boundaries."""
import base64
import json
import pytest
from python.core.portable_binary import neutral_png, get_png_texts
from python.core.portable_formats import parse_import
from python.core.portable_export import export_document
from python.core.portable_schema import PortableDocument, PortableProfile
from python.core.prompt_compiler import compile_prompt
from python.core.portable_prompt import compile_portable
from python.storage import library
from python.storage.db import init_db


def parse(value):
    return parse_import('sample.json', json.dumps(value, ensure_ascii=False).encode())


def test_partial_cai_fields_and_opaque_definition():
    definition = '原文\r\nGreeting: This is inside the definition.\r\n  Keep spaces.\r\n'
    docs, _ = parse_import('paste.txt', ('Name: シアン\r\nDescription: 案内人\r\nDefinition: ' + definition).encode())
    assert docs[0].data['definition'] == definition
    assert docs[0].data['first_mes'] == ''
    payload, _, _, _ = export_document(docs[0], 'ccv3-json', {})
    back, _ = parse_import('back.json', payload)
    assert back[0].data['definition'] == definition
    assert definition in compile_portable({'document': back[0].model_dump()}).system_prompt


@pytest.mark.parametrize('fmt', ['ccv3-json', 'ccv3-png', 'charx'])
def test_risu_tuple_assets_stay_single_and_keep_labels_on_roundtrip(fmt):
    uri = 'data:image/png;base64,' + base64.b64encode(neutral_png()).decode()
    doc, assets = parse({'spec': 'chara_card_v3', 'spec_version': '3.0', 'data': {'name': '静的キャラ',
        'extensions': {'future': {'keep': [1, 2]}, 'risuai': {'emotions': [['happy', uri]],
            'defaultVariables': 'color=青\nplace:図書館', 'triggerscript': ['INERT']}}}})
    for _ in range(2):
        payload, _, filename, _ = export_document(doc[0], fmt, assets)
        doc, assets = parse_import(filename, payload)
        emotions = [a for a in doc[0].assets if a.type == 'emotion']
        assert len(emotions) == 1 and emotions[0].name == 'happy'
        assert emotions[0].asset_id in assets
        assert doc[0].data['extensions']['future'] == {'keep': [1, 2]}
        assert doc[0].profile.variables == {'color': '青', 'place': '図書館'}


def test_v2_png_removes_old_v3_metadata_and_required_fields_exist():
    docs, assets = parse({'name': 'Original', 'description': 'old'})
    png, _, _, _ = export_document(docs[0], 'ccv3-png', assets)
    docs, assets = parse_import('old.png', png)
    docs[0].name = 'Edited'
    png, _, _, _ = export_document(docs[0], 'ccv2-png', assets)
    assert 'ccv3' not in get_png_texts(png)
    docs, _ = parse_import('v2.png', png)
    assert docs[0].name == 'Edited'
    assert all(key in docs[0].data for key in ['personality', 'scenario', 'creator', 'creator_notes', 'character_version', 'system_prompt', 'post_history_instructions', 'tags', 'alternate_greetings', 'extensions'])


def test_st_standalone_samplers_context_and_unreferenced_prompt():
    docs, _ = parse({'temperature': .4, 'max_tokens': 123, 'top_p': .9, 'api_key': 'fixture-not-a-secret'})
    assert docs[0].kind == 'profile' and docs[0].profile.settings['max_tokens'] == 123
    assert 'api_key' not in docs[0].profile.settings
    docs, _ = parse({'name': 'Context', 'story_string': '{{description}}', 'chat_start': 'TEXT_ONLY'})
    assert docs[0].profile.context_template == '{{description}}'
    assert any(n.status == 'preserved' for n in docs[0].notices)
    docs, _ = parse({'prompts': [{'identifier': 'main', 'content': 'YES'}, {'identifier': 'unused', 'content': 'NEVER'}],
                     'prompt_order': [{'character_id': 100, 'order': [{'identifier': 'main', 'enabled': True}]}]})
    assert next(p for p in docs[0].profile.prompts if p['identifier'] == 'unused')['enabled'] is False


@pytest.mark.asyncio
async def test_profile_embedded_lore_is_used_and_pinned(isolated):
    await init_db()
    char = library.save_item(PortableDocument(name='キャラ'))
    profile = library.save_item(PortableDocument(kind='profile', name='プリセット',
        profile=PortableProfile(settings={'temperature': .4}),
        data={'character_book': {'entries': [{'constant': True, 'content': 'PROFILE_LORE'}]}}))
    binding = {'character': {'id': char.id, 'revision': 1}, 'profile': {'id': profile.id, 'revision': 1}}
    compiled = compile_prompt(char.id, library_binding=binding)
    assert 'PROFILE_LORE' in compiled.system_prompt
    changed = profile.document.model_copy(deep=True); changed.data['character_book']['entries'][0]['content'] = 'CHANGED'
    library.save_item(changed, profile.id, 1)
    assert compile_prompt(char.id, library_binding=binding) == compiled


def test_reenabling_unsupported_lore_does_not_weaken_conditions():
    from python.core.portable_prompt import select_lore
    docs, _ = parse({'name': 'World', 'entries': {'0': {'key': ['鍵'], 'content': 'DO_NOT_USE',
                         'extensions': {'selectiveLogic': 2}}}})
    entry = docs[0].data['character_book']['entries'][0]
    assert entry['enabled'] is False
    entry['enabled'] = True
    chosen, audit = select_lore([{'entries': [entry]}], [{'content': '鍵'}])
    assert not chosen and audit[0]['reason'] == 'unsupported condition'


@pytest.mark.asyncio
async def test_pinned_intro_and_profile_temperature_are_applied(isolated):
    from python.api.chat import _save_settings, _load_settings, inject_intro
    from python.core.portable_schema import LibraryBinding
    await init_db()
    char = library.save_item(PortableDocument(name='Greeting', data={'first_mes': 'OLD_GREETING'}, profile=PortableProfile(settings={'temperature': .4})))
    await _save_settings('intro', None, None, char.id, _has_char=True)
    assert (await _load_settings('intro')).temperature == .4
    newer = char.document.model_copy(deep=True); newer.data['first_mes'] = 'NEW_GREETING'
    library.save_item(newer, char.id, 1)
    assert (await inject_intro('intro'))['intro'] == 'OLD_GREETING'
    assert (await inject_intro('intro'))['injected'] is False
    profile = library.save_item(PortableDocument(kind='profile', name='Profile', profile=PortableProfile(settings={'temperature': .3})))
    await _save_settings('intro', None, None, library_binding=LibraryBinding(profile={'id': profile.id, 'revision': 1}), _has_binding=True)
    assert (await _load_settings('intro')).temperature == .3


def test_st_original_and_lore_budget_after_static_expansion():
    docs, _ = parse({'prompts': [{'identifier': 'main', 'content': 'GLOBAL'}, {'identifier': 'jailbreak', 'content': 'POST'}],
        'prompt_order': [{'character_id': 100, 'order': [{'identifier': 'main'}, {'identifier': 'jailbreak'}]}]})
    doc = PortableDocument(name='キャラ', profile=docs[0].profile, data={
        'system_prompt': '{{original}} CARD', 'post_history_instructions': '{{original}} END',
        'character_book': {'token_budget': 10, 'entries': [{'constant': True, 'content': '{{getvar::long}}'}]}})
    doc.profile.variables['long'] = 'X' * 1000
    compiled = compile_portable({'document': doc.model_dump()})
    assert compiled.ordered_messages[0]['content'] == 'GLOBAL CARD'
    assert compiled.ordered_messages[1]['content'] == 'POST END'
    assert compiled.sections['lore'][0]['reason'] == 'budget exceeded'
