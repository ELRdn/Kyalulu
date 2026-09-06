"""BYAF v1 adapter, verified against upstream 7ebf2fdb (2026-09-06)."""
import copy
import json
import posixpath
import re
from datetime import datetime
from .portable_schema import PortableDocument, PortableHistory, PortableProfile, ImportNotice
from .portable_binary import safe_open_zip


def parse_byaf(filename, raw, assets):
    from .portable_formats import _store_asset
    files = safe_open_zip(raw)
    def read(path):
        if not isinstance(path, str) or path not in files:
            raise ValueError('BYAF manifest references a missing file')
        value = json.loads(files[path].decode('utf-8-sig'))
        if not isinstance(value, dict) or value.get('schemaVersion') != 1:
            raise ValueError('BYAF requires schemaVersion 1')
        return value
    def required(value, fields):
        for key, typ in fields.items():
            if key not in value or not isinstance(value[key], typ):
                raise ValueError(f'BYAF field {key} is missing or invalid')
    def timestamp(text):
        if not isinstance(text, str):
            raise ValueError('BYAF timestamp must be a string')
        dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            raise ValueError('BYAF timestamp must include timezone')
        return dt.timestamp()
    manifest = read('manifest.json')
    required(manifest, {'createdAt': str, 'characters': list, 'scenarios': list})
    timestamp(manifest['createdAt'])
    if len(manifest['characters']) != 1 or not manifest['scenarios']:
        raise ValueError('BYAF v1 requires one character and at least one scenario')
    path = manifest['characters'][0]
    if not isinstance(path, str) or not re.fullmatch(r'characters/[^/]+/character\.json', path):
        raise ValueError('Invalid BYAF character path')
    char = read(path)
    required(char, {'id': str, 'name': str, 'displayName': str, 'persona': str, 'isNSFW': bool, 'createdAt': str, 'updatedAt': str, 'loreItems': list, 'images': list})
    if char['id'] != path.split('/')[1]:
        raise ValueError('BYAF character ID and directory differ')
    timestamp(char['createdAt']); timestamp(char['updatedAt'])
    char_assets = []
    for i, image in enumerate(char['images']):
        required(image, {'path': str, 'label': str})
        if not re.fullmatch(r'images/[^/]+\.(?:png|jpg|jpeg|webp|gif)', image['path'], re.I):
            raise ValueError('Invalid BYAF image path')
        ref = posixpath.join(posixpath.dirname(path), image['path'])
        if ref not in files:
            raise ValueError(f'BYAF image missing: {ref}')
        char_assets.append(_store_asset(assets, files[ref], ref, image['label'], 'icon' if i == 0 else 'emotion'))
    lore = []
    for index, entry in enumerate(char['loreItems']):
        required(entry, {'key': str, 'value': str})
        lore.append({'keys': [entry['key']], 'content': entry['value'], 'enabled': True,
                     'insertion_order': index, 'use_regex': False, 'extensions': {}})
    docs = []
    for path in manifest['scenarios']:
        if not isinstance(path, str) or not re.fullmatch(r'scenarios/[^/]+\.json', path):
            raise ValueError('Invalid BYAF scenario path')
        scenario = read(path)
        required(scenario, {'formattingInstructions': str, 'minP': (int, float), 'minPEnabled': bool,
            'temperature': (int, float), 'repeatPenalty': (int, float), 'repeatLastN': (int, float),
            'topK': (int, float), 'topP': (int, float), 'exampleMessages': list, 'canDeleteExampleMessages': bool,
            'firstMessages': list, 'narrative': str, 'messages': list})
        if 'promptTemplate' not in scenario or 'grammar' not in scenario or len(scenario['firstMessages']) > 1:
            raise ValueError('Invalid BYAF scenario formatting or firstMessages')
        title = scenario.get('title') or posixpath.basename(path)[:-5]
        notices = [ImportNotice(path='byaf', status='converted', reason='BYAF v1 character and scenario combined; source retained')]
        for key in ('promptTemplate', 'grammar'):
            if scenario.get(key):
                notices.append(ImportNotice(path='scenario.' + key, status='preserved', reason='Model-specific formatting is stored, not executed'))
        settings = {dest: scenario[src] for src, dest in {'temperature': 'temperature', 'repeatPenalty': 'repeat_penalty',
            'repeatLastN': 'repeat_last_n', 'topK': 'top_k', 'topP': 'top_p'}.items()}
        if scenario['minPEnabled']:
            settings['min_p'] = scenario['minP']
        examples = []
        for example in scenario['exampleMessages']:
            required(example, {'characterID': str, 'text': str})
            examples.append(('{{char}}' if example['characterID'] == char['id'] else '{{user}}') + ': ' + example['text'])
        first = ''
        if scenario['firstMessages']:
            greeting = scenario['firstMessages'][0]
            required(greeting, {'characterID': str, 'text': str})
            if greeting['characterID'] != char['id']:
                raise ValueError('BYAF greeting references an unknown character')
            first = greeting['text']
        messages = []
        for index, message in enumerate(scenario['messages']):
            role = message.get('type')
            if role == 'human':
                required(message, {'text': str, 'createdAt': str, 'updatedAt': str})
                chosen = message
            elif role == 'ai':
                outputs = message.get('outputs')
                if not isinstance(outputs, list) or not outputs:
                    raise ValueError('BYAF AI message has no outputs')
                for output in outputs:
                    required(output, {'text': str, 'createdAt': str, 'updatedAt': str, 'activeTimestamp': str})
                chosen = max(enumerate(outputs), key=lambda pair: (timestamp(pair[1]['activeTimestamp']), pair[0]))[1]
            else:
                raise ValueError('BYAF history contains an unsupported message type')
            timestamp(chosen['createdAt']); timestamp(chosen['updatedAt'])
            messages.append({'role': 'user' if role == 'human' else 'assistant', 'content': chosen['text'],
                'created_at': chosen['createdAt'], 'origin': {'source': 'byaf', 'scenario': path, 'index': index,
                    'original': copy.deepcopy(message), 'selected_active_timestamp': chosen.get('activeTimestamp')}})
        doc_assets = copy.deepcopy(char_assets)
        if scenario.get('backgroundImage'):
            ref = scenario['backgroundImage']
            candidates = [ref, posixpath.join(posixpath.dirname(path), ref)]
            found = next((candidate for candidate in candidates if candidate in files), None)
            if not found:
                raise ValueError('BYAF background image missing')
            doc_assets.append(_store_asset(assets, files[found], ref, title, 'background'))
        docs.append(PortableDocument(name=(char['displayName'] or char['name']) + (f' · {title}' if len(manifest['scenarios']) > 1 else ''),
            data={'name': char['name'], 'nickname': char['name'], 'description': char['persona'], 'scenario': scenario['narrative'],
                  'first_mes': first, 'mes_example': '\n'.join(examples), 'creator': (manifest.get('author') or {}).get('name', ''),
                  'character_book': {'entries': lore, 'extensions': {}}}, nsfw=char['isNSFW'],
            profile=PortableProfile(settings=settings, system_prompt=scenario['formattingInstructions'], model_hint=scenario.get('model', '')),
            assets=doc_assets, histories=[PortableHistory(name=title, messages=messages)] if messages else [], source_format='byaf',
            source={'original': {'manifest': manifest, 'character': char, 'scenario': scenario}, 'scenario_path': path,
                    'spec_revision': '7ebf2fdbb06a36b4f900a8de45480c4a2965df03'}, notices=notices))
    return docs, assets
