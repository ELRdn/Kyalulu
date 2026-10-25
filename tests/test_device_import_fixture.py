"""Native reference stays executable; browser mocks are not image decoding evidence."""
import base64
import json
from pathlib import Path

import pytest
from python.core.portable_formats import parse_import
from python.core.portable_assets import accept_media

FIXTURES = Path(__file__).parent / 'fixtures'
IMPORTS = json.loads((FIXTURES / 'device-imports.json').read_text(encoding='utf-8'))
MEDIA = json.loads((FIXTURES / 'device-media.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('case', IMPORTS, ids=lambda case: case['name'])
def test_native_import_reference(case):
    docs, assets = parse_import(case['filename'], base64.b64decode(case['base64'], validate=True))
    assert [doc.model_dump() for doc in docs] == case['documents']
    assert {id: {'base64': base64.b64encode(value[0]).decode(), 'mime': value[1]} for id, value in assets.items()} == case['assets']


@pytest.mark.parametrize('case', MEDIA, ids=lambda case: case['name'])
def test_native_media_reference(case):
    raw = base64.b64decode(case['base64'], validate=True)
    if case['expected'] is None:
        with pytest.raises(ValueError): accept_media(raw)
    else:
        id, mime = accept_media(raw)
        assert {'id': id, 'mime': mime} == case['expected']


def test_native_lore_values_reference():
    from python.core.portable_prompt import select_lore
    case = json.loads((FIXTURES / 'device-lore-values.json').read_text(encoding='utf-8'))
    selected, audit = select_lore(case['books'], case['history'])
    assert {'selected': selected, 'audit': audit} == case['expected']
    assert [entry['content'] for entry in selected] == ['Stars', 'Allowed']
