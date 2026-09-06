"""Bounded SFW import + Lore + structured runtime test on the requested GPU only."""
import asyncio
import json
import subprocess
import sys
import time
from pathlib import Path

import httpx
import lmstudio

from verify_lmstudio_vulkan import KEY

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from python.core.portable_formats import parse_import
from python.core.portable_prompt import compile_portable
from python.core.generation import generate_events
from python.core.schemas import RuntimeState
from python.providers.lmstudio import LMStudioProvider

OUT = ROOT / '.artifacts' / 'portable-vulkan.json'
IDENTIFIER = 'kyalulu-portable-vulkan-acceptance'


def command(*args):
    return subprocess.check_output(['lms', *args], text=True,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


async def verify():
    card = {'spec': 'chara_card_v3', 'spec_version': '3.0', 'data': {
        'name': 'シアン', 'description': '日本語で簡潔に話す図書館の案内人。',
        'system_prompt': 'あなたは{{char}}。日本語で一文だけ答える。',
        'character_book': {'entries': [{'keys': ['鍵'], 'content': '図書館の鍵は青色です。', 'enabled': True}]}}}
    docs, _ = parse_import('sfw-acceptance.json', json.dumps(card, ensure_ascii=False).encode())
    compiled = compile_portable({'document': docs[0].model_dump()})
    provider = LMStudioProvider(base_url='http://127.0.0.1:1234/v1', supports_structured_output=True,
                                timeout=httpx.Timeout(240, connect=10))
    async with asyncio.timeout(300):
        async for event in generate_events(provider, model=IDENTIFIER,
                messages=[{'role': 'user', 'content': '図書館の鍵は何色？短く教えて。'}],
                compiled=compiled, state=RuntimeState(character_id='portable-sfw-check'),
                requested={'temperature': .3, 'max_tokens': 2048}, mode='research'):
            if event['type'] == 'result':
                return event['result']
    raise RuntimeError('Runtime ended without a result')


def main():
    result = {'status': 'checking_hardware', 'model_key': KEY}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    model = None
    try:
        result['selected_runtime'] = command('runtime', 'ls')
        selected = [line for line in result['selected_runtime'].splitlines() if '✓' in line and 'GGUF' in line]
        assert len(selected) == 1 and 'vulkan' in selected[0], 'Selected GGUF runtime must be Vulkan'
        survey = json.loads(command('runtime', 'survey', '--json'))
        engine = next(e for e in survey['engines'] if 'vulkan' in e['name'])
        gpus = engine['hardwareSurvey']['gpuSurveyResult']['gpuInfo']
        target = next(g for g in gpus if g['name'] == 'AMD Radeon RX 7600' and g['detectionPlatform'] == 'Vulkan')
        disabled = [g['deviceId'] for g in gpus if g['deviceId'] != target['deviceId']]
        config = {'gpu': {'ratio': .25, 'mainGpu': target['deviceId'], 'splitStrategy': 'favorMainGpu', 'disabledGpus': disabled},
            'gpuStrictVramCap': True, 'contextLength': 8192, 'evalBatchSize': 128,
            'offloadKVCacheToGpu': False, 'tryMmap': True}
        result.update(engine=engine['name'], engine_version=engine['version'], device=target, requested_load_config=config)
        OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        with lmstudio.Client('127.0.0.1:1234') as client:
            try:
                start = time.perf_counter()
                model = client.llm.load_new_instance(KEY, instance_identifier=IDENTIFIER, ttl=900, config=config)
                result['load_seconds'] = round(time.perf_counter() - start, 2)
                result['effective_load_config'] = model.get_load_config().to_dict()
                actual = result['effective_load_config']['gpu']
                assert actual.get('mainGpu') == target['deviceId'] and actual.get('ratio', 0) > 0
                assert all(g in actual.get('disabledGpus', []) for g in disabled)
                result['status'] = 'generating'
                OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
                checked = asyncio.run(verify())
                result['runtime_check'] = checked
                result['lore_answer_ok'] = '青' in checked.get('reply', '')
                result['status'] = 'passed' if checked['status'] == 'completed' and result['lore_answer_ok'] else 'failed'
            finally:
                if model is not None:
                    model.unload()
                    result['unloaded'] = True
    except Exception as exc:
        result.update(status='blocked', error=f'{type(exc).__name__}: {exc}')
    finally:
        OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({k: result.get(k) for k in ('status', 'engine', 'engine_version', 'load_seconds', 'lore_answer_ok', 'error', 'unloaded')}, ensure_ascii=False))
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
