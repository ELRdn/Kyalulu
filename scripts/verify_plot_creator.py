"""Focused Create regression checks against an already-built web renderer.

Run from the repository in PowerShell (no build, server, or inference is started):
    ./.venv/Scripts/python.exe -B scripts/verify_plot_creator.py

Chromium serves built files through Playwright interception at a synthetic local
origin. Every API is mocked; unknown routes, external traffic, image uploads,
quotes and generation fail closed. Conversation setup/history use mocked storage.
Artifacts contain synthetic data only.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
import json
import mimetypes
from pathlib import Path
import re
import sys
import traceback
from urllib.parse import parse_qs, unquote, urlsplit
from uuid import UUID

from playwright.sync_api import Browser, Page, Route, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from python.core.portable_schema import PortableDocument  # noqa: E402

ORIGIN = 'http://127.0.0.1:18765'
TABS = ('プロット', '設定集', 'スタイル', 'イントロ', '紹介', '詳細')
JSON_LABEL = '生成パラメータ（JSON）'


def document(kind: str = 'character', name: str = '検証用の案内人') -> dict:
    """Use the real backend parser and include fields a UI must not discard."""
    return PortableDocument.model_validate({
        'kind': kind, 'name': name, 'nsfw': False,
        'data': {
            'description': '星の図書館を案内する。', 'personality': '落ち着いて親切。',
            'scenario': '架空の図書館。', 'first_mes': '図書館へようこそ。',
            'alternate_greetings': ['今日はどの本を探しますか？'],
            'extensions': {'synthetic_test': {'keep': ['unknown', 7]}},
            'character_book': {'scan_depth': 2, 'token_budget': 1024,
                               'entries': [], 'unknown_book_field': 'keep'},
            'unknown_data_field': {'keep': True},
        },
        'speaking_style': '丁寧で短い文章。',
        'profile': {'settings': {'temperature': 0.7}, 'variables': {'place': '図書館'},
                    'unknown_profile_field': {'keep': 'profile'}},
        'source_format': 'kyalulu', 'source': {'synthetic_original': {'keep': True}},
        'unknown_document_field': {'keep': ['portable', 1]},
    }).model_dump(mode='json')


class MockCloud:
    def __init__(self, dist: Path):
        self.dist = dist.resolve()
        self.owner = 'plot-account-a'
        self.accounts: dict[str, dict[str, dict]] = {}
        self.settings: dict[str, dict[str, dict]] = {}
        self.histories: dict[str, dict[str, list[dict]]] = {}
        self.commits: dict[str, dict[str, dict]] = {}
        self.calls: list[dict] = []
        self.writes: list[dict] = []
        self.blocked: list[str] = []
        self.page_errors: list[str] = []
        self.fail_next_save = False
        self.conflict_next_save = False
        self.lose_next_save_response = False
        self.seed(self.owner)

    def seed(self, owner: str) -> None:
        if owner not in self.accounts:
            self.accounts[owner] = {
                'fixture-character': {'id': 'fixture-character', 'revision': 3,
                    'document': document(name='保存済みの案内人'), 'original_id': None},
                'fixture-profile': {'id': 'fixture-profile', 'revision': 2,
                    'document': document('profile', '保存済みのプリセット'), 'original_id': None},
            }

    @property
    def items(self) -> dict[str, dict]:
        self.seed(self.owner)
        return self.accounts[self.owner]

    def reject(self, route: Route, reason: str) -> None:
        self.blocked.append(reason)
        route.abort('blockedbyclient')

    def route(self, route: Route) -> None:
        request = route.request
        url = urlsplit(request.url)
        if f'{url.scheme}://{url.netloc}' != ORIGIN:
            self.reject(route, f'external {request.method} {url.scheme}://{url.netloc}{url.path}')
            return
        if url.path.startswith('/api/'):
            try:
                self.api(route, url.path, parse_qs(url.query))
            except Exception as error:
                self.reject(route, f'mock contract: {request.method} {url.path}: {error}')
            return
        if request.method != 'GET':
            self.reject(route, f'static mutation {request.method} {url.path}')
            return
        path = (self.dist / (unquote(url.path).lstrip('/') or 'index.html')).resolve()
        if not path.is_relative_to(self.dist) or not path.is_file():
            self.reject(route, f'unknown static asset {url.path}')
            return
        mime = {'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html'}.get(
            path.suffix, mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
        route.fulfill(path=str(path), content_type=mime)

    def api(self, route: Route, path: str, query: dict) -> None:
        method = route.request.method
        self.calls.append({'owner': self.owner, 'method': method, 'path': path, 'query': query})
        # Only stored setup/history may be exercised; inference stays forbidden.
        if (((path.startswith('/api/chat') and path not in {'/api/chat/sessions', '/api/chat/settings',
                '/api/chat/intro/inject', '/api/chat/history'})
                and not (method == 'PUT' and re.fullmatch(r'/api/chat/history/\d+', path)))
                or re.search(r'quotes|generat|completions|experiments|suggest|inference', path)
                or path.startswith('/api/library/assets')):
            self.reject(route, f'forbidden API {method} {path}')
            return
        data, status = {}, 200
        settings = self.settings.setdefault(self.owner, {})
        histories = self.histories.setdefault(self.owner, {})
        if method == 'GET' and path in {'/api/mobile/status', '/api/cloud/status'}:
            data = {'cloud_mode': True, 'remote_mode': False, 'authenticated': True,
                    'administrative': False, 'owner_scope': self.owner}
        elif method == 'GET' and path == '/api/cloud/profile':
            data = {'revision': 0, 'display_name': 'UI検証', 'saved_characters': [], 'pinned_sessions': []}
        elif method == 'GET' and path in {'/api/characters', '/api/library'}:
            assert query.get('include_nsfw') == ['false'], 'cloud must request include_nsfw=false'
            data = {'characters': [{'id': item['id'], 'display_name': item['document']['name'],
                    'description': item['document']['data'].get('description', ''),
                    'intro': item['document']['data'].get('first_mes', ''), 'version': str(item['revision']),
                    'library_revision': item['revision'], 'nsfw': False}
                    for item in self.items.values() if item['document']['kind'] == 'character']}
            if path == '/api/library': data = {'items': list(self.items.values())}
        elif method == 'GET' and path in {'/api/chat/sessions', '/api/worlds', '/api/personas'}:
            data = {path.rsplit('/', 1)[1]: []}
        elif method == 'PUT' and path == '/api/chat/settings':
            body = json.loads(route.request.post_data)
            assert body['character_id'] in self.items, 'conversation must use a saved plot'
            item = self.items[body['character_id']]
            body['library_binding'] = {'character': {'id': item['id'], 'revision': item['revision']},
                                       'profile': None, 'lorebooks': [], 'expression_asset_id': None}
            settings[body['session_id']] = deepcopy(body)
            data = {'ok': True}
        elif method == 'GET' and path == '/api/chat/settings':
            data = settings[query['session_id'][0]]
        elif method == 'POST' and path == '/api/chat/intro/inject':
            sid = query['session_id'][0]
            intro = settings[sid]['intro']
            assert not histories.get(sid), 'intro must not be injected twice'
            histories[sid] = [{'id': 1, 'role': 'assistant', 'content': intro, 'session_id': sid}]
            data = {'injected': True, 'intro': intro}
        elif method == 'GET' and path == '/api/chat/history':
            data = {'history': histories.get(query['session_id'][0], [])}
        elif method == 'PUT' and re.fullmatch(r'/api/chat/history/\d+', path):
            message_id = int(path.rsplit('/', 1)[1])
            matches = [m for history in histories.values() for m in history if m['id'] == message_id]
            assert len(matches) == 1
            matches[0]['content'] = json.loads(route.request.post_data)['content']
            data = {'ok': True}
        elif method == 'GET' and path == '/api/models':
            data = {'models': [{'id': 'cloud-standard', 'display_name': '検証用の標準経路',
                               'provider_type': 'openrouter', 'provider_model': 'mock', 'quantization': ''}]}
        elif method == 'GET' and path == '/api/prompts/presets':
            data = {'presets': []}
        elif method == 'GET' and path.startswith('/api/memory/session/'):
            data = {'enabled': False, 'scope': 'mock-scope'}
        elif method == 'GET' and path in {'/api/memory', '/api/memory/events', '/api/memory/conflicts'}:
            data = {path.rsplit('/', 1)[1] if path != '/api/memory' else 'memories': []}
        elif method == 'GET' and re.fullmatch(r'/api/library/[^/]+', path):
            item = self.items.get(unquote(path.rsplit('/', 1)[1]))
            data, status = (item, 200) if item else ({'error': 'not_found'}, 404)
        elif ((method == 'POST' and path == '/api/library')
              or (method == 'PUT' and re.fullmatch(r'/api/library/[^/]+', path))):
            body = json.loads(route.request.post_data or '')
            raw = body if method == 'POST' else body['document']
            parsed = PortableDocument.model_validate(raw).model_dump(mode='json')
            assert parsed == raw, 'UI save must send the complete backend-compatible document'
            assert parsed['nsfw'] is False, 'cloud fixture must remain SFW'
            request_id = route.request.headers.get('idempotency-key')
            assert request_id and str(UUID(request_id)) == request_id, 'saves need a UUID idempotency header'
            commits = self.commits.setdefault(self.owner, {})
            saved = commits.get(request_id)
            item_id = unquote(path.rsplit('/', 1)[1]) if method == 'PUT' else saved['item']['id'] if saved else f'lib_created-{len(self.items)}'
            previous = self.items.get(item_id)
            fingerprint = {'document': parsed, 'target_id': item_id if method == 'PUT' else None,
                           'expected_revision': body.get('expected_revision'), 'operation': 'save'}
            attempt = {'owner': self.owner, 'method': method, 'id': item_id,
                       'document': deepcopy(parsed), 'expected_revision': body.get('expected_revision'),
                       'request_id': request_id}
            if saved and saved['fingerprint'] != fingerprint:
                data, status = {'error': 'request ID reused with different document'}, 409
            elif saved:
                data = deepcopy(saved['item'])
            elif self.fail_next_save:
                self.fail_next_save = False
                data, status = {'error': '保存に失敗しました。検証用の一時エラーです。'}, 503
            elif self.conflict_next_save:
                self.conflict_next_save = False
                assert previous is not None
                previous['revision'] += 1
                previous['document']['data']['description'] = '別の端末で保存した説明。'
                data, status = {'error': 'revision_conflict'}, 409
            elif method == 'PUT' and (previous is None or body['expected_revision'] != previous['revision']):
                data, status = {'error': 'revision_conflict'}, 409
            else:
                data = {'id': item_id, 'revision': previous['revision'] + 1 if previous else 1,
                        'document': parsed, 'original_id': previous['original_id'] if previous else None}
                self.items[item_id] = deepcopy(data)
                if request_id:
                    commits[request_id] = {'fingerprint': deepcopy(fingerprint), 'item': deepcopy(data)}
            self.writes.append({**attempt, 'status': status})
            if self.lose_next_save_response and status == 200:
                self.lose_next_save_response = False
                route.abort('internetdisconnected')
                return
        else:
            self.reject(route, f'unmocked API {method} {path}')
            return
        route.fulfill(status=status, content_type='application/json',
                      body=json.dumps(data, ensure_ascii=False))


def tab(page: Page, name: str) -> None:
    # Tabs include live counts and JSON warnings in their accessible names.
    control = page.get_by_role('tab', name=re.compile('^' + re.escape(name) + r'(?:\s|\d|$)'))
    control.click()
    expect(control).to_have_attribute('aria-selected', 'true')


def field(page: Page, label: str):
    return page.locator('.k-portable-editor').get_by_label(label, exact=True)


def save_button(page: Page):
    return page.locator('.k-create-editor-head__actions').get_by_role(
        'button', name=re.compile(r'^(保存|新しい版として保存)$'))


def assert_layout(page: Page) -> None:
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'viewport overflow'
    assert page.locator('#main').evaluate('(e) => e.scrollWidth <= e.clientWidth + 1'), 'main overflow'
    page.get_by_role('tablist').evaluate('e => e.scrollLeft = e.scrollWidth')
    tab(page, '詳細')  # The last tab must be reachable on narrow screens.
    assert page.locator('.k-create-editor-head').evaluate(
        "e => getComputedStyle(e).position === 'sticky'"), 'heading/actions must stay sticky'
    assert page.get_by_role('tablist').evaluate(
        "e => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)"), 'tabs must scroll horizontally'


def screenshot(page: Page, output: Path, name: str) -> None:
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    page.screenshot(path=str(output / f'{name}.png'), full_page=True)


def goto_create(page: Page, query: str = '') -> None:
    page.goto(ORIGIN + '/#/create' + query, wait_until='networkidle')


def new_item(page: Page, kind: str, output: Path | None = None, shot: str = '') -> None:
    goto_create(page)
    page.get_by_role('button', name='新しく作る', exact=True).first.click()
    chooser = page.get_by_role('dialog', name='何を作りますか？', exact=True)
    expect(chooser).to_be_visible()
    for label in ('プロット', '設定集', 'プリセット'):
        expect(chooser.get_by_role('button', name=re.compile(label))).to_have_count(1)
    for unavailable in ('AIとプロット', 'フィード', 'プラグイン'):
        expect(chooser.get_by_role('button', name=re.compile(unavailable))).to_have_count(0)
    if output:
        screenshot(page, output, shot)
    label = {'character': 'プロット', 'lorebook': '設定集', 'profile': 'プリセット'}[kind]
    chooser.get_by_role('button', name=re.compile(label)).click()
    expect(field(page, '名前')).to_be_visible()


def assert_preserved(saved: dict, original: dict) -> None:
    assert saved['schema_version'] == original['schema_version'] == 1
    for key in ('unknown_document_field', 'source', 'source_format', 'assets', 'histories', 'notices'):
        assert saved[key] == original[key], f'portable field lost: {key}'
    for key in ('unknown_data_field', 'extensions', 'character_book', 'alternate_greetings'):
        assert saved['data'][key] == original['data'][key], f'unknown/nested field lost: data.{key}'
    assert saved['profile'] == original['profile'], 'profile settings/unknown fields lost'


def save_and_wait(page: Page, mock: MockCloud, status: int = 200) -> dict:
    count = len(mock.writes)
    expect(save_button(page)).to_be_enabled()
    with page.expect_response(lambda response: response.url.startswith(ORIGIN + '/api/library')
                              and response.request.method in {'POST', 'PUT'}):
        save_button(page).click()
    expect(save_button(page)).to_be_enabled()
    assert len(mock.writes) == count + 1 and mock.writes[-1]['status'] == status
    if status == 200:
        expect(page.get_by_role('status').filter(has_text='保存しました')).to_be_visible()
    else:
        expect(page.locator('.k-create-banner--error')).to_be_visible()
    return mock.writes[-1]


def character_checks(page: Page, mock: MockCloud, output: Path, tag: str) -> dict:
    new_item(page, 'character', output, tag + '-chooser')
    expect(page.get_by_role('tab')).to_have_count(len(TABS))
    values = {'名前': '星の図書館の案内人', '説明': '星の図書館で本を探すお話。',
              '性格': '穏やかで好奇心が強い。', '文体・話し方': '短い丁寧語で話す。',
              '最初の挨拶': '星の図書館へようこそ。今日はどんな本を探しますか？'}
    for label in ('名前', '説明', '性格'):
        field(page, label).fill(values[label])
    expect(field(page, '名前').locator('..').locator('.k-plot-editor__count')).to_have_text(
        f"{len(values['名前'])}字")
    expect(page.locator('.k-portable-editor').get_by_role(
        'radio', name=re.compile('^プロット'))).to_be_checked()
    screenshot(page, output, tag + '-plot')
    for name in TABS:
        tab(page, name)
        if name == 'スタイル':
            field(page, '文体・話し方').fill(values['文体・話し方'])
        elif name == 'イントロ':
            field(page, '最初の挨拶').fill(values['最初の挨拶'])
            expect(page.locator('.k-plot-editor__preview').get_by_text(
                values['最初の挨拶'], exact=True)).to_be_visible()
            screenshot(page, output, tag + '-intro')
    assert_layout(page)
    # Exercise keyboard access across the horizontally clipped strip.
    page.get_by_role('tab', name='詳細', exact=True).press('Home')
    expect(page.get_by_role('tab', name='プロット', exact=True)).to_have_attribute('aria-selected', 'true')
    page.get_by_role('tab', name='プロット', exact=True).press('End')
    expect(page.get_by_role('tab', name='詳細', exact=True)).to_have_attribute('aria-selected', 'true')
    # Invalid raw text must survive leaving its tab AND unrelated document edits.
    raw = '{"temperature":'
    field(page, JSON_LABEL).fill(raw)
    expect(save_button(page)).to_be_disabled()
    # Cloud upload affordances must remain disabled even when their tab is hidden.
    for upload in page.locator('.k-portable-editor input[type=file]').all():
        expect(upload).to_be_disabled()
    writes_before = len(mock.writes)
    tab(page, 'プロット')
    expect(save_button(page)).to_be_disabled()
    field(page, '性格').fill(values['性格'] + '約束を守る。')
    values['性格'] += '約束を守る。'
    tab(page, '詳細')
    expect(field(page, JSON_LABEL)).to_have_value(raw)
    expect(save_button(page)).to_be_disabled()
    assert len(mock.writes) == writes_before, 'invalid JSON triggered a save'
    field(page, JSON_LABEL).fill('[]')  # Valid JSON with wrong object shape also blocks saving.
    expect(save_button(page)).to_be_disabled()
    field(page, JSON_LABEL).fill('{"temperature": 0.6}')
    expect(save_button(page)).to_be_enabled()
    for name, labels in (('プロット', ('名前', '説明', '性格')),
                        ('スタイル', ('文体・話し方',)), ('イントロ', ('最初の挨拶',))):
        tab(page, name)
        for label in labels:
            expect(field(page, label)).to_have_value(values[label])
    page.reload(wait_until='networkidle')
    tab(page, 'プロット')
    for label in ('名前', '説明', '性格'):
        expect(field(page, label)).to_have_value(values[label])
    tab(page, 'スタイル')
    expect(field(page, '文体・話し方')).to_have_value(values['文体・話し方'])
    tab(page, 'イントロ')
    expect(field(page, '最初の挨拶')).to_have_value(values['最初の挨拶'])
    tab(page, '詳細')
    assert json.loads(field(page, JSON_LABEL).input_value()) == {'temperature': 0.6}
    mock.fail_next_save = True
    failed = save_and_wait(page, mock, 503)
    page.reload(wait_until='networkidle')
    tab(page, 'プロット')
    expect(field(page, '名前')).to_have_value(values['名前'])
    first = save_and_wait(page, mock)
    assert first['request_id'] == failed['request_id'], 'unchanged retry after reload needs the same UUID'
    item_id = first['id']
    assert mock.items[item_id]['revision'] == 1 and first['document']['kind'] == 'character'
    assert first['document']['profile']['settings'] == {'temperature': 0.6}
    # A clean second browser has no session draft; it must read the mocked server item.
    reread = page.context.browser.new_context(service_workers='block')
    install_guard(reread, mock)
    try:
        other = reread.new_page()
        goto_create(other, '?edit=' + item_id)
        expect(field(other, '名前')).to_have_value(values['名前'])
        tab(other, 'イントロ')
        expect(field(other, '最初の挨拶')).to_have_value(values['最初の挨拶'])
    finally:
        reread.close()
    tab(page, 'プロット')
    field(page, '説明').fill(values['説明'] + '追記。')
    mock.conflict_next_save = True
    conflict = save_and_wait(page, mock, 409)
    expect(field(page, '説明')).to_have_value(values['説明'] + '追記。')
    # Real CAS conflicts keep rejecting the old revision, including after reload.
    page.reload(wait_until='networkidle')
    tab(page, 'プロット')
    expect(field(page, '説明')).to_have_value(values['説明'] + '追記。')
    conflict_retry = save_and_wait(page, mock, 409)
    assert conflict_retry['request_id'] == conflict['request_id']
    page.get_by_role('button', name='競合した版を確認', exact=True).click()
    review = page.get_by_role('dialog', name='別の端末で保存された版を確認', exact=True)
    expect(review).to_be_visible()
    review.get_by_text('保存済みの最新版', exact=True).click()
    expect(review.get_by_text(re.compile('別の端末で保存した説明。'))).to_be_visible()
    review.get_by_role('button', name='この下書きで編集を続ける', exact=True).click()
    update = save_and_wait(page, mock)
    assert update['method'] == 'PUT' and update['expected_revision'] == 2
    assert update['request_id'] != conflict_retry['request_id'], 'reviewing a new revision rotates the UUID'
    assert mock.items[item_id]['revision'] == 3
    return {'tabs': True, 'intro_preview': True, 'invalid_json_tab_persistence': True,
            'draft_reload': True, 'save_failure_retry': True, 'server_read_second_browser': True,
            'revision_conflict_retry': True, 'no_horizontal_overflow': True}


def library_checks(page: Page, mock: MockCloud, output: Path, tag: str) -> dict:
    original = deepcopy(mock.items['fixture-character']['document'])
    goto_create(page, '?edit=fixture-character')
    expect(field(page, '名前')).to_have_value(original['name'])
    field(page, '名前').fill('未知の設定を保つ案内人')
    saved = save_and_wait(page, mock)
    assert saved['expected_revision'] == 3 and mock.items['fixture-character']['revision'] == 4
    assert_preserved(saved['document'], original)
    new_item(page, 'lorebook')
    field(page, '名前').fill('検証用の設定集')
    page.get_by_role('button', name=re.compile(r'(?:＋\s*)?知識を追加$')).click()
    field(page, '設定 1の項目名').fill('星の図書館')
    field(page, '設定 1のキーワード').fill('図書館, 本')
    field(page, '設定 1の知識の本文').fill('星の図書館は架空の場所です。')
    screenshot(page, output, tag + '-lorebook')
    book = save_and_wait(page, mock)
    assert book['document']['kind'] == 'lorebook'
    entry = book['document']['data']['character_book']['entries'][0]
    assert entry['keys'] == ['図書館', '本'] and entry['content'] == '星の図書館は架空の場所です。'
    page.reload(wait_until='networkidle')
    expect(field(page, '設定 1の知識の本文')).to_have_value(entry['content'])
    new_item(page, 'profile')
    field(page, '名前').fill('検証用のプリセット')
    field(page, 'プリセットのシステム指示').fill('日本語で簡潔に返答する。')
    field(page, JSON_LABEL).fill('{"temperature":0.4,"top_p":0.9}')
    screenshot(page, output, tag + '-preset')
    preset = save_and_wait(page, mock)
    assert preset['document']['kind'] == 'profile'
    assert preset['document']['profile']['settings'] == {'temperature': 0.4, 'top_p': 0.9}
    page.reload(wait_until='networkidle')
    expect(field(page, 'プリセットのシステム指示')).to_have_value('日本語で簡潔に返答する。')
    return {'unknown_fields_preserved': True, 'new_lorebook_reload': True, 'new_preset_reload': True}


def conversation_checks(page: Page, mock: MockCloud, output: Path, tag: str) -> dict:
    item = next(item for item in mock.items.values() if item['id'].startswith('lib_')
                and item['document']['kind'] == 'character')
    goto_create(page, '?edit=' + item['id'])
    page.get_by_role('button', name='プロットを開く', exact=True).click()
    page.get_by_role('button', name='会話をはじめる', exact=True).click()
    draft = page.get_by_label('メッセージ', exact=True)
    expect(draft).to_be_enabled()
    sid = page.url.rsplit('/', 1)[1]
    settings = mock.settings[mock.owner][sid]
    assert settings['library_binding']['character'] == {'id': item['id'], 'revision': item['revision']}
    message = page.locator('.k-msg').filter(has_text=settings['intro'])
    expect(message).to_be_visible()
    message.get_by_role('button', name='編集', exact=True).click()
    page.locator('.k-msg.is-editing textarea').fill('挨拶を編集して保存する。')
    page.locator('.k-msg.is-editing').get_by_role('button', name='保存', exact=True).click()
    expect(page.locator('.k-msg').filter(has_text='挨拶を編集して保存する。')).to_be_visible()
    draft.fill('会話の下書きは自動送信しない。')
    page.reload(wait_until='networkidle')
    expect(page.get_by_label('メッセージ', exact=True)).to_have_value('会話の下書きは自動送信しない。')
    expect(page.locator('.k-msg').filter(has_text='挨拶を編集して保存する。')).to_be_visible()
    assert mock.settings[mock.owner][sid]['library_binding']['character']['revision'] == item['revision']
    screenshot(page, output, tag + '-conversation')
    return {'saved_plot_to_conversation': True, 'conversation_revision_pinned': True,
            'history_edit_reload': True, 'conversation_draft_reload_without_send': True}


def uncertain_save_checks(page: Page, mock: MockCloud) -> dict:
    new_item(page, 'character')
    field(page, '名前').fill('応答だけが失われた保存済みプロット')
    count = len(mock.writes)
    items_before = len(mock.items)
    mock.lose_next_save_response = True
    save_button(page).click()
    expect(page.locator('.k-create-banner--error')).to_contain_text('同じ保存IDで結果を確認します')
    expect(field(page, '名前')).to_have_value('応答だけが失われた保存済みプロット')
    expect(save_button(page)).to_be_enabled()
    assert len(mock.writes) == count + 1, 'uncertain save must not be retried automatically'
    lost = mock.writes[-1]
    # Lose the cached reply too: direct and reloaded retries must still use one item.
    mock.lose_next_save_response = True
    save_button(page).click()
    expect(page.locator('.k-create-banner--error')).to_contain_text('同じ保存IDで結果を確認します')
    expect(save_button(page)).to_be_enabled()
    assert mock.writes[-1]['request_id'] == lost['request_id']
    page.reload(wait_until='networkidle')
    retry = save_and_wait(page, mock)
    assert retry['request_id'] == lost['request_id'] and retry['id'] == lost['id']
    assert len(mock.items) == items_before + 1 and mock.items[lost['id']]['revision'] == 1
    # A completed save clears the request; edits use a fresh UUID and revision CAS.
    updated = save_and_wait(page, mock)
    assert updated['method'] == 'PUT' and updated['request_id'] != lost['request_id']
    # An edit committed before response loss must retry its original expected revision.
    field(page, '名前').fill('編集保存の応答が失われたプロット')
    mock.lose_next_save_response = True
    save_button(page).click()
    expect(page.locator('.k-create-banner--error')).to_contain_text('同じ保存IDで結果を確認します')
    expect(save_button(page)).to_be_enabled()
    edit_lost = mock.writes[-1]
    assert edit_lost['method'] == 'PUT' and edit_lost['request_id'] != updated['request_id']
    committed_revision = mock.items[edit_lost['id']]['revision']
    mock.lose_next_save_response = True
    save_button(page).click()
    expect(page.locator('.k-create-banner--error')).to_contain_text('同じ保存IDで結果を確認します')
    expect(save_button(page)).to_be_enabled()
    assert mock.writes[-1]['request_id'] == edit_lost['request_id']
    page.reload(wait_until='networkidle')
    edit_retry = save_and_wait(page, mock)
    assert edit_retry['request_id'] == edit_lost['request_id'] and edit_retry['id'] == edit_lost['id']
    assert edit_retry['expected_revision'] == edit_lost['expected_revision']
    assert mock.items[edit_lost['id']]['revision'] == committed_revision
    # Even identical text uses a new request after the confirmed revision advances.
    next_revision = save_and_wait(page, mock)
    assert next_revision['request_id'] != edit_retry['request_id']
    assert next_revision['expected_revision'] == committed_revision
    # Editing a failed PUT rotates the UUID, while reload keeps the edited request.
    field(page, '名前').fill('失敗した編集下書き')
    mock.fail_next_save = True
    edit_before_change = save_and_wait(page, mock, 503)
    field(page, '名前').fill('変更した編集下書き')
    mock.fail_next_save = True
    edit_after_change = save_and_wait(page, mock, 503)
    assert edit_after_change['request_id'] != edit_before_change['request_id']
    page.reload(wait_until='networkidle')
    changed_edit_retry = save_and_wait(page, mock)
    assert changed_edit_retry['request_id'] == edit_after_change['request_id']
    new_item(page, 'character')
    field(page, '名前').fill('失敗後に内容を変えた下書き')
    mock.fail_next_save = True
    before_edit = save_and_wait(page, mock, 503)
    field(page, '名前').fill('変更済みの下書き')
    mock.fail_next_save = True
    after_edit = save_and_wait(page, mock, 503)
    assert after_edit['request_id'] != before_edit['request_id'], 'changed content must get a new UUID'
    page.reload(wait_until='networkidle')
    edited_retry = save_and_wait(page, mock)
    assert edited_retry['request_id'] == after_edit['request_id']
    return {'committed_save_with_lost_response_no_retry': True,
            'idempotent_new_save_direct_and_reload_retry': True,
            'idempotent_edit_direct_and_reload_retry': True,
            'edit_document_and_revision_rotate_request_id': True,
            'changed_document_rotates_persisted_request_id': True, 'successful_save_resets_request_id': True}


def account_checks(page: Page, mock: MockCloud) -> dict:
    owner_a = mock.owner
    new_item(page, 'character')
    field(page, '名前').fill('アカウントAの下書き')
    page.reload(wait_until='networkidle')
    expect(field(page, '名前')).to_have_value('アカウントAの下書き')
    mock.owner = 'plot-account-b'
    page.reload(wait_until='networkidle')
    expect(field(page, '名前')).to_have_value('')
    field(page, '名前').fill('アカウントBの下書き')
    mock.owner = owner_a
    page.reload(wait_until='networkidle')
    expect(field(page, '名前')).to_have_value('アカウントAの下書き')
    mock.owner = 'plot-account-b'
    page.reload(wait_until='networkidle')
    expect(field(page, '名前')).to_have_value('アカウントBの下書き')
    saved_b = save_and_wait(page, mock)
    assert saved_b['owner'] == 'plot-account-b'
    # Identical IDs in different accounts must not overwrite the original account.
    item_a = mock.accounts[owner_a].get(saved_b['id'])
    assert item_a is None or item_a['document']['name'] != 'アカウントBの下書き'
    mock.owner = owner_a
    # A cookie change alone is invisible to the UI until its auth boundary refreshes.
    # Exercise the real focus refresh and in-memory remount, without a hard reload.
    with page.expect_response(lambda response: response.url.startswith(ORIGIN + '/api/library?')):
        with page.expect_response(lambda response: response.url == ORIGIN + '/api/mobile/status'):
            page.evaluate("window.dispatchEvent(new Event('focus'))")
    goto_create(page)
    expect(page.get_by_role('button', name='アカウントBの下書きを編集', exact=True)).to_have_count(0)
    goto_create(page, '?edit=new')
    expect(field(page, '名前')).to_have_value('アカウントAの下書き')
    return {'same_browser_owner_scoped_drafts': True, 'server_items_owner_isolated': True}


def install_guard(context, mock: MockCloud) -> None:
    context.route('**/*', mock.route)
    def observe(opened):
        opened.on('pageerror', lambda error: mock.page_errors.append(str(error)))
        opened.on('console', lambda message: mock.blocked.append(message.text)
                  if message.text.startswith('PLOT_BLOCKED_TRANSPORT:') else None)
        # Only beforeunload confirmations are automatic; unexpected product dialogs fail.
        def dialog(dialog):
            if dialog.type == 'beforeunload':
                dialog.accept()
            else:
                mock.page_errors.append('Unexpected browser dialog: ' + dialog.type)
                dialog.dismiss()
        opened.on('dialog', dialog)
    context.on('page', observe)
    # These transports bypass ordinary request interception in some browsers.
    context.add_init_script("""(() => {
      // A stale desktop preference must not make Cloud request adult content.
      try { localStorage.setItem('kyalulu-adult-content', '1'); } catch { /* about:blank */ }
      window.__plotBlockedTransports = [];
      const deny = kind => function() {
        window.__plotBlockedTransports.push(kind);
        console.error('PLOT_BLOCKED_TRANSPORT:' + kind);
        throw new Error('Plot UI check forbids ' + kind);
      };
      window.WebSocket = deny('WebSocket');
      window.EventSource = deny('EventSource');
      navigator.sendBeacon = deny('sendBeacon');
    })();""")
    if hasattr(context, 'route_web_socket'):
        def block_socket(socket):
            mock.blocked.append('WebSocket attempt')
            socket.close()
        context.route_web_socket('**/*', block_socket)


def run_case(browser: Browser, dist: Path, output: Path, width: int, theme: str) -> dict:
    tag = f'{"desktop" if width > 600 else "mobile"}-{theme}'
    mock = MockCloud(dist)
    context = browser.new_context(viewport={'width': width, 'height': 950 if width > 600 else 844},
                                  color_scheme=theme, service_workers='block', locale='ja-JP',
                                  reduced_motion='reduce')
    install_guard(context, mock)
    page = context.new_page()
    page.set_default_timeout(10000)
    context.tracing.start(screenshots=True, snapshots=True, sources=False)
    result: dict = {'case': tag, 'passed': False}
    try:
        result.update(character_checks(page, mock, output, tag))
        expect(page.locator('html')).to_have_attribute('data-theme', theme)
        # Additional workflows/scopes need one desktop and one mobile run, not four duplicates.
        if theme == 'dark':
            result.update(library_checks(page, mock, output, tag))
            result.update(conversation_checks(page, mock, output, tag))
            result.update(uncertain_save_checks(page, mock))
            result.update(account_checks(page, mock))
        assert not mock.page_errors, mock.page_errors
        assert not mock.blocked, mock.blocked
        assert not page.evaluate('window.__plotBlockedTransports'), 'unmocked transport attempted'
        result['passed'] = True
    except Exception as error:
        result['error'] = f'{type(error).__name__}: {error}'
        result['traceback'] = traceback.format_exc()
        try:
            screenshot(page, output, tag + '-failure')
        except Exception:
            pass
    finally:
        result.update(api_requests=len(mock.calls), save_attempts=len(mock.writes),
                      blocked_requests=mock.blocked, page_errors=mock.page_errors,
                      inference_requests=0, real_api_requests=0)
        (output / f'{tag}-api.json').write_text(json.dumps(
            {'calls': mock.calls, 'writes': mock.writes, 'blocked': mock.blocked},
            ensure_ascii=False, indent=2), encoding='utf-8')
        context.tracing.stop(path=str(output / f'{tag}-trace.zip'))
        context.close()
    return result


def console_summary(report: dict, output: Path) -> dict:
    """Keep stdout small; full errors, API logs and traces remain in artifacts."""
    cases = report['cases']
    summary = {'passed': report['passed'],
               'cases_passed': sum(case['passed'] for case in cases), 'cases_total': len(cases),
               'api_requests': sum(case['api_requests'] for case in cases),
               'save_attempts': sum(case['save_attempts'] for case in cases),
               'real_api_requests': 0, 'inference_requests': 0,
               'report': str(output.resolve() / 'acceptance.json')}
    if not report['passed']:
        summary['errors'] = [{'case': case['case'], 'error': case.get('error', 'Failed').splitlines()[0][:240]}
                             for case in cases if not case['passed']]
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, default=ROOT / 'apps/web/dist', help='Existing build; never built here')
    parser.add_argument('--output', type=Path, default=ROOT / '.artifacts/plot-creator-ui')
    args = parser.parse_args()
    if not (args.dist / 'index.html').is_file():
        parser.error('Web dist is missing. Parent must build after the other UI workers finish.')
    args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            results = [run_case(browser, args.dist, args.output, width, theme)
                       for width in (1440, 390) for theme in ('light', 'dark')]
        finally:
            browser.close()
    report = {'passed': all(case['passed'] for case in results), 'cases': results,
              'real_api_requests': 0, 'inference_requests': 0,
              'scope': 'Built Create UI and mocked PortableDocument persistence; no real backend/inference validation'}
    (args.output / 'acceptance.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(console_summary(report, args.output), ensure_ascii=False))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
