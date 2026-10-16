"""Offline-browser privacy acceptance; only urllib fetches the public Google tag.

Run: python -B scripts/verify_seo_analytics.py
Requires the existing Playwright installation and Chromium; never rebuilds sources.
All browser requests are fulfilled or aborted. Transport is mocked, not GA receipt.
"""
from __future__ import annotations

import hashlib
import json
import mimetypes
import re
import time
from datetime import datetime, timezone
from fnmatch import fnmatchcase
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / '.artifacts/landing-site'
OUT = ROOT / '.artifacts/beta-first-ten-20261012/analytics-browser'
ID = 'G-14CZ0KMM2M'
TAG_URL = 'https://www.googletagmanager.com/gtag/js?id=' + ID
SECRET_QUERY = 'code=SECRET&token=SECRET&utm_term=SECRET&character_id=SECRET&session_id=SECRET&name=SECRET'
CAMPAIGN = '&utm_source=chatgpt&utm_medium=referral&utm_campaign=seo-aeo-20261012'
PRIVATE_PROPS = {key: 'SECRET' for key in ('character_id', 'session_id', 'name', 'user_id', 'email', 'message', 'memory')}
REDACT = {'cid', 'sid', '_p', '_s', 'sct', 'uid', 'gclid', 'dclid', 'gclsrc'}
OBSERVE_MS = 12000  # Covers the tag's ten-second engagement threshold and unload.


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fields(url, body):
    common = dict(parse_qsl(urlsplit(url).query, keep_blank_values=True))
    return [common | dict(parse_qsl(line, keep_blank_values=True)) for line in (body.splitlines() or [''])]


def sanitized_query(query):
    return urlencode([(key, '[redacted]' if key in REDACT else value)
                      for key, value in parse_qsl(query, keep_blank_values=True)])


def sanitized_url(url):
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, sanitized_query(parts.query), ''))


def self_check():
    assert fields('https://example.com/g/collect?en=page_view&cid=123', 'dl=https%3A%2F%2Fkyalulu.com%2F')[0]['dl'] == 'https://kyalulu.com/'
    assert '123' not in sanitized_query('cid=123&en=page_view')
    assert 'SECRET' in sanitized_query('dl=SECRET'), 'Synthetic leaks must not be hidden by redaction'
    assert len(fields('https://example.com/?tid=G-TEST', 'en=login\nen=chat_completed')) == 2


class Harness:
    def __init__(self, browser, files, core, tag, rules):
        self.browser, self.files, self.core, self.tag, self.rules = browser, files, core, tag, rules
        self.transport, self.google, self.external, self.violations, self.errors = [], [], [], [], []
        self.csp_errors = []
        self.case = ''
        self.contexts = []

    def context(self, *, fixture=False, blocked=False, delayed=False, js=True):
        context = self.browser.new_context(viewport={'width': 390, 'height': 844},
                                           java_script_enabled=js, service_workers='block')
        self.contexts.append(context)
        held = []

        def route_request(route):
            request = route.request
            target = urlsplit(request.url)
            host = target.hostname or ''
            google = host == 'googletagmanager.com' or host.endswith('.googletagmanager.com') or host == 'google-analytics.com' or host.endswith('.google-analytics.com')
            if google:
                self.google.append({'case': self.case, 'url': sanitized_url(request.url), 'method': request.method})
                values = [cookie['value'] for cookie in context.cookies()
                          if cookie['name'] == 'kyalulu_analytics_consent']
                if not values or any(value != 'granted' for value in values):
                    self.violations.append({'case': self.case, 'reason': 'Google request without current granted consent',
                                            'url': sanitized_url(request.url)})
                raw = request.url + '\n' + (request.post_data or '') + '\n' + request.headers.get('referer', '')
                if 'SECRET' in unquote(unquote(raw)):
                    self.violations.append({'case': self.case, 'reason': 'SECRET in Google transport'})
                diagnostic = host == 'www.googletagmanager.com' and target.path in {'/a', '/td'}
                if target.path.endswith('/collect') or target.path == '/collect' or diagnostic:
                    body = request.post_data or ''
                    self.transport.append({'case': self.case, 'kind': 'tag_diagnostic' if diagnostic else 'analytics_collect', 'method': request.method,
                                           'url': sanitized_url(request.url),
                                           'body': '\n'.join(sanitized_query(line) for line in body.splitlines()),
                                           'fields': [{key: '[redacted]' if key in REDACT else value
                                                       for key, value in hit.items()} for hit in fields(request.url, body)]})
                    route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*'}, body='')
                elif request.url == TAG_URL:
                    if request.headers.get('referer'):
                        self.violations.append({'case': self.case, 'reason': 'Tag script has a document referrer'})
                    if blocked:
                        route.abort()
                    elif delayed:
                        held.append(route)
                    else:
                        route.fulfill(status=200, content_type='text/javascript', body=self.tag)
                else:
                    self.violations.append({'case': self.case, 'reason': 'Unexpected Google endpoint', 'url': sanitized_url(request.url)})
                    route.abort()
                return
            if host in {'kyalulu.com', 'cloud.kyalulu.com', 'app.kyalulu.com', 'localhost'}:
                if target.path.startswith('/api') or request.method != 'GET':
                    self.violations.append({'case': self.case, 'reason': 'API or mutation attempt'})
                    route.abort()
                    return
                if fixture:
                    if target.path == '/analytics-core.js':
                        route.fulfill(status=200, content_type='text/javascript', body=self.core)
                    elif request.resource_type == 'document':
                        route.fulfill(status=200, content_type='text/html', body='<html lang="en"><title>SECRET private character and session</title><main><h1>Analytics test fixture</h1><a href="/next/">Navigation</a></main></html>')
                    else:
                        route.fulfill(status=404, body='')
                    return
                path = unquote(target.path)
                filename = path.lstrip('/') + ('index.html' if path.endswith('/') else '')
                data = self.files.get(filename)
                headers = {'Content-Type': mimetypes.guess_type(filename)[0] or 'application/octet-stream'}
                if filename.endswith('.js'):
                    headers['Content-Type'] = 'text/javascript'
                for pattern, values in self.rules:
                    if fnmatchcase(path, pattern):
                        headers.update(values)
                route.fulfill(status=200 if data is not None else 404, headers=headers,
                              body=data if data is not None else self.files.get('404.html', b'Not found'))
                return
            self.external.append({'case': self.case, 'host': host, 'path': target.path, 'action': 'abort'})
            if host not in {'fonts.googleapis.com', 'fonts.gstatic.com'}:
                self.violations.append({'case': self.case, 'reason': 'Unexpected external request', 'host': host})
            route.abort()

        context.route('**/*', route_request)
        def watch_page(page):
            page.on('pageerror', lambda error: self.errors.append({'case': self.case, 'error': str(error)}))
            page.on('console', lambda message: self.csp_errors.append({'case': self.case, 'error': message.text})
                    if re.search(r'content security policy|content-security-policy', message.text, re.I) else None)
        context.on('page', watch_page)
        return context, context.new_page(), held

    def hits(self, since=0):
        return [hit for item in self.transport[since:] for hit in item['fields']]

    def wait_event(self, page, name, since=0):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            hits = [hit for hit in self.hits(since) if hit.get('en') == name]
            if hits:
                return hits
            page.wait_for_timeout(100)
        raise AssertionError(f'No mocked collect for {name}; observed events: {[hit.get("en") for hit in self.hits(since)]}')

    def fixture(self, url, **kwargs):
        context, page, held = self.context(fixture=True, **kwargs)
        page.goto(url, wait_until='domcontentloaded')
        page.evaluate("async id => { const a = await import('/analytics-core.js'); a.initAnalytics({measurementId:id, language:'en', cloud:true}); }", ID)
        return context, page, held


def consent(page, value):
    return page.evaluate("async value => (await import('/analytics-core.js')).analyticsConsent(value)", value)


def emit(page, name, kind='chat'):
    return page.evaluate("async args => (await import('/analytics-core.js')).analyticsEvent(args.name, args.props)",
                         {'name': name, 'props': PRIVATE_PROPS | {'page_kind': kind, 'language': 'en'}})


def assert_metadata(hits, location, kind, language='en'):
    for hit in hits:
        assert hit.get('tid') == ID, hit
        assert hit.get('dl') == location, hit
        assert hit.get('dt') == 'Kyalulu | ' + kind, hit
        assert hit.get('dr', '') in {'', 'https://referrer.example'}, hit
        # gtag maps its reserved language parameter to ul, not ep.language.
        assert hit.get('ep.page_kind') == kind and hit.get('ul') == language, hit
        assert not any('SECRET' in value for value in hit.values()), hit


def assert_empty(items):
    assert not items, items


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    checks = []
    result = {'label': 'transport mocked; actual Google gtag JavaScript executed; not real GA receipt',
              'started_utc': datetime.now(timezone.utc).isoformat(), 'real_ga_hits': 0,
              'inference_attempts': 0, 'cloud_account_operations': 0,
              'limitations': ['Cloud shared-core fixture only; parent verifies live guest UI.',
                              'Revocation observation is bounded to 12 seconds plus unload, not indefinite.',
                              'Fresh isolated Chromium contexts; no browser profiles or credentials accessed.']}
    h = None

    def check(name, action):
        if h:
            h.case = name
        started = time.monotonic()
        try:
            action()
            item = {'name': name, 'status': 'PASS'}
        except Exception as error:
            item = {'name': name, 'status': 'FAIL', 'error': str(error)}
        finally:
            if h:
                for context in h.contexts:
                    context.close()
                h.contexts.clear()
        item['seconds'] = round(time.monotonic() - started, 2)
        checks.append(item)
        print(json.dumps(item, ensure_ascii=False), flush=True)

    try:
        self_check()
        files = {str(path.relative_to(BUILD)).replace('\\', '/'): path.read_bytes()
                 for path in BUILD.rglob('*') if path.is_file()}
        core = (ROOT / 'packages/analytics/analytics.js').read_bytes()
        assert files and '_headers' in files and 'analytics-core.js' in files, 'Missing built landing site'
        rules = []
        for line in files['_headers'].decode().splitlines():
            if line.startswith('/'):
                rules.append((line.strip(), {}))
            elif line.startswith('  ') and rules:
                key, value = line.strip().split(':', 1)
                rules[-1][1][key] = value.strip()
        # Only this public script download can reach the network; no browser cookie jar.
        request = Request(TAG_URL, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'})
        with urlopen(request, timeout=30) as response:
            assert response.status == 200 and response.geturl() == TAG_URL, 'Unexpected public tag response/redirect'
            tag = response.read()
        assert len(tag) > 10000 and ID.encode() in tag, 'Actual Google tag was not returned'
        result['hashes'] = {'script': sha(Path(__file__).read_bytes()), 'shared_core': sha(core),
                            'public_gtag': sha(tag), 'built_files': {name: sha(data) for name, data in sorted(files.items())}}
        result['hashes']['static_wrapper_source'] = sha((ROOT / 'apps/landing/analytics.js').read_bytes())
        result['public_tag_download'] = {'url': TAG_URL, 'bytes': len(tag), 'credentials': False}
        with sync_playwright() as p:
            browser = p.chromium.launch()
            result['chromium_version'] = browser.version
            h = Harness(browser, files, core, tag, rules)

            def fresh_build():
                assert files['analytics-core.js'] == core, 'Built analytics-core.js differs from shared source; parent must rebuild before final acceptance'
                assert sha(files['analytics.js']) == result['hashes']['static_wrapper_source'], 'Built static analytics.js is stale; parent must rebuild'
            check('built shared-core fingerprint matches', fresh_build)

            for width in (320, 390, 1440):
                def layout(width=width):
                    _, page, _ = h.context()
                    page.set_viewport_size({'width': width, 'height': 1000 if width == 1440 else 844})
                    for path, prefix in (('/en/', 'landing'), ('/docs/en/', 'docs')):
                        response = page.goto('https://kyalulu.com' + path, wait_until='networkidle')
                        if prefix == 'docs':
                            assert 'content-security-policy' in response.headers, 'Generated CSP not preserved'
                        expect(page.locator('html')).to_have_attribute('lang', 'en')
                        expect(page.locator('h1')).to_be_visible()
                        expect(page.locator('.analytics-consent')).to_be_hidden()
                        page.locator('.analytics-settings').click()
                        expect(page.locator('.analytics-consent')).to_be_visible()
                        expect(page.get_by_role('button', name='Agree to terms and privacy and enable analytics', exact=True)).to_be_visible()
                        expect(page.get_by_role('button', name='Disable analytics', exact=True)).to_be_visible()
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'{path}: overflow at {width}px'
                        page.screenshot(path=str(OUT / f'{prefix}-consent-en-{width}.png'))
                    assert not h.google[-1:] or h.google[-1]['case'] != h.case, 'Google request before consent'
                check(f'English LP/docs consent and no overflow {width}px', layout)

            def rejection():
                _, page, _ = h.context()
                start = len(h.google)
                page.goto('https://kyalulu.com/docs/en/?' + SECRET_QUERY, wait_until='networkidle')
                page.wait_for_timeout(1000)
                assert len(h.google) == start, 'Google requested before consent'
                if not page.locator('[data-accept]').is_visible(): page.locator('.analytics-settings').click()
                page.locator('[data-deny]').click()
                page.reload(wait_until='networkidle')
                expect(page.locator('.analytics-consent')).to_be_hidden()
                assert emit(page, 'page_view', 'docs') is False
                page.wait_for_timeout(OBSERVE_MS)
                assert len(h.google) == start, 'Google requested after rejection'
            check('before consent and persisted rejection: zero Google requests', rejection)

            for path, kind in (('/en/', 'landing'), ('/docs/en/', 'docs')):
                def acceptance(path=path, kind=kind):
                    context, page, _ = h.context()
                    start = len(h.transport)
                    page.goto('https://kyalulu.com' + path + '?' + SECRET_QUERY + CAMPAIGN,
                              referer='https://referrer.example/private/SECRET?token=SECRET', wait_until='networkidle')
                    if not page.locator('[data-accept]').is_visible(): page.locator('.analytics-settings').click()
                    page.locator('[data-accept]').click()
                    hits = h.wait_event(page, 'page_view', start)
                    assert_metadata(hits, 'https://kyalulu.com' + path, kind)
                    for hit in hits:
                        assert (hit.get('cs'), hit.get('cm'), hit.get('cn')) == ('chatgpt', 'referral', 'seo-aeo-20261012'), hit
                        assert not any(key in hit for key in ('ck', 'cc')), 'utm_term/content leaked'
                    if kind == 'landing':
                        return
                    page.goto('https://kyalulu.com/docs/en/quickstart/', wait_until='networkidle')
                    h.wait_event(page, 'local_install_guide_open', start)
                    page.wait_for_timeout(OBSERVE_MS)
                    assert any(c['name'].startswith('_ga') for c in context.cookies()), 'Actual tag created no GA cookies'
                    # Accessible path/domain variants must be cleared, not just the default cookie.
                    page.evaluate("document.cookie='_ga_fixture=synthetic; Path=/docs/; Secure; SameSite=Lax'; document.cookie='_ga_nested=synthetic; Path=/docs/en/quickstart/; Domain=kyalulu.com; Secure; SameSite=Lax'")
                    page.locator('.analytics-settings').click()
                    page.locator('[data-deny]').click()
                    revoked = len(h.transport)
                    assert not page.evaluate("document.cookie.split(';').some(c => c.trim().startsWith('_ga'))"), 'Accessible GA cookie survives revoke'
                    assert not any(c['name'].startswith('_ga') for c in context.cookies()), 'GA cookie survives revoke'
                    assert emit(page, 'chat_completed') is False
                    page.evaluate("document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pagehide'))")
                    page.wait_for_timeout(OBSERVE_MS)
                    page.goto('https://kyalulu.com/docs/en/privacy/', wait_until='networkidle')
                    page.wait_for_timeout(OBSERVE_MS)
                    assert len(h.transport) == revoked, 'Collect after revoke/engagement/unload'
                check(f'{kind}: actual tag safe page_view, whitelist' + ('; revoke, cookies, engagement/unload' if kind == 'docs' else ''), acceptance)

            for language, prefix in (('ja', '/docs/'), ('en', '/docs/en/')):
                def first_grant(language=language, prefix=prefix):
                    _, page, _ = h.context()
                    start = len(h.transport)
                    google_start = len(h.google)
                    path = prefix + 'quickstart/'
                    page.goto('https://kyalulu.com' + path + '?' + SECRET_QUERY, wait_until='networkidle')
                    expect(page.locator('html')).to_have_attribute('lang', language)
                    panel = page.locator('.analytics-consent')
                    expect(panel).to_contain_text('仮名ID' if language == 'ja' else 'pseudonymous cookie IDs')
                    page.screenshot(path=str(OUT / f'quickstart-first-grant-{language}.png'))
                    assert len(h.google) == google_start, 'Quickstart requested Google before consent'
                    if not page.locator('[data-accept]').is_visible(): page.locator('.analytics-settings').click()
                    page.locator('[data-accept]').click()
                    assert_metadata(h.wait_event(page, 'local_install_guide_open', start), 'https://kyalulu.com' + path, 'docs', language)
                    # Repeated acceptance in this document must not duplicate successful views.
                    page.locator('.analytics-settings').click()
                    page.locator('[data-accept]').click()
                    page.wait_for_timeout(6000)
                    assert len([hit for hit in h.hits(start) if hit.get('en') == 'local_install_guide_open']) == 1, 'First grant guide event duplicated'
                    assert len([hit for hit in h.hits(start) if hit.get('en') == 'page_view']) == 1, 'First grant page_view duplicated'
                check(language + ' quickstart first grant: guide/page_view exactly once, cookie disclosure', first_grant)

                def cloud_link(language=language, prefix=prefix):
                    _, page, _ = h.context()
                    page_start = len(h.transport)
                    page.goto('https://kyalulu.com' + prefix + 'cloud/', wait_until='networkidle')
                    if not page.locator('[data-accept]').is_visible(): page.locator('.analytics-settings').click()
                    page.locator('[data-accept]').click()
                    h.wait_event(page, 'page_view', page_start)
                    start = len(h.transport)
                    link = page.locator('main a[href="https://cloud.kyalulu.com/"], main a[href="https://cloud.kyalulu.com/#/discover"]').first
                    expect(link).to_be_visible()
                    # Cancel navigation only after the real document click handler sees the link.
                    page.evaluate("document.addEventListener('click', event => { if (event.target.closest('a')?.href.startsWith('https://cloud.kyalulu.com/')) event.preventDefault(); })")
                    link.click()
                    assert_metadata(h.wait_event(page, 'cloud_open', start), 'https://kyalulu.com' + prefix + 'cloud/', 'docs', language)
                    page.wait_for_timeout(6000)
                    assert len([hit for hit in h.hits(start) if hit.get('en') == 'cloud_open']) == 1, 'Real Cloud guide link event duplicated'
                check(language + ' Cloud guide actual root CTA: cloud_open exactly once', cloud_link)

            def cloud():
                _, page, _ = h.fixture('https://cloud.kyalulu.com/?' + SECRET_QUERY + CAMPAIGN + '#/chats/SECRET')
                start = len(h.transport)
                assert emit(page, 'chat_completed') is False
                assert consent(page, 'granted') == 'granted'
                for name in ('page_view', 'login', 'chat_completed', 'chat_reopened'):
                    assert emit(page, name) is True
                    assert_metadata(h.wait_event(page, name, start), 'https://cloud.kyalulu.com/', 'chat')
                assert emit(page, 'SECRET') is False
                page.wait_for_timeout(OBSERVE_MS)
                assert consent(page, 'denied') == 'denied'
                revoked = len(h.transport)
                assert emit(page, 'login') is False
                page.goto('https://cloud.kyalulu.com/next/', wait_until='networkidle')
                page.wait_for_timeout(OBSERVE_MS)
                assert len(h.transport) == revoked, 'Cloud collect after revoke/unload'
            check('Cloud shared core: actual tag login/chat, sensitive URL/title/props, revoke', cloud)

            def campaign_rejection():
                for query in ('utm_source=SECRET&utm_medium=SECRET&utm_campaign=SECRET',
                              'utm_source=chatgpt&utm_source=SECRET&utm_medium=referral&utm_medium=SECRET&utm_campaign=docs&utm_campaign=SECRET'):
                    _, page, _ = h.fixture('https://cloud.kyalulu.com/?' + query + '#/chats/SECRET')
                    start = len(h.transport)
                    consent(page, 'granted')
                    emit(page, 'page_view')
                    for hit in h.wait_event(page, 'page_view', start):
                        assert not any(key in hit for key in ('cs', 'cm', 'cn', 'ck', 'cc')), hit
            check('campaign unknown and duplicate values excluded from actual transport', campaign_rejection)

            def queued_revoke():
                _, page, held = h.fixture('https://cloud.kyalulu.com/?code=SECRET#/chats/SECRET', delayed=True)
                consent(page, 'granted')
                emit(page, 'page_view')
                page.wait_for_timeout(200)
                assert len(held) == 1, 'Tag load was not held'
                consent(page, 'denied')
                start = len(h.transport)
                held.pop().fulfill(status=200, content_type='text/javascript', body=tag)
                page.wait_for_timeout(OBSERVE_MS)
                assert len(h.transport) == start, 'Queued pre-revocation command replayed'
                assert consent(page, 'granted') == 'granted'
                emit(page, 'login')
                assert_metadata(h.wait_event(page, 'login', start), 'https://cloud.kyalulu.com/', 'chat')
            check('pending actual tag: revoke drops queue; reaccept works', queued_revoke)

            for origin in ('https://app.kyalulu.com', 'http://localhost'):
                def gated(origin=origin):
                    start = len(h.google)
                    _, page, _ = h.fixture(origin + '/?code=SECRET#/chats/SECRET')
                    for value in ('granted', 'denied', 'granted'):
                        assert consent(page, value) is None
                        assert emit(page, 'page_view') is False
                    page.wait_for_timeout(1000)
                    assert len(h.google) == start, 'Disabled hostname loaded Google tag'
                check(origin + ': no tag despite consent actions', gated)

            def blocked_navigation():
                _, page, _ = h.context(blocked=True)
                start = len(h.transport)
                page.goto('https://kyalulu.com/docs/en/', wait_until='networkidle')
                if not page.locator('[data-accept]').is_visible(): page.locator('.analytics-settings').click()
                page.locator('[data-accept]').click()
                page.wait_for_timeout(1000)
                page.locator('a.hero-cta').click()
                page.wait_for_url('**/docs/en/quickstart/')
                expect(page.locator('h1')).to_be_visible()
                expect(page.locator('[data-open-search]')).to_be_visible()
                page.locator('[data-open-search]').click()
                page.locator('#docs-search-input').fill('Ollama')
                expect(page.locator('#search-results a')).not_to_have_count(0)
                page.screenshot(path=str(OUT / 'docs-blocked-tag-navigation.png'))
                assert len(h.transport) == start, 'Blocked tag sent collect'
            check('blocked Google script: ordinary docs navigation and search function', blocked_navigation)

            def no_js():
                _, page, _ = h.context(js=False)
                start = len(h.google)
                for width in (320, 390, 1440):
                    page.set_viewport_size({'width': width, 'height': 844})
                    for path in ('/', '/en/', '/docs/', '/docs/en/'):
                        page.goto('https://kyalulu.com' + path, wait_until='networkidle')
                        expect(page.locator('h1')).to_be_visible()
                        expect(page.locator('main')).to_be_visible()
                        english = 'en/' in path
                        target = '/docs/' + ('en/' if english else '') + 'quickstart/'
                        selector = 'a.hero-cta' if path.startswith('/docs/') else f'a.btn[href="{target}"]'
                        expect(page.locator(selector).first).to_be_visible()
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'No-JS overflow: {path} {width}'
                        if not path.startswith('/docs/'):
                            text = page.locator('body').inner_text()
                            assert not re.search(r'\b(?:npm|npx)\b', text, re.I), 'Future npm installation promise remains'
                            assert page.locator('form, input[type="email"], a[href="#waitlist"]').count() == 0, 'Waitlist registration CTA remains'
                        if width == 390:
                            prefix = 'docs' if path.startswith('/docs/') else 'landing'
                            page.screenshot(path=str(OUT / f'{prefix}-no-js-{"en" if english else "ja"}.png'))
                assert len(h.google) == start, 'Google requested with JavaScript disabled'
            check('no JavaScript: ja/en public content and CTA at all widths; no future npm/waitlist registration', no_js)

            check('all intercepted Google transports contain no secrets or unexpected destinations',
                  lambda: assert_empty(h.violations))
            check('no uncaught browser errors', lambda: assert_empty(h.errors))
            check('generated CSP: no browser security policy violations', lambda: assert_empty(h.csp_errors))
            browser.close()
        result['source_changed_during_run'] = (ROOT / 'packages/analytics/analytics.js').read_bytes() != core
        result['build_changed_files'] = [name for name, digest in result['hashes']['built_files'].items()
                                         if not (BUILD / name).exists() or sha((BUILD / name).read_bytes()) != digest]
        result['build_changed_during_run'] = bool(result['build_changed_files'])
        result['static_wrapper_changed_during_run'] = sha((ROOT / 'apps/landing/analytics.js').read_bytes()) != result['hashes']['static_wrapper_source']
        result['script_changed_during_run'] = sha(Path(__file__).read_bytes()) != result['hashes']['script']
        def stable_snapshot():
            assert not any(result[key] for key in ('source_changed_during_run', 'build_changed_during_run',
                                                   'static_wrapper_changed_during_run', 'script_changed_during_run')), 'Sources/build changed during verification; rerun after parent finishes'
        check('verified hashes still match final sources and built files', stable_snapshot)
    except Exception as error:
        checks.append({'name': 'setup/execution', 'status': 'FAIL', 'error': str(error)})
    result.update({'checks': checks, 'passed': all(item['status'] == 'PASS' for item in checks),
                   'pass_count': sum(item['status'] == 'PASS' for item in checks),
                   'fail_count': sum(item['status'] == 'FAIL' for item in checks),
                   'screenshots': sorted(path.name for path in OUT.glob('*.png'))})
    if h:
        result.update({'google_requests': h.google, 'transport': h.transport,
                       'external_aborted': h.external, 'violations': h.violations, 'browser_errors': h.errors,
                       'csp_errors': h.csp_errors})
    (OUT / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = ['# Analytics browser verification', '', result['label'], '',
             f"PASS: {result['pass_count']}; FAIL: {result['fail_count']}; real GA hits: 0; inference: 0.", '']
    lines += [f"- {item['status']}: {item['name']}" + (f" — {item['error']}" if 'error' in item else '') for item in checks]
    lines += ['', '## Limits', ''] + ['- ' + limit for limit in result['limitations']]
    lines += ['', 'Exact SHA-256 fingerprints, sanitized URL/body transport and screenshot filenames: results.json.',
              f"Source/build changed during run: {result.get('source_changed_during_run', 'unknown')}/{result.get('build_changed_during_run', 'unknown')}."]
    (OUT / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f"PASS {result['pass_count']}; FAIL {result['fail_count']}; report: {OUT / 'results.json'}")
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(run())
