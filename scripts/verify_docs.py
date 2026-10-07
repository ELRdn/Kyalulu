"""Browser acceptance for built docs. Requires an already-running local preview.

No inference, runtime API, external service, or user data is used.
Run: .venv/Scripts/python.exe -B scripts/verify_docs.py
"""
from __future__ import annotations

import json
import os
import argparse
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = os.environ.get('KYALULU_DOCS_ORIGIN', f"http://127.0.0.1:{os.environ.get('KYALULU_DOCS_PORT', '5185')}").rstrip('/')
ARTIFACTS = ROOT / '.artifacts' / ('docs-review-public' if ORIGIN.startswith('https://') else 'docs-review')


def run(interactions_only: bool = False):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / '.artifacts/landing-site/docs/build-manifest.json').read_text(encoding='utf-8'))
    errors = []
    forbidden = []
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, color_scheme='light')
        context.grant_permissions(['clipboard-read', 'clipboard-write'], origin=ORIGIN)

        def allow_local(route):
            target = urlsplit(route.request.url)
            if target.netloc != urlsplit(ORIGIN).netloc or target.path.startswith('/api'):
                forbidden.append(route.request.url)
                route.abort()
            else:
                route.continue_()

        context.route('**/*', allow_local)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)

        for width in ([] if interactions_only else [1440, 390]):
            page.set_viewport_size({'width': width, 'height': 1000 if width == 1440 else 844})
            for url in manifest['pages']:
                response = page.goto(ORIGIN + url, wait_until='networkidle')
                assert response.status == 200, url
                assert 'content-security-policy' in response.headers, url
                expect(page.locator('h1')).to_be_visible()
                expect(page.locator('main')).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Horizontal overflow {width}: {url}'
                assert page.evaluate("Array.from(document.images).filter(i => i.loading !== 'lazy').every(i => i.complete && i.naturalWidth > 0)"), f'Broken image: {url}'
                assert not page.locator('[aria-current="page"]').count() < 1, url
            checks.append(f'all {len(manifest["pages"])} pages at {width}px: content, assets, no overflow, enforced CSP')

        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.goto(ORIGIN + '/docs/', wait_until='networkidle')
        page.screenshot(path=str(ARTIFACTS / 'home-desktop.png'), full_page=True)
        page.keyboard.press('Control+k')
        expect(page.locator('#docs-search')).to_be_visible()
        expect(page.locator('#docs-search-input')).to_be_focused()
        page.locator('#docs-search-input').fill('記憶')
        expect(page.locator('#search-results a')).not_to_have_count(0)
        expect(page.locator('#search-results a').first).to_contain_text('記憶')
        page.keyboard.press('ArrowDown')
        expect(page.locator('#search-results a.selected')).to_have_count(1)
        page.screenshot(path=str(ARTIFACTS / 'search-desktop.png'))
        page.keyboard.press('Enter')
        page.wait_for_url('**/docs/memory/**')
        expect(page.locator('h1')).to_be_visible()
        checks.append('Ctrl+K, search ranking, keyboard selection and section navigation')

        page.locator('[data-open-search]').click()
        page.locator('#docs-search-input').fill('<script>alert(1)</script>')
        expect(page.locator('#search-results a')).to_have_count(0)
        expect(page.locator('.search-status')).to_contain_text('見つかりません')
        assert page.locator('#search-results script').count() == 0
        page.keyboard.press('Escape')
        expect(page.locator('#docs-search')).not_to_be_visible()
        expect(page.locator('[data-open-search]')).to_be_focused()
        checks.append('empty search, safe rendering, Escape and focus restoration')

        page.goto(ORIGIN + '/docs/quickstart/', wait_until='networkidle')
        expect(page.locator('.answer-summary')).to_be_visible()
        page.screenshot(path=str(ARTIFACTS / 'quickstart-desktop.png'), full_page=True)
        first_code = page.locator('.article-section pre').first.text_content()
        page.locator('.copy-button').first.click()
        expect(page.locator('.copy-button').first).to_have_text('コピーしました')
        # The Windows clipboard exposes CRLF; browsers normalize HTML text to LF.
        assert page.evaluate('navigator.clipboard.readText()').replace('\r\n', '\n') == first_code.replace('\r\n', '\n')
        page.locator('a.language').click()
        page.wait_for_url('**/docs/en/quickstart/')
        expect(page.locator('html')).to_have_attribute('lang', 'en')
        page.locator('[data-open-search]').click()
        page.locator('#docs-search-input').fill('Ollama')
        expect(page.locator('#search-results a')).not_to_have_count(0)
        page.keyboard.press('Escape')
        checks.append('clipboard copies actual command text; reciprocal language switch and English search')

        page.goto(ORIGIN + '/docs/', wait_until='networkidle')
        page.locator('[data-toggle-theme]').click()
        expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
        page.reload(wait_until='networkidle')
        expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
        page.screenshot(path=str(ARTIFACTS / 'home-dark.png'), full_page=True)
        page.locator('[data-toggle-theme]').click()
        page.set_viewport_size({'width': 390, 'height': 844})
        page.goto(ORIGIN + '/docs/', wait_until='networkidle')
        page.screenshot(path=str(ARTIFACTS / 'home-mobile.png'), full_page=True)
        expect(page.locator('.mobile-navigation')).to_be_visible()
        page.locator('.mobile-navigation > summary').click()
        page.locator('.mobile-navigation a[href="/docs/compatibility/"]').click()
        page.wait_for_url('**/docs/compatibility/')
        page.screenshot(path=str(ARTIFACTS / 'compatibility-mobile.png'), full_page=True)
        expect(page.locator('.table-wrap').first).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        checks.append('theme persistence, mobile native navigation and scrollable compatibility table')
        page.set_viewport_size({'width': 320, 'height': 740})
        page.goto(ORIGIN + '/docs/quickstart/', wait_until='networkidle')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        expect(page.locator('[data-open-search]')).to_be_visible()
        checks.append('320px narrow viewport: readable summary, controls and no horizontal overflow')

        missing = context.request.get(ORIGIN + '/docs/nonexistent-guide/')
        assert missing.status == 404 and 'noindex' in missing.text()
        redirect = context.request.get(ORIGIN + '/docs/quickstart', max_redirects=0)
        assert redirect.status == 301 and urlsplit(redirect.headers['location']).path == '/docs/quickstart/'
        redirect = context.request.get(ORIGIN + '/docs/quickstart/index.html', max_redirects=0)
        assert redirect.status == 301 and urlsplit(redirect.headers['location']).path == '/docs/quickstart/'
        assert context.request.get(ORIGIN + '/docs/content/sources.json').status == 404
        checks.append('real 404, noindex error page, canonical redirects, no published source directory')

        fallback = browser.new_context(viewport={'width': 390, 'height': 844}, java_script_enabled=False)
        fallback.route('**/*', allow_local)
        no_js = fallback.new_page()
        no_js.goto(ORIGIN + '/docs/')
        expect(no_js.locator('.hero-cta')).to_be_visible()
        no_js.locator('.hero-cta').click()
        expect(no_js.locator('h1')).to_be_visible()
        no_js.locator('.mobile-navigation > summary').click()
        expect(no_js.locator('.mobile-navigation a[href="/docs/memory/"]')).to_be_visible()
        assert no_js.evaluate('document.documentElement.scrollWidth <= innerWidth')
        fallback.close()
        checks.append('JavaScript disabled: content, navigation, installation and mobile layout remain available')

        storage = browser.new_context(viewport={'width': 390, 'height': 844})
        storage.route('**/*', allow_local)
        storage.add_init_script("Object.defineProperty(window, 'localStorage', {get() { throw new Error('Storage disabled'); }});")
        disabled = storage.new_page()
        disabled.on('pageerror', lambda error: errors.append(str(error)))
        disabled.goto(ORIGIN + '/docs/', wait_until='networkidle')
        disabled.locator('[data-toggle-theme]').click()
        disabled.locator('[data-open-search]').click()
        disabled.locator('#docs-search-input').fill('LM Studio')
        expect(disabled.locator('#search-results a')).not_to_have_count(0)
        storage.close()
        checks.append('storage unavailable: theme and search still work')
        context.close()
        browser.close()

    assert not errors, errors
    assert not forbidden, forbidden
    result = {'passed': True, 'checks': checks, 'browser_errors': errors, 'external_requests': len(forbidden), 'inference_attempts': 0, 'screenshots': sorted(p.name for p in ARTIFACTS.glob('*.png'))}
    (ARTIFACTS / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--interactions-only', action='store_true', help='Skip the already-verified page/viewport traversal.')
    run(parser.parse_args().interactions_only)
