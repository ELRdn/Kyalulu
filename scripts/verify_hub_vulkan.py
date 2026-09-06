"""Real public SFW Hub card, locally added test Lore, same strict Vulkan/RX7600 gate."""
import asyncio
import json
import sys
from pathlib import Path
import verify_portable_vulkan as check

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
from python.core.hubs import Hubs, provenance, sfw_manifest
from python.core.hub_schema import UrlImport
from python.core.portable_formats import parse_import

check.OUT = check.ROOT / '.artifacts' / 'hub-vulkan.json'
check.IDENTIFIER = 'kyalulu-hub-vulkan-acceptance'


async def prepare():
    manifest = sfw_manifest()
    source = await Hubs().resolve(UrlImport(url=f"https://github.com/SillyTavern/SillyTavern-Content/blob/{manifest['revision']}/assets/character/{manifest['cards'][0]['id']}"))
    raw = await Hubs().download(source)
    docs, _ = parse_import(source.filename, raw)
    doc = docs[0]
    doc.source['remote'] = provenance(source, raw)
    # Normal local editing: test Lore is separate from the preserved source original.
    doc.data['character_book'] = {'entries': [{'keys': ['鍵'], 'content': '試験用の図書館の鍵は青色です。', 'enabled': True}]}
    doc.profile.post_history_instructions = '日本語で一文だけ答えてください。'
    return doc


if __name__ == '__main__':
    try:
        document = asyncio.run(prepare())
    except Exception as exc:
        check.OUT.parent.mkdir(parents=True, exist_ok=True)
        check.OUT.write_text(json.dumps({'status': 'blocked', 'stage': 'hub_download', 'error': str(exc)}, ensure_ascii=False, indent=2), encoding='utf-8')
        raise SystemExit(1)
    original_compile = check.compile_portable
    check.compile_portable = lambda _snapshot: original_compile({'document': document.model_dump()})
    code = check.main()
    result = json.loads(check.OUT.read_text(encoding='utf-8'))
    result['hub_source'] = document.source['remote']
    result['local_test_edit'] = 'Added blue library key Lore and a concise Japanese response instruction; original unchanged.'
    check.OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    raise SystemExit(code)
