"""Explicitly requested Gemma 4 / Vulkan / RX7600 bounded local smoke test."""
import json
import argparse
import subprocess
import time
from pathlib import Path
import lmstudio
import httpx

OUT = Path(__file__).resolve().parents[1] / '.artifacts' / 'gemma4-vulkan.json'
KEY = 'HauhauCS/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-MTP/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf'
IDENTIFIER = 'kyalulu-gemma4-rx7600-test'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--keep-loaded', action='store_true')
    parser.add_argument('--load-only', action='store_true')
    args = parser.parse_args()
    survey = json.loads(subprocess.check_output(['lms', 'runtime', 'survey', '--json'], text=True,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)))
    engines = [e for e in survey['engines'] if 'vulkan' in e['name']]
    assert len(engines) == 1, 'Vulkan engine is not uniquely selected'
    gpus = engines[0]['hardwareSurvey']['gpuSurveyResult']['gpuInfo']
    target = next(g for g in gpus if g['name'] == 'AMD Radeon RX 7600')
    assert target['detectionPlatform'] == 'Vulkan'
    disabled = [g['deviceId'] for g in gpus if g['deviceId'] != target['deviceId']]
    config = {'gpu': {'ratio': .25, 'mainGpu': target['deviceId'], 'splitStrategy': 'favorMainGpu', 'disabledGpus': disabled},
        'gpuStrictVramCap': True, 'contextLength': 8192, 'evalBatchSize': 128,
        'offloadKVCacheToGpu': False, 'tryMmap': True}
    result = {'engine': engines[0]['name'], 'engine_version': engines[0]['version'],
        'device': target, 'requested_load_config': config, 'model_key': KEY, 'status': 'loading'}
    OUT.parent.mkdir(exist_ok=True, parents=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    model = None
    with lmstudio.Client('127.0.0.1:1234') as client:
        try:
            start = time.perf_counter()
            model = client.llm.load_new_instance(KEY, instance_identifier=IDENTIFIER, ttl=3600, config=config)
            result['load_seconds'] = round(time.perf_counter() - start, 2)
            result['effective_load_config'] = model.get_load_config().to_dict()
            result['status'] = 'loaded'
            OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            actual = result['effective_load_config'].get('gpu', {})
            assert actual.get('mainGpu') == target['deviceId'], actual
            assert all(g in actual.get('disabledGpus', []) for g in disabled), actual
            if args.load_only:
                result['status'] = 'load_only'
                return
            start = time.perf_counter()
            with httpx.Client(timeout=httpx.Timeout(120, connect=10)) as http:
                response = http.post('http://127.0.0.1:1234/v1/chat/completions', json={
                    'model': IDENTIFIER, 'messages': [{'role': 'user', 'content': '日本語で一言だけ挨拶してください。'}],
                    'temperature': .3, 'max_tokens': 768, 'stream': False})
                response.raise_for_status()
                data = response.json()
            assert data['choices'][0]['message']['content'].strip(), 'Empty reply; token budget may have been consumed by reasoning'
            assert data['choices'][0].get('finish_reason') == 'stop', 'Generation did not finish normally'
            result.update(status='smoke_pass', elapsed_seconds=round(time.perf_counter() - start, 2),
                reply=data['choices'][0]['message']['content'], usage=data.get('usage'))
            import asyncio, sys
            sys.path.insert(0, str(OUT.parents[1] / 'runtime'))
            from python.providers.lmstudio import LMStudioProvider
            from python.core.generation import generate_events
            from python.core.prompt_compiler import compile_prompt
            from python.core.schemas import RuntimeState
            async def runtime_check():
                provider = LMStudioProvider(base_url='http://127.0.0.1:1234/v1', supports_structured_output=True)
                async for event in generate_events(provider, model=IDENTIFIER, messages=[{'role':'user','content':'こんにちは、今日はカフェに来たよ。短く挨拶してね。'}], compiled=compile_prompt('mocha_sfw'), state=RuntimeState(character_id='mocha_sfw'), requested={'temperature':.3,'max_tokens':2048}):
                    if event['type']=='result':
                        return event['result']
            checked = asyncio.run(runtime_check())
            result['runtime_check'] = checked
            result['status'] = 'runtime_pass' if checked['status']=='completed' else 'runtime_blocked'
        except Exception as exc:
            result.update(status='blocked', error=str(exc))
        finally:
            if model is not None and not args.keep_loaded:
                model.unload()
                result['unloaded'] = True
            OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps({k: result.get(k) for k in ("status", "load_seconds", "elapsed_seconds", "reply", "error", "unloaded")}, ensure_ascii=False))


if __name__ == '__main__':
    main()
