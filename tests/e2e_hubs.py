"""Live curated Hub -> preview -> durable draft -> chat; isolated API data required."""
import argparse
import json
import re
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:5190')
    args = parser.parse_args()
    out = Path('.artifacts/hub-e2e'); out.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for width in (1440, 390):
            for theme in ('light', 'dark'):
                context = browser.new_context(viewport={'width': width, 'height': 1000}, color_scheme=theme)
                context.add_init_script(f"localStorage.setItem('my-zeta-theme','{theme}');localStorage.setItem('my-zeta-model','mock-echo');localStorage.setItem('my-zeta-researcher','1');localStorage.setItem('kyalulu-context-panel-open','0');")
                page = context.new_page(); errors = []; requests = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('request', lambda r: requests.append(r.url))
                page.goto(args.base + '/#/discover'); page.wait_for_load_state('networkidle')
                assert not any('/api/hubs/' in u for u in requests), 'Local Discover made a Hub request'
                page.get_by_role('tab', name='SillyTavern Contentを見る', exact=True).click()
                expect(page.get_by_role('heading', name='Coding Sensei', exact=True)).to_be_visible(timeout=60000)
                page.get_by_label('Hubの検索語').fill('no-result-unique')
                page.get_by_role('button', name='検索', exact=True).click()
                expect(page.get_by_role('status')).to_contain_text('条件に合う', timeout=60000)
                page.get_by_label('Hubの検索語').fill('Coding')
                page.get_by_role('button', name='検索', exact=True).click()
                page.get_by_role('button', name='詳細を見る', exact=True).click(timeout=60000)
                expect(page.get_by_text('RossAscends', exact=True)).to_be_visible(timeout=60000)
                page.screenshot(path=str(out / f'discover-{width}-{theme}.png'), full_page=True)
                page.get_by_role('button', name='取り込み内容を確認', exact=True).click()
                expect(page.get_by_label('名前', exact=True)).to_have_value('Coding Sensei', timeout=60000)
                name = f'Hub-{width}-{theme}-{uuid.uuid4().hex[:6]}'
                page.get_by_label('名前', exact=True).fill(name)
                page.get_by_label('文体・話し方', exact=True).fill('短く、日本語で。')
                if page.get_by_label('新しい項目として複製する', exact=True).count():
                    page.get_by_label('新しい項目として複製する', exact=True).check()
                preview_url = page.url
                page.reload(); page.wait_for_load_state('networkidle')
                expect(page.get_by_label('名前', exact=True)).to_have_value(name)
                expect(page.get_by_label('文体・話し方', exact=True)).to_have_value('短く、日本語で。')
                page.route('**/api/imports/*/commit', lambda route: route.fulfill(status=503, json={'error': 'hub save unavailable'}))
                page.get_by_role('button', name='選択した内容を保存', exact=True).click()
                expect(page.get_by_role('alert')).to_contain_text('hub save unavailable')
                page.reload(); page.wait_for_load_state('networkidle')
                expect(page.get_by_label('名前', exact=True)).to_have_value(name)
                page.unroute('**/api/imports/*/commit')
                page.get_by_role('button', name='選択した内容を保存', exact=True).click()
                expect(page.get_by_role('status')).to_contain_text('1件を保存')
                item = next(i for i in page.request.get(args.base + '/api/library').json()['items'] if i['document']['name'] == name)
                assert item['document']['source']['remote']['origin_verified'] is True
                tile = page.get_by_role('heading', name=name, exact=True).locator('..')
                tile.get_by_role('button', name='書き出し', exact=True).click()
                page.get_by_label('書き出し形式').select_option('backup')
                page.get_by_role('button', name='書き出し内容を確認').click()
                with page.expect_download() as dl:
                    page.get_by_role('link', name='をダウンロード', exact=False).click()
                assert Path(dl.value.path()).stat().st_size > 100
                tile.get_by_role('link', name='キャラを開く').click()
                page.get_by_role('button', name='会話をはじめる', exact=True).click()
                expect(page).to_have_url(re.compile(r'#/chats/'))
                expect(page.locator('.k-bubble').first).to_contain_text('Hello world')
                composer = page.locator('.k-composer textarea'); composer.fill('Pythonについて短く教えて')
                composer.press('Enter')
                expect(page.locator('.k-bubble').last).to_contain_text('mock', ignore_case=True, timeout=30000)
                page.keyboard.press('Control+Shift+D')
                expect(page.get_by_text('Hubの出典・取得記録', exact=True)).to_be_visible()
                page.screenshot(path=str(out / f'chat-debug-{width}-{theme}.png'), full_page=True)
                page.goto(preview_url); page.wait_for_load_state('networkidle')
                expect(page.get_by_text('同じ原本を取り込み済みです。', exact=True)).to_be_visible()
                expect(page.get_by_role('button', name='選択した内容を保存', exact=True)).to_be_disabled()
                page.get_by_label('新しい項目として複製する', exact=True).check()
                expect(page.get_by_role('button', name='選択した内容を保存', exact=True)).to_be_enabled()
                page.get_by_role('button', name='キャンセル', exact=True).click()
                expect(page.get_by_role('heading', name='取り込み内容を確認', exact=True)).not_to_be_visible()
                assert not errors, errors
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                results.append({'width': width, 'theme': theme, 'status': 'passed', 'source': item['document']['source']['remote']})
                context.close()
        # Real Risu browser CORS, guest download, unknown content rating, no automatic save.
        page = browser.new_page()
        page.goto(args.base + '/#/create?import=url'); page.wait_for_load_state('networkidle')
        page.get_by_label('取り込む公開URL', exact=True).fill('https://realm.risuai.net/character/a7a7b290-b0fd-4fe6-92e1-b093c05a0078')
        page.get_by_label('RisuRealmの取得形式').select_option('json-v3')
        page.get_by_role('button', name='URLの内容を確認').click()
        expect(page.get_by_label('名前', exact=True)).to_have_value('KITTY', timeout=60000)
        expect(page.get_by_role('button', name='選択した内容を保存', exact=True)).to_be_disabled()
        page.get_by_label('内容区分 1', exact=True).select_option('sfw')
        expect(page.get_by_role('button', name='選択した内容を保存', exact=True)).to_be_enabled()
        result = page.request.get(args.base + '/api/imports/' + page.url.split('preview=')[1]).json()
        assert result['documents'][0]['source']['remote']['origin_verified'] is False
        page.get_by_role('button', name='キャンセル', exact=True).click()
        results.append({'risu_browser_live': 'passed', 'source': result['documents'][0]['source']['remote']})
        page.goto(args.base + '/#/create?edit=' + item['id']); page.wait_for_load_state('networkidle')
        page.get_by_label('文体・話し方', exact=True).fill('編集画面の復元を確認')
        page.reload(); page.wait_for_load_state('networkidle')
        expect(page.get_by_label('文体・話し方', exact=True)).to_have_value('編集画面の復元を確認')
        page.get_by_role('button', name='閉じる', exact=True).click()
        page.get_by_role('button', name='新しく作る', exact=True).click()
        page.get_by_label('名前', exact=True).fill('Draft-' + uuid.uuid4().hex[:6])
        page.get_by_role('button', name='設定を保存', exact=True).click()
        expect(page.get_by_role('heading', name='設定を編集', exact=True)).to_be_visible()
        page.reload(); page.wait_for_load_state('networkidle')
        expect(page.get_by_role('heading', name='設定を編集', exact=True)).to_be_visible()
        results.append({'library_editor_restore_and_create': 'passed'})
        browser.close()
    (out / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps([{'status': r.get('status', 'passed'), 'width': r.get('width'), 'theme': r.get('theme'), 'risu_browser_live': r.get('risu_browser_live')} for r in results]))


if __name__ == '__main__': main()
