"""Read-only acceptance of the published docs and crawler-facing HTTP behavior."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from check_docs import Page

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/landing-site'
ORIGIN = 'https://kyalulu.com'
EVIDENCE = ROOT / '.artifacts/docs-review-public'


def fetch(path: str, agent: str = 'Mozilla/5.0'):
    request = Request(ORIGIN + path, headers={'User-Agent': agent})
    try:
        response = urlopen(request, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.geturl(), dict(response.headers.items()), response.read()


def check_page(path: str):
    status, final_url, headers, raw = fetch(path)
    assert status == 200 and final_url == ORIGIN + path, (path, status, final_url)
    headers = {key.lower(): value for key, value in headers.items()}
    assert headers['content-type'].startswith('text/html'), path
    assert 'content-security-policy' in headers and headers.get('cache-control') == 'no-cache', path
    expected = (OUTPUT / path.lstrip('/') / 'index.html').read_bytes()
    assert raw == expected, f'Public content differs from reviewed build: {path}'
    page = Page(raw.decode('utf-8'))
    assert page.select('link', rel='canonical')[0]['href'] == ORIGIN + path
    assert 'index,follow' in page.select('meta', name='robots')[0]['content']
    return {'path': path, 'status': status, 'sha256': hashlib.sha256(raw).hexdigest(), 'canonical': ORIGIN + path}


def run():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((OUTPUT / 'docs/build-manifest.json').read_text(encoding='utf-8'))
    with ThreadPoolExecutor(max_workers=6) as executor:
        pages = list(executor.map(check_page, manifest['pages']))
    robots_status, _, robots_headers, robots_raw = fetch('/robots.txt')
    assert robots_status == 200 and robots_raw == (OUTPUT / 'robots.txt').read_bytes()
    assert 'text/plain' in next(value for key, value in robots_headers.items() if key.lower() == 'content-type')
    sitemap_status, _, _, sitemap_raw = fetch('/sitemap.xml')
    assert sitemap_status == 200 and sitemap_raw == (OUTPUT / 'sitemap.xml').read_bytes()
    sitemap = ET.fromstring(sitemap_raw)
    sitemap_urls = sitemap.findall('{http://www.sitemaps.org/schemas/sitemap/0.9}url')
    assert len(sitemap_urls) == 36
    for path in ['/llms.txt', '/docs/llms-full.txt']:
        status, _, headers, raw = fetch(path)
        headers = {key.lower(): value for key, value in headers.items()}
        assert status == 200 and headers['content-type'].startswith('text/plain')
        assert headers.get('x-robots-tag') == 'noindex'
        assert raw == (OUTPUT / path.lstrip('/')).read_bytes()
    status, _, _, raw = fetch('/docs/nonexistent-guide/')
    assert status == 404 and 'noindex' in raw.decode('utf-8')
    assert fetch('/docs/content/sources.json')[0] == 404
    assert fetch('/docs/quickstart')[1] == ORIGIN + '/docs/quickstart/'
    assert fetch('/docs/quickstart/index.html')[1] == ORIGIN + '/docs/quickstart/'
    crawlers = []
    for agent in ['Googlebot', 'bingbot', 'OAI-SearchBot', 'ChatGPT-User']:
        for path in ['/robots.txt', '/docs/quickstart/']:
            status, _, headers, raw = fetch(path, agent)
            headers = {key.lower(): value for key, value in headers.items()}
            assert status == 200 and 'cf-mitigated' not in headers, (agent, path, status)
            expected = OUTPUT / ('robots.txt' if path == '/robots.txt' else 'docs/quickstart/index.html')
            assert raw == expected.read_bytes(), (agent, path)
            crawlers.append({'agent': agent, 'path': path, 'status': status})
    for path, expected in [('/', 'index.html'), ('/en/', 'en/index.html')]:
        assert fetch(path)[3] == (OUTPUT / expected).read_bytes(), f'Landing page mismatch: {path}'
    result = {'passed': True, 'origin': ORIGIN, 'pages': pages, 'sitemap_urls': len(sitemap_urls), 'crawler_checks': crawlers, 'real_404': True, 'canonical_redirects': True, 'supplemental_text_indexed': False, 'inference_attempts': 0}
    (EVIDENCE / 'http-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({**result, 'pages': len(pages)}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    run()
