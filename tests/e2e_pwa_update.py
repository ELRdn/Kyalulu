"""Real Chromium installability/update check against the isolated e2e_mobile server.

Temporarily changes ONLY generated dist/sw.js; restores it even on failure.
The local test certificate exception must never be used for a deployed server.
"""
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def main():
    worker = Path('apps/web/dist/sw.js')
    original = worker.read_text(encoding='utf-8')
    output = Path('.artifacts/mobile-v1')
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=[
            '--host-resolver-rules=MAP mobile.kyalulu.test 127.0.0.1',
            '--no-proxy-server', '--ignore-certificate-errors',
        ])
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()
        try:
            page.goto('https://mobile.kyalulu.test:8443/#/chats')
            page.wait_for_function('!!navigator.serviceWorker.controller')
            install = context.new_cdp_session(page).send('Page.getInstallabilityErrors')
            assert install['installabilityErrors'] == [], install
            (output / 'installability.json').write_text(json.dumps(install, indent=2), encoding='utf-8')
            page.locator('.k-mobile-status summary').click()
            worker.write_text(original.replace('const VERSION = "', 'const VERSION = "update-check-'), encoding='utf-8')
            page.get_by_role('button', name='更新を確認', exact=True).click()
            expect(page.get_by_role('button', name='更新して再読み込み', exact=True)).to_be_visible(timeout=20000)
            other = context.new_page()
            other.goto('https://mobile.kyalulu.test:8443/#/chats')
            page.on('dialog', lambda dialog: dialog.accept())
            page.get_by_role('button', name='更新して再読み込み', exact=True).click()
            expect(page.get_by_text('ほかのKyaluluタブやウィンドウを閉じてから更新してください。', exact=True)).to_be_visible()
            other.close()
            page.get_by_role('button', name='更新して再読み込み', exact=True).click()
            page.wait_for_function('document.querySelector(".k-mobile-status__details")?.open === false', timeout=20000)
            expect(page.get_by_label('登録コード', exact=True)).to_be_visible()
            result = {'update_detected': True, 'multi_tab_update_blocked': True, 'explicit_update_applied': True}
            (output / 'update-acceptance.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            print(json.dumps(result))
        finally:
            worker.write_text(original, encoding='utf-8')
            browser.close()


if __name__ == '__main__':
    main()
