"""Pin native parsing of deterministic JSON/PNG/CHARX/backup inputs."""
import base64
import io
import json
import zipfile
import zlib
import struct
import sys

from build_device_export_fixture import cases, ROOT
from python.core.portable_export import export_document, FORMATS
from python.core.portable_formats import parse_import
from python.core.portable_binary import neutral_png, parse_png_chunks, _png_chunk, PNG_MAGIC
from python.core.portable_schema import PortableDocument


def fixed_zip(files, compression=zipfile.ZIP_DEFLATED):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, raw in files.items():
            info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.compress_type = compression
            archive.writestr(info, raw)
    return buffer.getvalue()


def inputs():
    for case in cases():
        doc = PortableDocument.model_validate(case['document']).model_dump()
        assets = {key: (base64.b64decode(value['base64']), value['mime']) for key, value in case['assets'].items()}
        for format in FORMATS:
            raw, _, filename, _ = export_document(doc, format, assets)
            if raw[:2] == b'PK':
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    raw = fixed_zip({name: archive.read(name) for name in archive.namelist()})
            yield case['name'] + '/' + format, filename, raw
    card = {'spec': 'chara_card_v3', 'spec_version': '3.0', 'future': {'keep': True}, 'data': {
        'name': 'Risu fixture', 'description': 'Never execute scripts', 'extensions': {'risuai': {
            'staticVariables': {'who': 'reader', 'ignored': 4}, 'defaultVariables': 'place=harbor',
            'scripts': 'throw Error("DO NOT RUN")', 'backgroundHTML': '<script>BAD</script>',
            'emotions': [['calm', 'data:image/png;base64,' + base64.b64encode(neutral_png()).decode()]]}},
        'character_book': {'entries': {'10': {'key': 'harbor,port', 'content': 'sea', 'order': 2},
                                      '2': {'keys': ['reader'], 'content': 'keep', 'extensions': {'selectiveLogic': False, 'timeConditions': []}},
                                      'x': {'keys': ['regex'], 'content': 'disabled', 'use_regex': True}}}}}
    raw = json.dumps(card, ensure_ascii=False).encode()
    yield 'risu/static-and-inert', 'risu.json', raw
    text = b'ccv3\0\x01\x00\0\0' + zlib.compress(base64.b64encode(raw))
    png = PNG_MAGIC + b''.join(_png_chunk(name.encode(), data) for name, data in parse_png_chunks(neutral_png()) if name != 'IEND')
    yield 'png/compressed-itxt', 'compressed.png', png + _png_chunk(b'iTXt', text) + _png_chunk(b'IEND', b'')
    basic = b'{"spec":"chara_card_v3","data":{"name":"Zip variants"}}'
    yield 'zip/cp437', 'cp437.charx', fixed_zip({'card.json': basic, 'cafe.txt': b'keep'}).replace(b'cafe.txt', b'caf\x82.txt')
    yield 'zip/directory-count', 'directories.charx', fixed_zip({**{f'dir{i}/': b'' for i in range(513)}, 'card.json': basic})
    preset = {'name': 'Ordered preset', 'prompts': [{'identifier': 'main', 'content': 'MAIN'}, {'identifier': 'custom', 'role': 'unsupported', 'content': 'Keep me'}, {'identifier': 'unused', 'content': 'OFF'}],
              'prompt_order': [{'character_id': 50, 'order': [{'identifier': 'main'}]}, {'character_id': 100, 'order': [{'identifier': 'custom', 'enabled': False}, {'identifier': 'main'}, {'identifier': 'missing'}]}],
              'temperature': .7, 'rep_pen': 1.1, 'api_key': 'FAKE-DO-NOT-IMPORT', 'api_url': 'https://invalid.test', 'model': 'display-only', 'unknown': 3,
              'worldinfo': {'name': 'World', 'entries': {'2': {'key': 'sea,port', 'content': 'Sea'}, '1': {'key': ['night'], 'content': 'Disabled', 'useProbability': True}}}}
    samples = {
        'st/ordered': preset,
        'st/first-block-fallback': {**preset, 'prompt_order': [{'character_id': 50, 'order': [{'identifier': 'main'}]}]},
        'st/standalone': {'name': 'Standalone', 'generation_settings': {'temp': .2, 'max_tokens': 100, 'proxy_host': 'FAKE'}, 'temperature': .8, 'system_prompt': 'SYS', 'story_string': 'Context', 'post_history_instructions': 'END'},
        'st/world-dictionary': {'name': 'World', 'entries': {'10': {'key': 'sea,port', 'content': 'Sea'}, '2': {'key': 'stars', 'content': 'Night'}}},
        'st/world-array': {'entries': [{'content': 'Always', 'constant': True}]},
        'st/world-null-position': {'entries': {'1': {'key': ['sea'], 'content': 'Unsupported position', 'position': None}, '2': {'key': ['sea'], 'content': 'Disabled', 'enabled': []}}},
        'cai/character': {'name': 'Guide', 'description': 'Public description', 'greeting': 'Hello', 'definition': '{{char}}: Keep exact\r\n', 'creatorNotes': 'NOT PROMPT'},
        'cai/lore-array': [{'comment': 'First', 'key': 'sea,port', 'content': 'Sea'}, {'title': 'Second', 'keys': ['night'], 'content': 'Night', 'enabled': False}],
        'cai/lore-object': {'name': 'Lore', 'entries': [{'key': ['sea'], 'content': 'Sea'}]},
    }
    for name, value in samples.items():
        yield name, name.replace('/', '-') + '.json', json.dumps(value, ensure_ascii=False).encode()
    yield 'cai/pasted-definition', 'paste.txt', b'Name: Guide\r\nDescription: Public\r\nDefinition: exact\r\nGreeting: INSIDE DEFINITION\r\n  Keep spaces.\r\n'
    yield 'cai/pasted-partial', 'partial.txt', b'Name: Guide\nGreeting: Hi\n'
    yield 'cai/lore-text', 'lore.txt', b'Lorebook Name: Book\nEntry Title: Harbor\nKeywords: sea,port\nContent: First\nSecond line\nEntry Title: Night\nContent: Dark\n'
    sys.path.insert(0, str(ROOT / 'tests'))
    from portable_samples import byaf_sample
    byaf, _ = byaf_sample()
    with zipfile.ZipFile(io.BytesIO(byaf)) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    yield 'byaf/two-scenarios', 'pack.byaf', fixed_zip(entries)
    scenario = json.loads(entries['scenarios/forest.json'])
    scenario['messages'][1]['outputs'][0]['activeTimestamp'] = '2026-01-01T00:00:00.123456Z'
    scenario['messages'][1]['outputs'][1]['activeTimestamp'] = '2026-01-01T09:00:00.123455+09:00'
    # Native uses exact stored archive names for backgrounds, never filesystem traversal.
    scenario['backgroundImage'] = 'characters/alice/images/portrait.png'
    entries['scenarios/forest.json'] = json.dumps(scenario).encode()
    yield 'byaf/microsecond-offset-order', 'precise.byaf', fixed_zip(entries)


def media_cases():
    from PIL import Image
    from python.core.portable_assets import accept_media
    result = []
    samples = []
    for format in ('PNG', 'JPEG', 'GIF', 'WEBP'):
        buffer = io.BytesIO()
        Image.new('RGB', (3, 2), (40, 80, 120)).save(buffer, format)
        samples.append((format.lower(), buffer.getvalue()))
    samples.append(('wav', base64.b64decode(cases()[2]['assets'][next(id for id, asset in cases()[2]['assets'].items() if asset['mime'] == 'audio/wav')]['base64'])))
    box = lambda kind, data: struct.pack('>I', len(data) + 8) + kind + data
    samples.append(('mp4-container', box(b'ftyp', b'isom\0\0\0\0') + box(b'moov', b'') + box(b'mdat', b'\0')))
    samples += [('svg', b'<svg onload="BAD"/>'), ('wav-truncated', samples[-2][1][:-1])]
    corrupt = PNG_MAGIC + b''.join(_png_chunk(name.encode(), b'NOT ZLIB' if name == 'IDAT' else data) for name, data in parse_png_chunks(neutral_png()))
    samples.append(('png-invalid-decoder', corrupt))
    huge = PNG_MAGIC + b''.join(_png_chunk(name.encode(), struct.pack('>II', 32_000_001, 1) + data[8:] if name == 'IHDR' else data) for name, data in parse_png_chunks(neutral_png()))
    samples.append(('png-over-pixels', huge))
    samples.append(('mp4-external', box(b'ftyp', b'isom\0\0\0\0') + box(b'moov', box(b'dinf', box(b'dref', b'\0\0\0\0\0\0\0\1' + box(b'url ', b'\0\0\0\0https://invalid.test/')))) + box(b'mdat', b'\0')))
    for name, raw in samples:
        try:
            id, mime = accept_media(raw)
            expected = {'id': id, 'mime': mime}
        except ValueError:
            expected = None
        result.append({'name': name, 'base64': base64.b64encode(raw).decode(), 'expected': expected})
    return result


def main():
    result = []
    for name, filename, raw in inputs():
        documents, assets = parse_import(filename, raw)
        result.append({'name': name, 'filename': filename, 'base64': base64.b64encode(raw).decode(),
                       'documents': [doc.model_dump() for doc in documents],
                       'assets': {id: {'base64': base64.b64encode(value[0]).decode(), 'mime': value[1]} for id, value in assets.items()}})
    path = ROOT / 'tests/fixtures/device-imports.json'
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (ROOT / 'tests/fixtures/device-media.json').write_text(json.dumps(media_cases(), indent=2) + '\n', encoding='utf-8')
    from python.core.portable_prompt import select_lore
    books = [{'recursive_scanning': {}, 'entries': [
        {'enabled': None, 'constant': True, 'content': 'MUST NOT INJECT'},
        {'enabled': 0, 'constant': True, 'content': 'MUST NOT INJECT'},
        {'constant': [], 'content': 'MUST NOT INJECT'},
        {'keys': ['SEA'], 'case_sensitive': {}, 'content': 'Stars'},
        {'keys': ['sea'], 'selective': {}, 'content': 'Allowed'},
        {'constant': True, 'position': None, 'content': 'MUST NOT INJECT'},
        {'keys': ['Stars'], 'content': 'MUST NOT RECURSE'}]}]
    history = [{'role': 'user', 'content': 'sea'}]
    selected, audit = select_lore(books, history)
    (ROOT / 'tests/fixtures/device-lore-values.json').write_text(json.dumps({'books': books, 'history': history, 'expected': {'selected': selected, 'audit': audit}}, indent=2) + '\n', encoding='utf-8')
    print(f'{len(result)} deterministic native import fixtures')


if __name__ == '__main__': main()
