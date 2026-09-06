"""Headless acceptance against isolated, running API + Vite servers.

Run: python tests/e2e_phase0.py --base http://127.0.0.1:5174 --chromium PATH
The API MUST use KYALULU_DATA_DIR and KYALULU_EXPERIMENTS_DIR test directories.
"""
import argparse
import json
import uuid
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:5174')
    parser.add_argument('--chromium')
    args = parser.parse_args()
    output = Path('.artifacts/e2e')
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
        for width in (1440, 390):
            for theme in ('light', 'dark'):
                context = browser.new_context(viewport={'width': width, 'height': 1000}, color_scheme=theme)
                context.add_init_script(f"localStorage.setItem('my-zeta-theme','{theme}');localStorage.setItem('my-zeta-model','mock-echo');localStorage.setItem('my-zeta-researcher','1');localStorage.setItem('kyalulu-context-panel-open','0');")
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(args.base + '/#/research')
                expect(page.locator('[data-col="0"]')).to_be_visible()
                first = page.locator('[data-col="0"] [data-turn]').first
                for tab in ('Prompt', 'Token', 'State', 'Settings', 'Telemetry', 'Validation'):
                    first.get_by_role('button', name=tab, exact=True).click()
                    expect(first.locator('pre')).to_be_visible()
                if width == 1440:
                    # Independent scrolling, then actual linked scrolling.
                    page.locator('[data-col="0"]').evaluate('(e)=>e.scrollTop=800')
                    page.wait_for_timeout(120)
                    assert page.locator('[data-col="1"]').evaluate('(e)=>e.scrollTop') == 0
                    page.get_by_label('同期', exact=True).check()
                    page.locator('[data-col="0"]').evaluate('(e)=>e.scrollTop=1800')
                    page.wait_for_timeout(150)
                    assert page.locator('[data-col="1"]').evaluate('(e)=>e.scrollTop') > 500
                    page.get_by_label('同期', exact=True).uncheck()
                    page.get_by_title('A/B Focus', exact=True).first.click()
                    expect(page.locator('.k-research-col')).to_have_count(2)
                    page.get_by_title('A/B/C表示', exact=True).first.click()
                else:
                    page.locator('.k-research-mobile-tabs').get_by_role('button', name='B', exact=True).click()
                    expect(page.locator('[data-col="1"]')).to_be_visible()
                    expect(page.locator('[data-col="0"]')).not_to_be_visible()
                    page.locator('.k-research-mobile-tabs').get_by_role('button', name='A', exact=True).click()
                page.locator('[data-col="0"]').evaluate('(e)=>e.scrollTop=0')
                first.get_by_title('4', exact=True).click()
                first.get_by_placeholder('rater', exact=True).fill('e2e-reviewer')
                first.get_by_placeholder('コメント（任意）', exact=True).fill('保存と復元の確認')
                with page.expect_response('**/api/ratings') as response:
                    first.get_by_role('button', name='保存', exact=True).click()
                assert response.value.ok
                page.route('**/api/ratings', lambda route: route.fulfill(status=503, json={'error':'test save unavailable'}))
                first.get_by_role('button', name='保存', exact=True).click()
                expect(first.get_by_text('保存エラー:', exact=False)).to_be_visible()
                page.unroute('**/api/ratings')
                if width == 1440 and theme == 'light':
                    with page.expect_download() as download:
                        page.get_by_role('link', name='export', exact=True).first.click()
                    download.value.save_as(str(output / 'export.json'))
                    assert len(json.loads((output / 'export.json').read_text(encoding='utf-8'))['turns']) == 20
                    with page.expect_response('**/rerun') as replay:
                        page.get_by_role('button', name='↻ replay', exact=True).first.click()
                    assert replay.value.ok
                    new_id = replay.value.json()['results'][0]['experiment_id']
                    expect(page.locator('.k-research-col').first).to_contain_text(new_id)
                page.screenshot(path=str(output / f'research-{width}-{theme}.png'))
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'horizontal page overflow'
                sid = 'e2e-' + str(uuid.uuid4())[:8]
                page.goto(args.base + '/#/chats/' + sid)
                composer = page.locator('.k-composer__input')
                expect(composer).to_be_enabled()
                composer.fill('こんにちは、テスト会話です')
                page.get_by_role('button', name='送信', exact=True).click()
                expect(page.locator('.k-bubble--character')).to_contain_text('Mock:')
                expect(page.get_by_role('button', name='再生成', exact=True)).to_be_visible()
                page.get_by_role('button', name='再生成', exact=True).click()
                expect(page.locator('.k-bubble--character')).to_have_count(1)
                expect(page.get_by_role('button', name='再生成', exact=True)).to_be_visible()
                page.reload()
                expect(page.locator('.k-bubble--character')).to_contain_text('Mock:')
                page.keyboard.press('Control+Shift+D')
                expect(page.get_by_role('dialog')).to_be_visible()
                expect(page.get_by_role('dialog')).to_contain_text('検証')
                page.screenshot(path=str(output / f'debug-{width}-{theme}.png'))
                page.keyboard.press('Control+Shift+D')
                expect(page.get_by_role('dialog')).not_to_be_visible()
                page.screenshot(path=str(output / f'chat-{width}-{theme}.png'))
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                if width == 1440 and theme == 'light':
                    page.get_by_role('button', name='編集', exact=True).last.click()
                    page.locator('.k-bubble textarea').fill('編集後の返答')
                    page.get_by_role('button', name='保存', exact=True).click()
                    expect(page.locator('.k-bubble--character')).to_contain_text('編集後の返答')
                    record = page.request.get(args.base + '/api/chat/debug?session_id=' + sid).json()
                    assert record['state']['turn'] == 0 and not record['generation']['snapshot_valid']
                    # Saving settings is a real gate, including failures.
                    streams = []
                    page.on('request', lambda req: streams.append(req) if req.url.endswith('/api/chat/stream') else None)
                    page.route('**/api/chat/settings', lambda route: route.fulfill(status=503, json={'error':'save failed'}) if route.request.method == 'PUT' else route.continue_())
                    composer.fill('設定失敗テスト')
                    page.get_by_role('button', name='送信', exact=True).click()
                    expect(page.get_by_text('設定保存に失敗したため送信しませんでした:', exact=False)).to_be_visible()
                    assert not streams
                    page.unroute('**/api/chat/settings')
                    # Hold the stream and switch sessions within the same mounted page.
                    held = []
                    page.route('**/api/chat/stream', lambda route: held.append(route))
                    composer.fill('古い会話の生成')
                    page.get_by_role('button', name='送信', exact=True).click()
                    expect(page.get_by_role('button', name='■ 停止', exact=True)).to_be_visible()
                    page.wait_for_timeout(150)
                    assert len(held) == 1
                    page.evaluate("location.hash = '#/chats/e2e-switch-target'")
                    expect(page.locator('.k-chat-header__name')).to_have_text('e2e-switch-target')
                    expect(composer).to_be_enabled()
                    held[0].fulfill(content_type='text/event-stream', body='event: token\ndata: {"token":"古い返答"}\n\nevent: done\ndata: {"full":"古い返答"}\n\n')
                    page.wait_for_timeout(100)
                    expect(page.locator('.k-chat-messages')).not_to_contain_text('古い返答')
                    held.clear()
                    composer.fill('中断テスト')
                    page.get_by_role('button', name='送信', exact=True).click()
                    expect(page.get_by_role('button', name='■ 停止', exact=True)).to_be_visible()
                    page.wait_for_timeout(100)
                    page.get_by_role('button', name='■ 停止', exact=True).click()
                    expect(composer).to_be_enabled()
                    if held:
                        held[0].abort()
                    page.unroute('**/api/chat/stream')
                    expect(page.locator('.k-bubble--character')).to_have_count(0)
                    page.goto(args.base + '/#/characters/mocha_sfw')
                    page.get_by_role('button', name='Start Chat ✦', exact=True).click()
                    expect(page.locator('.k-chat-header__name')).to_have_text('モカちゃん（日常）')
                    expect(composer).to_be_enabled()
                    page.get_by_role('button', name='パネルを開く', exact=True).click()
                    page.get_by_role('button', name='ミニマル', exact=True).click()
                    with page.expect_response(lambda r: r.url.endswith('/api/chat/settings') and r.request.method == 'PUT'):
                        page.wait_for_timeout(1000)
                    new_sid = page.url.split('/')[-1]
                    settings = page.request.get(args.base + '/api/chat/settings?session_id=' + new_sid).json()
                    assert settings['character_id'] == 'mocha_sfw'
                    assert 'kyalulu:narration-style:minimal' in settings['system_prompt']
                assert not errors, errors
                checks.append({'width':width, 'theme':theme, 'status':'passed'})
                print(checks[-1], flush=True)
                context.close()
        browser.close()
    (output / 'result.json').write_text(json.dumps(checks, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
