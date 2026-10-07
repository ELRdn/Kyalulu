"""Validate the generated public docs, using only the Python standard library."""
from __future__ import annotations

import hashlib
import base64
from html.parser import HTMLParser
from html import unescape
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts' / 'landing-site'
ORIGIN = 'https://kyalulu.com'


class Page(HTMLParser):
    def __init__(self, source: str):
        super().__init__(convert_charrefs=True)
        self.tags: list[tuple[str, dict]] = []
        self.ids: list[str] = []
        self.scripts: list[str] = []
        self._script: list[str] | None = None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        self.tags.append((tag, values))
        if values.get('id'):
            self.ids.append(values['id'])
        if tag == 'script' and values.get('type') == 'application/ld+json':
            self._script = []

    def handle_data(self, data):
        if self._script is not None:
            self._script.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self._script is not None:
            self.scripts.append(''.join(self._script))
            self._script = None

    def select(self, tag, **attrs):
        return [values for name, values in self.tags if name == tag and all(values.get(k) == v for k, v in attrs.items())]


def check() -> dict:
    manifest = json.loads((OUTPUT / 'docs/build-manifest.json').read_text(encoding='utf-8'))
    sources = json.loads((ROOT / 'apps/landing/docs/content/sources.json').read_text(encoding='utf-8'))
    headers = (OUTPUT / '_headers').read_text(encoding='utf-8')
    assert all(len(line) < 2000 for line in headers.splitlines()), 'Cloudflare header line limit'
    assert manifest['sourceCommit'] == sources['commit']
    assert len(manifest['pages']) == 2 * (manifest['articleCount'] + 1)
    pages: dict[str, Page] = {}
    titles = []
    descriptions = []
    for url in manifest['pages']:
        source = (OUTPUT / url.lstrip('/') / 'index.html').read_text(encoding='utf-8')
        assert '{{doc:' not in source, f'Unresolved link: {url}'
        page = Page(source)
        titles.append(source.split('<title>', 1)[1].split('</title>', 1)[0])
        descriptions.append(page.select('meta', name='description')[0]['content'])
        pages[url] = page
        assert len(page.select('h1')) == 1, f'Exactly one h1: {url}'
        assert len(page.ids) == len(set(page.ids)), f'Duplicate IDs: {url}'
        canonical = page.select('link', rel='canonical')
        assert len(canonical) == 1 and canonical[0]['href'] == ORIGIN + url, f'Canonical: {url}'
        assert page.select('meta', name='description')[0]['content'], f'Description: {url}'
        assert page.select('meta', property='og:url')[0]['content'] == ORIGIN + url
        language = 'en' if url.startswith('/docs/en/') else 'ja'
        assert page.select('html')[0]['lang'] == language
        alternate = {a['hreflang']: a['href'] for a in page.select('link', rel='alternate')}
        assert set(alternate) == {'ja', 'en', 'x-default'}, f'Language alternatives: {url}'
        assert alternate[language] == ORIGIN + url
        assert alternate['x-default'] == alternate['ja']
        assert page.select('main', id='main') and page.select('a', **{'class': 'skip-link'})
        for tag, attrs in page.tags:
            assert not any(key.startswith('on') for key in attrs), f'Inline handler: {url}'
            if tag == 'img':
                assert 'alt' in attrs and attrs.get('width') and attrs.get('height'), f'Image accessibility: {url}'
        assert len(page.scripts) == 1, f'JSON-LD: {url}'
        structured = json.loads(page.scripts[0])
        assert structured['@context'] == 'https://schema.org'
        assert any(item['@type'] == 'BreadcrumbList' for item in structured['@graph'])
        assert any(item.get('@id') == ORIGIN + '/#website' for item in structured['@graph'])
        assert any(item.get('@id') == ORIGIN + '/#software' for item in structured['@graph'])
        expected_hash = hashlib.sha256(page.scripts[0].encode()).digest()
        csp_hash = "'sha256-" + base64.b64encode(expected_hash).decode() + "'"
        assert f'{url}\n  Content-Security-Policy:' in headers and csp_hash in headers
        for item in structured['@graph']:
            if item['@type'] == 'TechArticle':
                assert item['url'] == ORIGIN + url
                assert item['mainEntityOfPage'] == ORIGIN + url
                assert item['about']['@id'] == ORIGIN + '/#software'
                assert item['abstract'] and page.select('h2', id='at-a-glance'), f'Missing visible answer summary: {url}'
                for citation in item['citation']:
                    prefix = f"https://github.com/{sources['repository']}/blob/{sources['commit']}/"
                    assert citation.startswith(prefix)
                    assert citation[len(prefix):] in sources['files'], f'Unverified citation: {url}'
            if item['@type'] == 'FAQPage':
                assert len(item['mainEntity']) >= 5

    assert len(titles) == len(set(titles)), 'Duplicate page titles'
    assert len(descriptions) == len(set(descriptions)), 'Duplicate page descriptions'
    for lang, url in [('ja', '/'), ('en', '/en/')]:
        source = (OUTPUT / url.lstrip('/') / 'index.html').read_text(encoding='utf-8')
        page = Page(source)
        assert len(page.select('h1')) == 1 and 'Kyalulu' in re.search(r'<h1\b[^>]*>(.*?)</h1>', source, re.S)[1]
        assert page.select('link', rel='canonical')[0]['href'] == ORIGIN + url
        assert {a['hreflang'] for a in page.select('link', rel='alternate')} == {'ja', 'en', 'x-default'}
        assert len(page.scripts) == 1, f'Landing JSON-LD: {url}'
        graph = json.loads(page.scripts[0])['@graph']
        assert {ORIGIN + '/#' + key for key in ['website', 'software', 'contributors']} <= {item.get('@id') for item in graph}
        software = next(item for item in graph if item['@type'] == 'SoftwareApplication')
        assert software['url'] == ORIGIN and 'https://github.com/ELRdn/Kyalulu' in software['sameAs']
        faq = next(item for item in graph if item['@type'] == 'FAQPage')
        assert len(faq['mainEntity']) == len(page.select('summary')), f'Landing visible FAQ count: {url}'
        visible_faq = [(unescape(re.sub('<[^>]+>', '', q)), unescape(re.sub('<[^>]+>', '', a))) for q, a in re.findall(r'<details[^>]*>\s*<summary[^>]*>(.*?)</summary>\s*<p[^>]*>(.*?)</p>\s*</details>', source, re.S)]
        assert [(item['name'], item['acceptedAnswer']['text']) for item in faq['mainEntity']] == visible_faq, f'Landing visible FAQ/schema mismatch: {url}'
        docs_graph = json.loads(pages['/docs/en/' if lang == 'en' else '/docs/'].scripts[0])['@graph']
        assert software == next(item for item in docs_graph if item['@type'] == 'SoftwareApplication'), f'Landing/Docs entity mismatch: {url}'
    for url, page in pages.items():
        for tag, attrs in page.tags:
            reference = attrs.get('href') if tag in {'a', 'link'} else attrs.get('src') if tag in {'script', 'img'} else None
            if not reference:
                continue
            parsed = urlsplit(reference)
            if parsed.scheme or parsed.netloc:
                continue
            target_url = parsed.path or url
            assert target_url.startswith('/'), f'Use absolute internal links: {url}: {reference}'
            if target_url in pages:
                target = pages[target_url]
            else:
                file = OUTPUT / unquote(target_url).lstrip('/')
                if target_url.endswith('/'):
                    file = file / 'index.html'
                assert file.is_file(), f'Broken internal link: {url}: {reference}'
                target = Page(file.read_text(encoding='utf-8')) if file.suffix == '.html' else None
            if parsed.fragment and target:
                assert unquote(parsed.fragment) in target.ids, f'Broken anchor: {url}: {reference}'
        alternatives = page.select('link', rel='alternate')
        for alt in alternatives:
            other = pages[urlsplit(alt['href']).path]
            reciprocal = {a['hreflang']: a['href'] for a in other.select('link', rel='alternate')}
            assert reciprocal == {a['hreflang']: a['href'] for a in alternatives}, f'Nonreciprocal hreflang: {url}'

    for lang, prefix in [('ja', '/docs/'), ('en', '/docs/en/')]:
        index = json.loads((OUTPUT / prefix.lstrip('/') / 'search-index.json').read_text(encoding='utf-8'))
        assert len(index) == manifest['articleCount']
        assert len({a['url'] for a in index}) == len(index)
        for article in index:
            assert article['url'] in pages
            assert article['url'].startswith(prefix)
            assert article['sections'] and article['keywords']
            for section in article['sections']:
                assert section['id'] in pages[article['url']].ids
    sitemap = ET.parse(OUTPUT / 'sitemap.xml').getroot()
    ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9', 'x': 'http://www.w3.org/1999/xhtml'}
    locations = [entry.find('s:loc', ns).text for entry in sitemap.findall('s:url', ns)]
    assert set(locations) == {ORIGIN + url for url in ['/', '/en/', *manifest['pages']]}
    assert len(locations) == len(set(locations))
    assert all(len(entry.findall('x:link', ns)) == 3 for entry in sitemap.findall('s:url', ns))
    assert 'Sitemap: https://kyalulu.com/sitemap.xml' in (OUTPUT / 'robots.txt').read_text()
    assert 'User-agent: OAI-SearchBot\nAllow: /' in (OUTPUT / 'robots.txt').read_text()
    llms = (OUTPUT / 'llms.txt').read_text(encoding='utf-8')
    full_text = (OUTPUT / 'docs/llms-full.txt').read_text(encoding='utf-8')
    assert sources['commit'] in llms and sources['commit'] in full_text
    for url in manifest['pages']:
        assert ORIGIN + url in llms
    for url in manifest['pages']:
        if url not in ['/docs/', '/docs/en/']:
            assert 'Canonical: ' + ORIGIN + url in full_text
    assert 'noindex' in (OUTPUT / '404.html').read_text(encoding='utf-8')
    assert '/docs/' in (OUTPUT / 'index.html').read_text(encoding='utf-8')
    assert '/docs/en/' in (OUTPUT / 'en/index.html').read_text(encoding='utf-8')
    assert not (OUTPUT / 'docs/content').exists(), 'Authored source must not be copied into the public bundle'
    unsafe = [p for p in OUTPUT.rglob('*') if p.is_file() and (p.name.startswith('.env') or p.suffix in {'.pem', '.key', '.sqlite', '.db', '.map', '.mjs', '.py'})]
    assert not unsafe, f'Unexpected build contents: {unsafe}'
    assert all(p.stat().st_size < 25 * 1024 * 1024 for p in OUTPUT.rglob('*') if p.is_file())
    return {'docs_pages': len(pages), 'articles': manifest['articleCount'], 'sitemap_urls': len(locations), 'source_commit': sources['commit'], 'checks': ['static content', 'internal links and anchors', 'reciprocal hreflang', 'canonical and metadata', 'JSON-LD and CSP', 'search indexes', 'source provenance', 'public bundle boundaries']}


if __name__ == '__main__':
    print(json.dumps(check(), ensure_ascii=False, indent=2))
