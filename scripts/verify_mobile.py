"""Browser acceptance for Kyalulu Mobile. No claims about physical phones.

Use the existing project Playwright environment:
.venv/Scripts/python scripts/verify_mobile.py --url http://localhost:5187
--real-model ID additionally downloads and runs the real pinned model in a
dedicated persistent test browser profile; never uses the user's browser data.
"""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/mobile-validation'

async def stored_state(page):
    return await page.evaluate('''()=>new Promise((resolve,reject)=>{
      const r=indexedDB.open('kyalulu-mobile-v1');r.onerror=reject;r.onsuccess=()=>{
        const db=r.result,t=db.transaction(['data','models']),a=t.objectStore('data').getAll(),b=t.objectStore('models').getAll();
        t.oncomplete=()=>{db.close();resolve({data:a.result,models:b.result});};t.onerror=reject;
      };
    })''')


async def ui_check(browser, url, width):
    print('UI: open', url, width, flush=True)
    context = await browser.new_context(viewport={'width': width, 'height': 844}, accept_downloads=True, locale='ja-JP',
        user_agent=f'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{browser.version} Safari/537.36')
    page = await context.new_page()
    errors, requests = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url))
    await page.goto(url)
    await page.get_by_role('heading', name='どのキャラと話す？').wait_for()
    await page.wait_for_function('()=>navigator.serviceWorker.controller !== null', timeout=120000)
    print('UI: character', width, flush=True)
    await page.get_by_role('button', name='キャラ', exact=True).click()
    await page.get_by_role('button', name='キャラを作る', exact=True).click()
    await page.get_by_label('名前', exact=True).fill('テストの星')
    await page.get_by_label('キャラクター設定', exact=True).fill('日本語で短く応答するキャラ。')
    await page.get_by_label('最初のメッセージ', exact=True).fill('![画像](https://private-image.invalid/DO-NOT-SEND)\nこんにちは！')
    await page.get_by_role('button', name='保存', exact=True).click()
    card = page.locator('.m-card').filter(has=page.get_by_role('heading', name='テストの星'))
    await card.get_by_role('button', name='話す', exact=True).click()
    await page.locator('textarea').fill('保存される下書き')
    await page.wait_for_timeout(650)
    await page.reload()
    await page.get_by_role('heading', name='どのキャラと話す？').wait_for()
    await page.get_by_role('button', name='テストの星との会話', exact=False).click()
    assert await page.locator('textarea').input_value() == '保存される下書き'
    assert await page.get_by_text('こんにちは！', exact=False).count()
    await page.get_by_role('button', name='保存・設定', exact=True).click()
    print('UI: backup', width, flush=True)
    async with page.expect_download() as info:
        await page.get_by_role('button', name='バックアップを書き出す', exact=True).click()
    download = await info.value
    backup_path = OUT / f'backup-{width}.json'
    await download.save_as(backup_path)
    backup = json.loads(backup_path.read_text(encoding='utf-8'))
    assert backup['version'] == 1 and len(backup['characters']) == 2 and len(backup['conversations']) == 1
    restored = json.loads(json.dumps(backup))
    restored['characters'][1]['name'] = '復元した星'
    page.once('dialog', lambda d: d.accept())
    await page.get_by_label('バックアップから復元', exact=True).set_input_files({
        'name': 'restore.json', 'mimeType': 'application/json',
        'buffer': json.dumps(restored, ensure_ascii=False).encode('utf-8')})
    await page.get_by_role('button', name='キャラ', exact=True).click()
    await page.get_by_role('heading', name='復元した星', exact=True).wait_for()
    await page.reload()
    await page.get_by_role('button', name='会話', exact=True).click()
    await page.get_by_role('button', name='テストの星との会話', exact=False).click()
    assert await page.locator('textarea').input_value() == '保存される下書き'
    assert await page.get_by_role('heading', name='テストの星', exact=True).count()
    await page.get_by_role('button', name='モデル', exact=True).click()
    print('UI: model rejection', width, flush=True)
    assert await page.locator('.m-grid .m-card').count() == 4
    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
    await page.screenshot(path=str(OUT / f'models-{width}.png'), full_page=True)
    # A wrong body must never become a verified model.
    await page.route('https://huggingface.co/**', lambda r: r.fulfill(status=200, body=b'bad model', headers={'access-control-allow-origin': '*'}))
    page.once('dialog', lambda d: d.accept())
    await page.locator('.m-card').filter(has=page.get_by_role('heading', name='Kyalulu E2B JP Rolepaly beta · IQ3_M', exact=True)).get_by_role('button', name='ダウンロード', exact=True).click()
    await page.get_by_role('alert').filter(has_text='一致しません').wait_for(timeout=30000)
    statuses = await page.evaluate('''() => new Promise((resolve,reject)=>{const r=indexedDB.open('kyalulu-mobile-v1');r.onsuccess=()=>{const q=r.result.transaction('models').objectStore('models').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=reject;};})''')
    assert not statuses
    print('UI: offline', width, flush=True)
    try:
        await page.wait_for_function('()=>navigator.serviceWorker.controller !== null', timeout=120000)
    except Exception:
        print(await page.locator('body').inner_text(), flush=True)
        await page.screenshot(path=str(OUT/f'offline-failed-{width}.png'), full_page=True)
        raise
    await context.set_offline(True)
    await page.reload()
    await page.get_by_role('heading', name='どのキャラと話す？').wait_for()
    assert await page.get_by_text('復元した星', exact=True).count()
    assert not errors, errors
    assert not [u for u in requests if '/api/' in u or 'private-image.invalid' in u], requests
    result = {'width': width, 'character_save': True, 'draft_restart': True, 'backup_export': True, 'backup_restore': True,
              'corrupt_model_rejected': True, 'offline_restart': True, 'page_errors': errors,
              'api_requests': 0, 'unsolicited_image_requests': 0, 'physical_phone': False}
    await context.close()
    return result


async def real_check(playwright, url, model_id, offline=False, prune=False, cpu=False, exercise=False):
    print('Real model: open',model_id,flush=True)
    profile = ROOT / '.artifacts/mobile-test-browser'
    context = await playwright.chromium.launch_persistent_context(str(profile), channel='chrome', headless=True, locale='ja-JP',
            viewport={'width': 430, 'height': 900}, downloads_path=str(OUT/'downloads'), args=['--enable-unsafe-webgpu'])
    page = context.pages[0] if context.pages else await context.new_page()
    for extra in context.pages[1:]:
        await extra.close()
    errors, logs = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: logs.append(m.text) if m.type in ['error','warning'] else None)
    await page.goto(url)
    await page.get_by_role('heading', name='どのキャラと話す？').wait_for()
    print('Real model: check app update',flush=True)
    before_update = await stored_state(page)
    waiting = await page.evaluate('''async()=>{
      const r=await navigator.serviceWorker.getRegistration();if(!r)return false;
      await r.update();const w=r.installing;
      if(w&&!['installed','redundant'].includes(w.state))await Promise.race([
        new Promise(resolve=>w.addEventListener('statechange',()=>{if(['installed','redundant'].includes(w.state))resolve();})),
        new Promise((_,reject)=>setTimeout(()=>reject(Error('App update preparation timed out')),60000))]);
      return !!r.waiting;
    }''')
    if waiting:
        print('Real model: applying explicit app update',flush=True)
        await page.get_by_text('アプリ情報', exact=True).click()
        page.once('dialog', lambda d: d.accept())
        async with page.expect_navigation():
            await page.get_by_role('button', name='更新して再読み込み', exact=True).click()
        await page.get_by_role('heading', name='どのキャラと話す？').wait_for()
        assert await stored_state(page) == before_update, 'Application update changed model/data stores'
        print('Verified explicit app update preserves IndexedDB data and model readiness.', flush=True)
    catalog = json.loads((ROOT/'apps/web/src/mobile/catalog.generated.json').read_text(encoding='utf-8'))
    model = next(m for m in catalog if m['id'] == model_id)
    await page.get_by_role('button', name='モデル', exact=True).click()
    if prune:
        # Only generated models in this script's dedicated browser profile.
        for other in catalog:
            if other['id'] == model_id:
                continue
            old = page.locator('.m-card').filter(has=page.get_by_role('heading', name=other['name'], exact=True))
            page.once('dialog', lambda d: d.accept())
            await old.get_by_role('button', name='端末から削除', exact=True).click()
    card = page.locator('.m-card').filter(has=page.get_by_role('heading', name=model['name'], exact=True))
    if await card.get_by_role('button', name='ダウンロード', exact=True).count():
        print('Downloading real model:', model_id, flush=True)
        page.once('dialog', lambda d: d.accept())
        await card.get_by_role('button', name='ダウンロード', exact=True).click()
        await page.wait_for_function("name=>document.querySelector('.m-error') || [...document.querySelectorAll('.m-card')].some(c=>c.querySelector('h2')?.textContent===name&&c.textContent.includes('このモデルを選ぶ'))", arg=model['name'], timeout=1200000)
        if await page.locator('.m-error').count():
            failure={'id':model_id,'phase':'download','message':await page.locator('.m-error').inner_text(),'console':logs[-20:],'errors':errors,'physical_phone':False}
            (OUT/f'failed-{model_id}.json').write_text(json.dumps(failure,ensure_ascii=False,indent=2),encoding='utf-8')
            await context.close()
            raise RuntimeError(json.dumps(failure,ensure_ascii=False))
    await card.get_by_role('button', name='このモデルを選ぶ', exact=True).click()
    if offline:
        await page.wait_for_function('()=>navigator.serviceWorker.controller !== null', timeout=120000)
        await context.set_offline(True)
        await page.reload()
        await page.get_by_role('heading', name='どのキャラと話す？').wait_for()
    print('Loading real model:', model_id, flush=True)
    adapter = await page.evaluate('''async()=>{const a=await navigator.gpu?.requestAdapter();return a?{vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description,features:[...a.features],maxBufferSize:a.limits.maxBufferSize,maxStorageBufferBindingSize:a.limits.maxStorageBufferBindingSize}:null}''')
    await page.get_by_role('button', name='CPUで読み込む' if cpu else 'モデルを読み込む', exact=True).click()
    await page.wait_for_function("()=>document.body.innerText.includes('読み込み済み') || document.querySelector('.m-error')", timeout=600000)
    if await page.locator('.m-error').count():
        failure={'id':model_id,'phase':'load','message':await page.locator('.m-error').inner_text(),'console':logs[-20:],'errors':errors,'physical_phone':False}
        (OUT/f'failed-{model_id}.json').write_text(json.dumps(failure,ensure_ascii=False,indent=2),encoding='utf-8')
        await context.close()
        raise RuntimeError(json.dumps(failure,ensure_ascii=False))
    print('Generating:', model_id, flush=True)
    await page.get_by_role('button', name='会話をはじめる', exact=True).first.click()
    await page.locator('textarea').fill('「こんにちは」とだけ短く返答して。')
    await page.get_by_role('button', name='送信', exact=True).click()
    await page.wait_for_function("()=>document.querySelectorAll('.m-message--assistant').length>=2", timeout=300000)
    await page.get_by_role('button',name='停止',exact=True).wait_for(state='hidden',timeout=300000)
    if await page.locator('.m-error').count():
        failure={'id':model_id,'phase':'generate','message':await page.locator('.m-error').inner_text(),'console':logs[-20:],'errors':errors,'physical_phone':False}
        (OUT/f'failed-{model_id}.json').write_text(json.dumps(failure,ensure_ascii=False,indent=2),encoding='utf-8')
        await context.close()
        raise RuntimeError(json.dumps(failure,ensure_ascii=False))
    response=await page.locator('.m-message--assistant').last.inner_text()
    suffix = model_id + ('-cpu' if cpu else '') + ('-offline' if offline else '')
    await page.screenshot(path=str(OUT/f'real-{suffix}.png'), full_page=True)
    if exercise:
        await page.locator('textarea').fill('1から1000まで順番に数えてください。')
        await page.get_by_role('button', name='送信', exact=True).click()
        await page.get_by_role('button', name='停止', exact=True).click()
        await page.get_by_role('button', name='停止', exact=True).wait_for(state='hidden',timeout=60000)
        await page.get_by_text('停止した応答',exact=True).wait_for()
        other = next(m for m in catalog if m['id'] != model_id)
        await page.get_by_role('combobox',name='使用モデル',exact=True).select_option(other['id'])
        await page.wait_for_function("()=>!document.querySelector('select').disabled&&!document.body.innerText.includes('読み込み済み')")
        await page.get_by_role('combobox',name='使用モデル',exact=True).select_option(model_id)
        await page.get_by_role('button', name='CPUで読み込む' if cpu else 'モデルを読み込む', exact=True).click()
        await page.wait_for_function("()=>document.body.innerText.includes('読み込み済み') || document.querySelector('.m-error')",timeout=600000)
        assert not await page.locator('.m-error').count(), await page.locator('.m-error').inner_text()
        print('Verified stop, model-switch disposal, and reload.', flush=True)
    await page.get_by_role('button', name='保存・設定', exact=True).click()
    async with page.expect_download() as pending:
        await page.get_by_role('button', name='今回の実測をJSONで保存', exact=True).click()
    download = await pending.value
    await download.save_as(OUT/f'measurements-{suffix}.json')
    result = {'id': model_id, 'adapter': adapter, 'response':response, 'errors': errors, 'console': logs[-15:], 'physical_phone': False, 'offline_inference': offline, 'cpu':cpu, 'stop_switch_reload':exercise}
    (OUT/f'result-{suffix}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    await context.close()
    return result


async def main(args):
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        if args.real_model:
            results = [await real_check(p, args.url, args.real_model, args.offline, args.prune_models, args.cpu, args.exercise)]
        else:
            browser = await p.chromium.launch(channel='chrome', headless=True, downloads_path=str(OUT/'downloads'))
            results = [await ui_check(browser, args.url, width) for width in [390, 1280]]
            await browser.close()
    (OUT/'latest.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://localhost:5187/')
    parser.add_argument('--real-model')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--cpu', action='store_true')
    parser.add_argument('--exercise', action='store_true', help='Also stop a generation, switch/dispose the model, and load it again.')
    parser.add_argument('--prune-models', action='store_true', help='Delete other downloaded models in the isolated test profile only.')
    asyncio.run(main(parser.parse_args()))
