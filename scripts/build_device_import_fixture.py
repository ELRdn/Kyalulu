"""Pin native parsing of deterministic JSON/PNG/CHARX/backup inputs."""
import base64
import io
import json
import zipfile
import zlib
import struct

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
    print(f'{len(result)} deterministic native import fixtures')


if __name__ == '__main__': main()
