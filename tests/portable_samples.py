"""Original SFW samples using upstream BYAF v1's published schema, not guessed layouts."""
import io
import json
import zipfile
from python.core.portable_binary import neutral_png

BYAF_REVISION = '7ebf2fdbb06a36b4f900a8de45480c4a2965df03'


def byaf_sample():
    timestamp = '2026-01-01T00:00:00Z'
    manifest = {'schemaVersion': 1, 'createdAt': timestamp, 'characters': ['characters/alice/character.json'],
                'scenarios': ['scenarios/forest.json', 'scenarios/library.json']}
    character = {'schemaVersion': 1, 'id': 'alice', 'name': 'Alice', 'displayName': 'アリス', 'isNSFW': False,
                 'persona': '不思議の国の案内人。日本語で話す。', 'createdAt': timestamp, 'updatedAt': timestamp,
                 'loreItems': [{'key': '鍵', 'value': '鍵は青い。'}], 'images': [{'path': 'images/portrait.png', 'label': 'portrait'}]}
    scenario = {'schemaVersion': 1, 'title': '森', 'formattingInstructions': '優しく短く話す。', 'minP': .05,
        'minPEnabled': True, 'temperature': .7, 'repeatPenalty': 1.1, 'repeatLastN': 64, 'topK': 40, 'topP': .9,
        'exampleMessages': [{'characterID': 'alice', 'text': '森を案内するよ。'}], 'canDeleteExampleMessages': True,
        'firstMessages': [{'characterID': 'alice', 'text': 'こんにちは'}], 'narrative': '森の入り口', 'promptTemplate': 'ChatML',
        'grammar': None, 'messages': [
            {'type': 'human', 'text': 'こんにちは', 'createdAt': timestamp, 'updatedAt': timestamp},
            {'type': 'ai', 'outputs': [
                {'text': '前の候補', 'createdAt': timestamp, 'updatedAt': timestamp, 'activeTimestamp': timestamp},
                {'text': '選択された返答', 'createdAt': timestamp, 'updatedAt': timestamp, 'activeTimestamp': '2026-01-02T00:00:00Z'}]}]}
    portrait = neutral_png()
    files = {'manifest.json': manifest, 'characters/alice/character.json': character,
             'scenarios/forest.json': scenario, 'scenarios/library.json': {**scenario, 'title': '図書館', 'narrative': '本に囲まれている'}}
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, value in files.items():
            z.writestr(name, json.dumps(value, ensure_ascii=False))
        z.writestr('characters/alice/images/portrait.png', portrait)
    return out.getvalue(), portrait
