import base64
import importlib.util
import json
from pathlib import Path
import pytest

from python.core.portable_export import export_document

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('device_export_fixture', ROOT / 'scripts/build_device_export_fixture.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
CASES = json.loads((ROOT / 'tests/fixtures/device-exports.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('case', CASES, ids=[case['name'] for case in CASES])
def test_browser_export_fixture_remains_native_compatible(case):
    assets = {id: (base64.b64decode(asset['base64']), asset['mime']) for id, asset in case['assets'].items()}
    for format, expected in case['outputs'].items():
        raw, mime, filename, notices = export_document(case['document'], format, assets)
        assert {'mime': mime, 'filename': filename, 'notices': notices, **fixture.decode_output(raw, mime)} == expected
