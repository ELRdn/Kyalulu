"""Pin native export semantics for the independent browser implementation."""
import base64
import io
import json
from pathlib import Path
import zipfile

from python.core.portable_binary import build_png_with_text, get_png_texts, neutral_png, parse_png_chunks
from python.core.portable_export import export_document, FORMATS
from python.core.portable_schema import PortableDocument

ROOT = Path(__file__).resolve().parents[1]


def decode_output(raw, mime):
    if mime == 'application/json': return {'json': json.loads(raw)}
    if mime == 'application/zip':
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            return {'files': {name: {'json': json.loads(archive.read(name))} if name.endswith('.json')
                              else {'base64': base64.b64encode(archive.read(name)).decode()} for name in archive.namelist()}}
    texts = get_png_texts(raw)
    return {'png': {'texts': {key: {'json': json.loads(base64.b64decode(value))} if key in ('ccv3', 'chara')
                             else {'text': value} for key, value in texts.items()},
                    'image_chunks': [{'name': name, 'base64': base64.b64encode(data).decode()}
                                     for name, data in parse_png_chunks(raw) if name not in ('tEXt', 'iTXt', 'zTXt')]}}


def cases():
    import hashlib
    import wave
    picture = build_png_with_text(neutral_png(), {'chara': 'old-card', 'author': 'retain-author', 'chara-ext-asset_:old': 'remove'})
    sound = io.BytesIO()
    with wave.open(sound, 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000); audio.writeframes(b'\0' * 16)
    sound = sound.getvalue()
    png_id, sound_id = hashlib.sha256(picture).hexdigest(), hashlib.sha256(sound).hexdigest()
    return [
        {'name': 'minimal-neutral-portrait', 'document': {'name': '案内 星🌸'}, 'assets': {}},
        {'name': 'profile-and-unknown-fields', 'document': {
            'name': 'Preset / library', 'kind': 'profile', 'speaking_style': '簡潔に話す',
            'data': {'personality': 'calm', 'description': 'guide', 'definition': '人物の定義',
                     'nickname': 'Rei', 'creator_notes_multilingual': {'ja': '注記'},
                     'extensions': {'future': {'keep': [1, 2]}}, 'attached_profile_lore': [{'content': 'known'}],
                     'character_book': {'entries': [{'keys': ['海'], 'content': '港'}]}},
            'profile': {'settings': {'temperature': .5}, 'system_prompt': 'PROFILE', 'post_history_instructions': 'AFTER',
                        'context_template': '{{system}}', 'prompts': [{'id': 'main'}], 'variables': {'mood': 'calm'}},
            'histories': [{'name': 'private fixture', 'messages': [{'role': 'user', 'content': 'not in cards'}]}],
            'source': {'top_unknown': {'future_field': {'value': 7}}},
            'notices': [{'path': 'future_script', 'status': 'preserved', 'reason': 'Never execute source scripts'}]}, 'assets': {}},
        {'name': 'png-and-audio-assets', 'document': {
            'name': 'Assets', 'data': {'extensions': {'future': {'face': 'embeded://old.png', 'sound': 'old-sound'}}},
            'assets': [{'name': 'portrait', 'type': 'icon', 'uri': 'embeded://old.png', 'media_type': 'image/png', 'asset_id': png_id},
                       {'name': 'music', 'type': 'audio', 'uri': 'old-sound', 'media_type': 'audio/wav', 'asset_id': sound_id, 'rights_confirmed': True},
                       {'name': 'remote-reference', 'uri': 'https://invalid.test/never-fetch.png', 'media_type': 'image/png'}]},
         'assets': {png_id: {'base64': base64.b64encode(picture).decode(), 'mime': 'image/png'},
                    sound_id: {'base64': base64.b64encode(sound).decode(), 'mime': 'audio/wav'}}},
        {'name': 'unknown-profile-values', 'document': {'name': 'Lore', 'kind': 'lorebook', 'profile': {'variables': {'名': '星'}, 'future': {'keep': True}},
             'data': {'character_book': {'entries': [{'enabled': False, 'extensions': {'future': 'keep'}}]}}}, 'assets': {}},
        {'name': 'supplementary-unicode-filename-limit', 'document': {'name': '𝕊' * 70}, 'assets': {}},
    ]


def main():
    result = []
    for case in cases():
        document = PortableDocument.model_validate(case['document']).model_dump()
        assets = {key: (base64.b64decode(value['base64']), value['mime']) for key, value in case['assets'].items()}
        outputs = {}
        for format in FORMATS:
            raw, mime, filename, notices = export_document(document, format, assets)
            outputs[format] = {'mime': mime, 'filename': filename, 'notices': notices, **decode_output(raw, mime)}
        result.append({**case, 'document': document, 'outputs': outputs})
    (ROOT / 'tests/fixtures/device-exports.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__': main()
