"""Documented Hub adapters. No account access, scraping, or inference calls."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, parse_qs, urlencode
from .hub_http import HubHTTP, public_url, SUFFIXES
from .hub_schema import HubError, HubItem, HubResults, RemoteSource, UrlImport

VERSION = 'hub-1'
UUID = r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}'
RISU_ID = rf'(?:{UUID}|[a-fA-F0-9]{{64}})'
MANIFEST = Path(__file__).with_name('hub_sfw.json')
SOURCES = [
    {'id': 'taverncard', 'name': 'TavernCard', 'searchable': True, 'url': 'https://www.taverncard.com'},
    {'id': 'sillytavern', 'name': 'SillyTavern Content', 'searchable': True, 'url': 'https://github.com/SillyTavern/SillyTavern-Content'},
    {'id': 'risurealm', 'name': 'RisuRealm', 'searchable': False, 'url': 'https://realm.risuai.net'},
    {'id': 'github', 'name': 'GitHub', 'searchable': False, 'url': 'https://github.com'},
    {'id': 'huggingface', 'name': 'Hugging Face', 'searchable': False, 'url': 'https://huggingface.co'},
]


def sfw_manifest():
    return json.loads(MANIFEST.read_text(encoding='utf-8'))


def scalar(value):
    return value if isinstance(value, str) and value.strip() else None


def mapping(value):
    return value if isinstance(value, dict) else {}


def card_item(card):
    if not isinstance(card, dict) or card.get('is_nsfw') is not False or not re.fullmatch(UUID, str(card.get('id', ''))):
        return None
    data = card.get('character_data') or {}
    data = mapping(data.get('data', data)) if isinstance(data, dict) else {}
    profile = mapping(card.get('profiles'))
    thumb = scalar(card.get('thumbnail_url') or card.get('public_image_url') or card.get('image_url'))
    if thumb:
        p = urlsplit(thumb)
        if p.scheme != 'https' or p.netloc != 'img.taverncard.com' or not p.path.startswith('/cards/'):
            thumb = None
    return HubItem(source='taverncard', id=card['id'], name=str(card.get('name') or 'Unnamed'),
        description=str(card.get('description') or '')[:20000],
        source_url=f"https://www.taverncard.com/character/{card['id']}",
        author=scalar(card.get('username')) or scalar(profile.get('username')) or scalar(data.get('creator')),
        license=scalar(data.get('license')), thumbnail_url=thumb)


class Hubs:
    def __init__(self, http=None):
        self.http = http or HubHTTP()

    async def items(self, source, q='', page=1):
        if source == 'taverncard':
            query = {'page': page, 'limit': 24, 'nsfw': 'false'}
            endpoint = 'cards'
            if q.strip():
                endpoint = 'search'
                query['q'] = q.strip()
            result = await self.http.json(f'https://www.taverncard.com/api/{endpoint}?{urlencode(query)}', source)
            if not isinstance(result, dict) or not isinstance(result.get('cards'), list):
                raise HubError('invalid_response', '配布元の一覧形式が変わっています。', 502)
            items = [item for card in result['cards'] if (item := card_item(card))]
            return HubResults(source=source, items=items, page=page, has_more=result.get('hasMore') is True)
        if source == 'sillytavern':
            manifest = sfw_manifest()
            rev = manifest['revision']
            index = await self.http.json(f'https://raw.githubusercontent.com/SillyTavern/SillyTavern-Content/{rev}/index.json', source)
            if not isinstance(index, list):
                raise HubError('invalid_response', 'コンテンツ一覧を読み取れません。', 502)
            approved = {v['id']: v for v in manifest['cards']}
            items = []
            for entry in index:
                saved = approved.get(entry.get('id'))
                if entry.get('type') != 'character' or not saved:
                    continue
                if q.lower() not in (entry.get('name', '') + ' ' + entry.get('description', '')).lower():
                    continue
                items.append(HubItem(source=source, id=entry['id'], name=entry['name'],
                    description=entry.get('description', ''), author=saved.get('author'), license=saved.get('license'),
                    source_url=f"https://github.com/SillyTavern/SillyTavern-Content/blob/{rev}/assets/character/{entry['id']}"))
            return HubResults(source=source, items=items[(page-1)*24:page*24], page=page, has_more=len(items)>page*24, total=len(items))
        raise HubError('unsupported_source', 'このソースはURL取り込みをご利用ください。')

    async def detail(self, source, item_id):
        if source == 'taverncard' and re.fullmatch(UUID, item_id):
            response = await self.http.json(f'https://www.taverncard.com/api/cards/{item_id}', source)
            item = card_item(mapping(response).get('card', {}))
            if item:
                return item
            raise HubError('not_sfw', 'この項目はSFW一覧に表示できません。', 404)
        if source == 'sillytavern':
            result = await self.items(source)
            if item := next((v for v in result.items if v.id == item_id), None):
                return item
        raise HubError('not_found', '項目が見つかりません。', 404)

    async def resolve(self, request: UrlImport):
        p = public_url(request.url.strip())
        query = parse_qs(p.query)
        if any(k not in {'raw', 'download', 'cors', 'non_commercial'} and not k.startswith('utm_') for k in query):
            raise HubError('url_query', '認証情報や未対応のクエリーを含むURLは利用できません。')
        path, host = unquote(p.path), p.hostname
        if host in ('taverncard.com', 'www.taverncard.com'):
            found = re.fullmatch(rf'/(?:[a-z]{{2}}/)?character/({UUID})(?:/[^/]+)?/?', path) or re.fullmatch(rf'/api/cards/({UUID})(?:/download)?/?', path)
            if not found:
                raise HubError('file_url_required', 'TavernCardのキャラページURLを指定してください。')
            card_id = found[1].lower()
            response = await self.http.json(f'https://www.taverncard.com/api/cards/{card_id}', 'taverncard')
            card = mapping(response).get('card', {})
            if not isinstance(card, dict) or str(card.get('id', '')).lower() != card_id:
                raise HubError('invalid_response', '配布元のキャラ情報を読み取れません。', 502)
            data = card.get('character_data') or {}
            data = mapping(data.get('data', data)) if isinstance(data, dict) else {}
            return RemoteSource(source='taverncard', source_id=card_id,
                source_url=f'https://www.taverncard.com/character/{card_id}',
                download_url=f'https://www.taverncard.com/api/cards/{card_id}/download', filename=f'{card_id}.png',
                content_rating='sfw' if card.get('is_nsfw') is False else 'nsfw' if card.get('is_nsfw') is True else 'unknown',
                author=scalar(mapping(card.get('profiles')).get('username')) or scalar(data.get('creator')), license=scalar(data.get('license')))
        if host == 'realm.risuai.net':
            found = re.fullmatch(rf'/character/({RISU_ID})/?', path)
            direct = re.fullmatch(rf'/api/v1/download/([^/]+)/({RISU_ID})/?', path)
            if not found and not direct:
                raise HubError('file_url_required', 'RisuRealmの公開コンテンツURLを指定してください。')
            fmt = direct[1] if direct else request.format
            if fmt not in ('png-v3', 'json-v3', 'lorebook-v2', 'lorebook-v3', 'preset-st-chat'):
                raise HubError('unsupported_format', 'CC PNG/JSON・Lorebook・ST形式プリセットを選んでください。')
            item_id = (direct[2] if direct else found[1]).lower()
            options = {'cors': 'true'}
            if request.non_commercial:
                options['non_commercial'] = 'true'
            return RemoteSource(source='risurealm', source_id=item_id, source_url=f'https://realm.risuai.net/character/{item_id}',
                download_url=f'https://realm.risuai.net/api/v1/download/{fmt}/{item_id}?{urlencode(options)}',
                filename=f'{item_id}.{"png" if fmt == "png-v3" else "json"}', transport='browser', format=fmt)
        parts = path.strip('/').split('/')
        if host in ('github.com', 'raw.githubusercontent.com'):
            if len(parts) < (5 if host == 'github.com' else 4) or (host == 'github.com' and parts[2] != 'blob'):
                raise HubError('file_url_required', 'GitHubのファイルURLを指定してください。')
            owner, repo = parts[:2]
            tail = parts[3:] if host == 'github.com' else parts[2:]
            return await self._repository('github', f'{owner}/{repo}', tail, 'models')
        if host == 'huggingface.co':
            kind = 'models'
            if parts and parts[0] in ('datasets', 'spaces'):
                kind, parts = parts[0], parts[1:]
            if len(parts) < 5 or parts[2] not in ('blob', 'resolve'):
                raise HubError('file_url_required', 'Hugging Faceの公開ファイルURLを指定してください。')
            return await self._repository('huggingface', '/'.join(parts[:2]), parts[3:], kind)
        raise HubError('unsupported_source', '対応URLはTavernCard・RisuRealm・GitHub・Hugging Faceです。')

    async def _repository(self, source, repo, tail, kind):
        if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo) or not '/'.join(tail).lower().endswith(SUFFIXES):
            raise HubError('unsupported_file', '対応するカード・プリセットのファイルURLを指定してください。')
        # A branch may contain slashes. Resolve longest candidate that the public API recognizes.
        if len(tail) > 16:
            raise HubError('invalid_path', 'ファイルパスが深すぎます。')
        pinned = bool(re.fullmatch(r'[a-f0-9]{40,64}', tail[0]))
        revision, file = (tail[0], '/'.join(tail[1:])) if pinned else (None, None)
        splits = [] if pinned else range(len(tail)-1, 0, -1)
        for split in splits:
            ref = '/'.join(tail[:split])
            meta_url = (f'https://api.github.com/repos/{repo}/commits/{quote(ref, safe="")}' if source == 'github'
                        else f'https://huggingface.co/api/{kind}/{repo}/revision/{quote(ref, safe="")}')
            try:
                meta = await self.http.json(meta_url, source)
            except HubError as exc:
                if exc.code == 'not_found':
                    continue
                raise
            revision = mapping(meta).get('sha')
            file = '/'.join(tail[split:])
            break
        if not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{40,64}', revision):
            raise HubError('revision_not_found', '公開リビジョンを特定できません。ファイルURLを確認してください。')
        root = f'https://github.com/{repo}' if source == 'github' else f'https://huggingface.co/{"" if kind == "models" else kind + "/"}{repo}'
        download = (f'https://raw.githubusercontent.com/{repo}/{revision}/{quote(file, safe="/")}' if source == 'github'
                    else f'{root}/resolve/{revision}/{quote(file, safe="/")}')
        resolved = RemoteSource(source=source, source_id=f'{kind + ":" if source == "huggingface" else ""}{repo}/{file}',
            source_url=f'{root}/blob/{revision}/{quote(file, safe="/")}', download_url=download,
            filename=file.rsplit('/', 1)[-1], revision=revision, author=repo.split('/')[0])
        if source == 'github' and repo.lower() == 'sillytavern/sillytavern-content':
            manifest = sfw_manifest()
            match = next((c for c in manifest['cards'] if file == 'assets/character/' + c['id']), None)
            if match and revision == manifest['revision']:
                resolved.source, resolved.source_id = 'sillytavern', match['id']
                resolved.content_rating, resolved.expected_hash = 'sfw', match['sha256']
                resolved.author, resolved.license = match.get('author'), match.get('license')
        return resolved

    async def download(self, resolved):
        if resolved.transport != 'server':
            raise HubError('browser_required', 'この配布元はブラウザーから取得してください。')
        raw = await self.http.get(resolved.download_url, resolved.source)
        if resolved.source == 'github' and raw.startswith(b'version https://git-lfs.github.com/spec/v1'):
            text = raw.decode('ascii')
            oid = re.search(r'^oid sha256:([a-f0-9]{64})$', text, re.M)
            size = re.search(r'^size (\d+)$', text, re.M)
            if not oid or not size or int(size[1]) > 32 * 1024 * 1024:
                raise HubError('invalid_lfs', 'LFSファイルの形式またはサイズに対応していません。')
            url = resolved.download_url.replace('https://raw.githubusercontent.com/', 'https://media.githubusercontent.com/media/', 1)
            raw = await self.http.get(url, 'github')
            if hashlib.sha256(raw).hexdigest() != oid[1] or len(raw) != int(size[1]):
                raise HubError('hash_mismatch', 'LFSファイルのハッシュが一致しません。', 502)
        if resolved.expected_hash and hashlib.sha256(raw).hexdigest() != resolved.expected_hash:
            raise HubError('hash_mismatch', 'SFW確認時のファイルと一致しないため取り込みを停止しました。', 409)
        return raw


def provenance(resolved, raw):
    value = resolved.model_dump(exclude={'download_url', 'expected_hash'})
    value.update(sha256=hashlib.sha256(raw).hexdigest(), fetched_at=datetime.now(timezone.utc).isoformat(),
        adapter_version=VERSION, origin_verified=resolved.transport == 'server')
    return value
