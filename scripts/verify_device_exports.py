"""Check browser-generated containers with native independent ZIP/PNG readers."""
import json
from pathlib import Path

from build_device_export_fixture import decode_output
from python.core.portable_formats import parse_import

ROOT = Path(__file__).resolve().parents[1]


def main():
    cases = json.loads((ROOT / 'tests/fixtures/device-exports.json').read_text(encoding='utf-8'))
    directory = ROOT / '.artifacts/device-exports'
    manifest = json.loads((directory / 'index.json').read_text(encoding='utf-8'))
    expected = {(index, format) for index, case in enumerate(cases) for format in case['outputs']}
    assert {(item['case'], item['format']) for item in manifest} == expected
    assert len(manifest) == len(expected)
    for item in manifest:
        case, format = cases[item['case']], item['format']
        assert item['file'] == f"{item['case']}-{format}.bin"
        raw = (directory / item['file']).read_bytes()
        reference = case['outputs'][format]
        assert decode_output(raw, reference['mime']) == {key: reference[key] for key in ('json', 'files', 'png') if key in reference}, (case['name'], format)
        documents, assets = parse_import(reference['filename'], raw)
        assert len(documents) == 1 and documents[0].name == case['document']['name'], (case['name'], format)
        if format == 'backup':
            expected_document = {**case['document'], 'source': {**case['document']['source'], 'backup_filename': reference['filename']}}
            assert documents[0].model_dump() == expected_document
        if format in ('backup', 'charx'):
            for id, value in case['assets'].items():
                import base64
                assert assets[id][0] == base64.b64decode(value['base64'])
    print(f'{len(manifest)} browser exports verified by native JSON/ZIP/PNG importers')


if __name__ == '__main__': main()
