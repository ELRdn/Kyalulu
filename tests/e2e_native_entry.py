"""Fresh browser on an already verified packed Native CLI; fictional policy/data only."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
from urllib.parse import urlsplit

import httpx
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


async def check(args):
    acceptance = args.acceptance.resolve()
    assert acceptance.is_relative_to(ROOT / '.artifacts')
    verified = json.loads(acceptance.read_text())
    seed = Path(verified['home']).resolve()
    assert seed == acceptance.parent and verified['packaged_cli'] and verified['node_only_path']
    cli = seed / 'npm/package/bin/kyalulu.mjs'
    release = json.loads((seed / 'npm/package/package.json').read_text())['version']
    program = seed / 'releases' / release
    assert (program / '.artifact-sha256').read_text() == verified['sha256']
    assert '<meta name="kyalulu-ui" content="native">' in (program / 'web/index.html').read_text()
    args.output.mkdir(parents=True, exist_ok=False)
    home = args.output / 'home'
    home.mkdir()
    (home / 'current.json').write_text(json.dumps({'release': release, 'directory': str(program)}))
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    env = {key: value for key, value in os.environ.items() if key.upper() in ('SYSTEMROOT', 'WINDIR', 'COMSPEC')}
    for key in ('HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR', 'KYALULU_HOME'):
        env[key] = str(home)
    env.update(PATH='', PYTHONHOME='', PYTHONPATH='', PYTHONDONTWRITEBYTECODE='1', KYALULU_PORT=str(port),
               KYALULU_REGION_POLICIES=json.dumps({'JP': {'accepted': True, 'minimum_age': 13,
                   'guardian_below': 18, 'version': 'FICTIONAL-NOT-REGIONAL-APPROVAL'}}))
    node = shutil.which('node')
    assert node and cli.is_file()

    def command(*arguments):
        subprocess.run([node, str(cli), *arguments], env=env, check=True, capture_output=True, timeout=60)

    started = False
    external, calls, errors = [], [], []
    try:
        command('start', '--no-open')
        started = True
        origin = json.loads((home / 'process.json').read_text())['url']
        assert urlsplit(origin).hostname == '127.0.0.1' and urlsplit(origin).scheme == 'http'
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                context = await browser.new_context(locale='en-US', viewport={'width': 393, 'height': 852})
                handoffs = []

                async def guard(route):
                    request = route.request
                    if request.url == 'https://app.kyalulu.com/':
                        handoffs.append(await request.all_headers())
                        await route.fulfill(status=200, content_type='text/html', body='<title>Fictional Cloud destination</title>')
                    elif request.url.startswith(origin + '/'):
                        calls.append({'method': request.method, 'path': urlsplit(request.url).path})
                        await route.continue_()
                    else:
                        external.append(request.url)
                        await route.abort()

                await context.route('**/*', guard)
                page = await context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                await page.goto(origin)
                entry = page.locator('.k-unified-entry')
                await entry.wait_for()
                picker = entry.get_by_role('combobox', name='Run on', exact=True)
                assert await picker.input_value() == 'local'
                assert 'local' in await picker.locator('option').evaluate_all('(items)=>items.map(item=>item.value)')
                await entry.get_by_role('textbox').fill('XX')
                await entry.get_by_role('spinbutton').fill('25')
                await entry.get_by_role('checkbox').check()
                await entry.get_by_role('button', name='Next', exact=True).click()
                await entry.get_by_role('alert').wait_for()
                assert not await page.evaluate("JSON.parse(localStorage.getItem('kyalulu-app-preferences-v1')||'{}').accepted")
                await entry.get_by_role('textbox').fill('JP')
                await entry.get_by_role('spinbutton').fill('15')
                await entry.get_by_role('button', name='Next', exact=True).click()
                await expect(entry.get_by_role('alert')).to_contain_text('guardian')
                await entry.get_by_role('spinbutton').fill('25')
                await entry.get_by_role('button', name='Next', exact=True).click()
                interests = page.locator('.k-interests')
                await interests.wait_for()
                for _ in range(3):
                    await interests.get_by_role('button', name='Skip', exact=True).click()
                await page.get_by_role('heading', name='Recommended for you', exact=True).wait_for()
                assert await page.get_by_role('combobox', name='Run on', exact=True).input_value() == 'local'
                assert not any(call['path'] == '/api/cloud/app/eligibility' for call in calls)
                async with httpx.AsyncClient(base_url=origin, trust_env=False, headers={'Origin': origin}) as client:
                    generated = await client.post('/api/chat', json={'model_id': 'mock-echo', 'session_id': 'native-ui-fixture',
                        'generation_id': 'native-ui-mock', 'messages': [{'role': 'user', 'content': 'FICTIONAL-NATIVE-MESSAGE'}]})
                    assert generated.status_code == 200 and generated.json()['status'] == 'completed'
                await page.goto(origin + '/#/chats/native-ui-fixture')
                await page.get_by_role('textbox').last.fill('FICTIONAL-UNSENT-DRAFT')
                await page.wait_for_timeout(150)
                snapshot = await page.evaluate("JSON.stringify({target:localStorage.getItem('kyalulu-execution-target'),prefs:localStorage.getItem('kyalulu-app-preferences-v1'),receipt:localStorage.getItem('kyalulu-eligibility-ticket')})")
                await page.get_by_role('combobox', name='Run on', exact=True).select_option('cloud')
                dialog = page.get_by_role('dialog')
                await dialog.get_by_role('heading', name='Open Cloud in your browser?', exact=True).wait_for()
                async with context.expect_page() as opened:
                    await dialog.get_by_role('button', name='Next', exact=True).click()
                popup = await opened.value
                await popup.wait_for_url('https://app.kyalulu.com/')
                assert await popup.evaluate('window.opener===null')
                assert handoffs and 'referer' not in handoffs[0] and 'authorization' not in handoffs[0] and 'cookie' not in handoffs[0]
                await popup.close()
                assert await page.evaluate("JSON.stringify({target:localStorage.getItem('kyalulu-execution-target'),prefs:localStorage.getItem('kyalulu-app-preferences-v1'),receipt:localStorage.getItem('kyalulu-eligibility-ticket')})") == snapshot
                await expect(page.get_by_role('textbox').last).to_have_value('FICTIONAL-UNSENT-DRAFT')
                await page.screenshot(path=str(args.output / 'local-chat.png'), animations='disabled')
                command('stop')
                started = False
                command('start', '--no-open')
                started = True
                await page.reload()
                await expect(page.get_by_role('textbox').last).to_have_value('FICTIONAL-UNSENT-DRAFT')
                async with httpx.AsyncClient(base_url=origin, trust_env=False) as client:
                    history = await client.get('/api/chat/history?session_id=native-ui-fixture')
                    assert history.status_code == 200 and len(history.json()['history']) == 2
                assert not external and not errors, (external, errors)
                await context.close()
            finally:
                await browser.close()
        report = {'ok': True, 'artifact_sha256': verified['sha256'], 'fresh_native_local_entry': True,
                  'local_general_policy_and_guardian_checks': True, 'local_eligibility_not_cloud': True,
                  'canonical_cloud_handoff_no_credentials_or_referrer': True, 'draft_target_and_receipt_preserved': True,
                  'restart_preserves_local_history_and_draft': True, 'external_requests': len(external),
                  'page_errors': len(errors), 'mock_generations': 1, 'real_inference_attempts': 0,
                  'physical_device': False, 'regional_policy_approved': False, 'production_used': False}
        (args.output / 'result.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    finally:
        if started:
            command('stop')
        assert not (home / 'process.json').exists() and not (home / 'launcher.lock').exists()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--acceptance', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    arguments.output = arguments.output.resolve()
    assert arguments.output.is_relative_to(ROOT / '.artifacts')
    asyncio.run(check(arguments))
