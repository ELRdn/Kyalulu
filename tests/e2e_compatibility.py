"""Browser acceptance against isolated API/Vite. No user library/history is touched."""
import argparse
import base64
import io
import json
import re
import sys
import uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
from playwright.sync_api import sync_playwright, expect
from PIL import Image
from python.core.portable_formats import parse_import
from python.core.portable_binary import neutral_png
from portable_samples import byaf_sample


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:5189')
    parser.add_argument('--chromium')
    args = parser.parse_args()
    output = Path('.artifacts/compat-e2e'); output.mkdir(parents=True, exist_ok=True)
    results = []
    buf = io.BytesIO(); Image.new('RGB', (2, 2), '#336699').save(buf, format='PNG')
    icon, emotion = neutral_png(), buf.getvalue()
    def uri(raw): return 'data:image/png;base64,' + base64.b64encode(raw).decode()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
        for width in (1440, 390):
            for theme in ('light', 'dark'):
                name = f'Cyan-{width}-{theme}-{uuid.uuid4().hex[:6]}'
                context = browser.new_context(viewport={'width': width, 'height': 1000}, color_scheme=theme)
                context.add_init_script(f"localStorage.setItem('my-zeta-theme','{theme}');localStorage.setItem('my-zeta-model','mock-echo');localStorage.setItem('my-zeta-researcher','1');localStorage.setItem('kyalulu-context-panel-open','0');")
                page = context.new_page(); errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(args.base + '/#/create'); page.wait_for_load_state('networkidle')
                card = {'spec': 'chara_card_v3', 'spec_version': '3.0', 'future_top': {'keep': True}, 'data': {
                    'name': name, 'description': '日本語で簡潔に話す案内人。', 'first_mes': 'こんにちは', 'alternate_greetings': ['図書館へようこそ'],
                    'extensions': {'unknown': {'keep': 42}, 'risuai': {'scripts': ['do not execute']}},
                    'character_book': {'entries': [{'keys': ['鍵'], 'content': '鍵は青い。', 'enabled': True}]},
                    'assets': [{'name': 'portrait', 'type': 'icon', 'ext': 'png', 'uri': uri(icon)}, {'name': 'happy', 'type': 'emotion', 'ext': 'png', 'uri': uri(emotion)}]}}
                payload = json.dumps(card, ensure_ascii=False).encode()
                page.get_by_label('取り込むファイル', exact=True).set_input_files({'name': name + '.json', 'mimeType': 'application/json', 'buffer': payload})
                expect(page.get_by_role('heading', name='取り込み内容を確認', exact=True)).to_be_visible()
                expect(page.get_by_label('名前', exact=True)).to_have_value(name)
                page.get_by_label('文体・話し方', exact=True).fill('短く、親しみやすく。')
                page.screenshot(path=str(output / f'preview-{width}-{theme}.png'), full_page=True)
                # A failed save must keep editable input; retry uses the same request ID.
                page.route('**/api/imports/*/commit', lambda route: route.fulfill(status=503, json={'error': 'test save unavailable'}))
                page.get_by_role('button', name='選択した内容を保存', exact=True).click()
                expect(page.get_by_role('alert')).to_contain_text('test save unavailable')
                expect(page.get_by_label('名前', exact=True)).to_have_value(name)
                page.unroute('**/api/imports/*/commit')
                page.get_by_role('button', name='選択した内容を保存', exact=True).click()
                expect(page.get_by_role('status')).to_contain_text('1件を保存')
                item = next(i for i in page.request.get(args.base + '/api/library').json()['items'] if i['document']['name'] == name)
                tile = page.get_by_role('heading', name=name, exact=True).locator('..')
                tile.get_by_role('button', name='書き出し', exact=True).click()
                page.get_by_label('書き出し形式').select_option('ccv3-png')
                page.get_by_role('button', name='書き出し内容を確認').click()
                with page.expect_download() as download:
                    page.get_by_role('link', name='をダウンロード', exact=False).click()
                exported = Path(download.value.path()).read_bytes()
                back, images = parse_import('roundtrip.png', exported)
                assert back[0].name == name and back[0].data['extensions']['unknown']['keep'] == 42
                assert any(a.type == 'emotion' and a.asset_id in images for a in back[0].assets)
                tile.get_by_role('link', name='キャラを開く').click()
                page.get_by_label('最初の挨拶を選ぶ').select_option('1')
                page.get_by_role('button', name='Start Chat ✦', exact=True).click()
                expect(page.locator('.k-bubble').first).to_contain_text('図書館へようこそ')
                sid = page.url.rsplit('/', 1)[-1]
                # Caption is parsed from the rendered Composer, not guessed from internal props.
                composer = page.locator('.k-composer textarea')
                expect(composer).to_be_visible(); composer.fill('鍵について教えて')
                composer.press('Enter')
                expect(page.locator('.k-bubble').last).to_contain_text('鍵について教えて')
                page.wait_for_function("!document.querySelector('.k-composer textarea')?.disabled")
                page.wait_for_timeout(400)
                debug = page.request.get(args.base + '/api/chat/debug', params={'session_id': sid}).json()
                assert debug['generation']['validation']['ok']
                assert '鍵は青い。' in debug['generation']['raw_prompt']
                assert debug['settings']['library_binding']['character']['revision'] == 1
                page.keyboard.press('Control+Shift+D')
                expect(page.get_by_text('互換設定・Loreの採用結果', exact=True)).to_be_visible()
                page.keyboard.press('Control+Shift+D')
                page.get_by_role('button', name='キャラ・プリセット', exact=True).click()
                happy = next(a for a in item['document']['assets'] if a['type'] == 'emotion')
                with page.expect_response(lambda r: '/api/chat/settings' in r.url and r.request.method == 'PUT') as saved:
                    page.get_by_label('表情', exact=True).select_option(happy['asset_id'])
                assert saved.value.ok
                expect(page.locator('.k-chat-header img')).to_have_attribute('src', '/api/library/assets/' + happy['asset_id'])
                page.reload(); expect(page.locator('.k-bubble').last).to_contain_text('鍵について教えて')
                expect(page.locator('.k-chat-header img')).to_have_attribute('src', '/api/library/assets/' + happy['asset_id'])
                page.screenshot(path=str(output / f'chat-{width}-{theme}.png'), full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'horizontal overflow'
                assert not errors, errors
                results.append({'width': width, 'theme': theme, 'status': 'pass', 'character_id': item['id']})
                context.close()
        # Real BYAF paths + chosen history are exercised through the visible import UI.
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.goto(args.base + '/#/create'); page.wait_for_load_state('networkidle')
        blob, _ = byaf_sample()
        page.get_by_label('取り込むファイル', exact=True).set_input_files({'name': 'world.byaf', 'mimeType': 'application/zip', 'buffer': blob})
        expect(page.get_by_role('heading', name='取り込み内容を確認')).to_be_visible()
        page.get_by_label('アリス · 図書館を取り込む', exact=True).uncheck()
        page.get_by_label('森（2メッセージ）', exact=True).check()
        page.get_by_role('button', name='選択した内容を保存', exact=True).click()
        page.get_by_role('link', name='移行した会話を開く：森', exact=True).click()
        expect(page.locator('.k-bubble').last).to_contain_text('選択された返答')
        # Cancellation does not create library objects.
        count = len(page.request.get(args.base + '/api/library').json()['items'])
        page.goto(args.base + '/#/create'); page.wait_for_load_state('networkidle')
        page.get_by_text('Character.AIの設定やLoreを貼り付ける', exact=True).click()
        page.get_by_label('移行する設定テキスト').fill('Name: Cancelled\nDescription: sample\nDefinition: Keep exactly this definition.')
        page.get_by_role('button', name='貼り付け内容を確認').click()
        expect(page.get_by_label('Definition（原文）')).to_have_value('Keep exactly this definition.')
        page.get_by_role('button', name='キャンセル', exact=True).click()
        assert len(page.request.get(args.base + '/api/library').json()['items']) == count
        results.append({'byaf_history_selection': 'pass', 'cai_cancel': 'pass'})
        # A standalone ST profile can be copied into an existing character revision.
        profile_name = 'ST-' + uuid.uuid4().hex[:8]
        preset = json.dumps({'name': profile_name, 'temperature': .4, 'top_p': .9, 'max_tokens': 333}).encode()
        page.get_by_label('取り込むファイル', exact=True).set_input_files({'name': 'preset.json', 'mimeType': 'application/json', 'buffer': preset})
        expect(page.get_by_label('名前', exact=True)).to_have_value(profile_name)
        page.get_by_role('button', name='選択した内容を保存', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('1件を保存')
        profile = next(i for i in page.request.get(args.base + '/api/library').json()['items'] if i['document']['name'] == profile_name)
        cid = results[0]['character_id']
        page.goto(args.base + '/#/create?edit=' + cid)
        page.get_by_text('生成プリセットと詳細な設定', exact=True).click()
        page.get_by_label('保存したプリセットを適用').select_option(profile['id'])
        expect(page.get_by_label('生成パラメータ（JSON）')).to_have_value(re.compile('333'))
        page.get_by_role('button', name='設定を保存', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('保存しました')
        revised = page.request.get(args.base + '/api/library/' + cid).json()
        assert revised['revision'] == 2 and revised['document']['profile']['settings']['temperature'] == .4
        assert revised['document']['data']['attached_profile'] == {'id': profile['id'], 'revision': 1, 'name': profile_name}
        results.append({'st_profile_copy_and_revision': 'pass'})
        browser.close()
    (output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    main()
