"""Bounded public HTTPS fetches with DNS pinning and per-adapter redirect policy."""
import asyncio
import ipaddress
import json
import socket
from urllib.parse import urlsplit, urljoin, unquote
import httpx
from .hub_schema import HubError

MAX_BYTES = 32 * 1024 * 1024
SUFFIXES = ('.json', '.png', '.apng', '.charx', '.byaf', '.zip', '.txt')
CDN_HOSTS = {'cdn-lfs.huggingface.co', 'cdn-lfs.hf.co', 'cas-bridge.xethub.hf.co',
             'us.aws.cdn.hf.co', 'eu.aws.cdn.hf.co', 'us.gcp.cdn.hf.co'}


def public_url(url):
    try:
        p = urlsplit(url)
        if p.scheme != 'https' or p.port not in (None, 443) or not p.hostname or p.username or p.password:
            raise ValueError()
        if any(ord(c) < 33 for c in url) or '\\' in url or p.fragment:
            raise ValueError()
        if any(s in ('.', '..') for s in unquote(p.path).split('/')):
            raise ValueError()
    except ValueError:
        raise HubError('invalid_url', '公開HTTPSファイルのURLを指定してください。認証情報・特殊パスは使えません。')
    return p


def allowed_url(url, family):
    p = public_url(url)
    host, path = p.hostname, p.path
    valid = False
    if family == 'taverncard':
        valid = host == 'www.taverncard.com' and (path == '/api/cards' or path == '/api/search' or path.startswith('/api/cards/'))
        valid |= host == 'img.taverncard.com' and path.startswith('/cards/')
    elif family in ('github', 'sillytavern'):
        valid = host == 'api.github.com' and path.startswith('/repos/')
        valid |= host == 'raw.githubusercontent.com' and path.lower().endswith(SUFFIXES)
        valid |= host == 'media.githubusercontent.com' and path.startswith('/media/') and path.lower().endswith(SUFFIXES)
    elif family == 'huggingface':
        valid = host == 'huggingface.co' and ('/resolve/' in path or path.startswith(('/api/models/', '/api/datasets/', '/api/spaces/', '/api/resolve-cache/')))
        valid |= host in CDN_HOSTS
    if not valid:
        raise HubError('blocked_target', 'この取得先・リダイレクト先には対応していません。')
    return p


async def resolve_public(host):
    infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    addresses = list(dict.fromkeys(i[4][0] for i in infos))
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise HubError('private_address', 'ローカル・プライベートネットワークにはアクセスできません。')
    # Pin this address for the connection: no second hostname lookup at connect time.
    return addresses[0]


class HubHTTP:
    def __init__(self, transport=None, resolver=resolve_public):
        self.transport, self.resolver = transport, resolver

    async def get(self, url, family, limit=MAX_BYTES):
        try:
            async with asyncio.timeout(45):
                for hop in range(4):
                    p = allowed_url(url, family)
                    ip = await self.resolver(p.hostname)
                    target = httpx.URL(url).copy_with(host=ip)
                    # New cookie-free client per hop; no environment proxies or auth stores.
                    async with httpx.AsyncClient(transport=self.transport, trust_env=False,
                            follow_redirects=False, timeout=httpx.Timeout(30, connect=8)) as client:
                        async with client.stream('GET', target,
                                headers={'Host': p.hostname, 'Accept-Encoding': 'identity', 'User-Agent': 'Kyalulu-Hub/1'},
                                extensions={'sni_hostname': p.hostname}) as response:
                            if response.status_code in (301, 302, 303, 307, 308):
                                if hop == 3 or not response.headers.get('location'):
                                    raise HubError('redirect_limit', 'リダイレクト回数が上限を超えました。', 502)
                                url = urljoin(url, response.headers['location'])
                                continue
                            code = response.status_code
                            if code != 200:
                                labels = {403: ('forbidden', '配布元が取得を許可していません。'),
                                    404: ('not_found', '公開ファイルが見つかりません。'),
                                    429: ('rate_limited', '配布元の取得制限です。時間を置いて再試行してください。')}
                                key, message = labels.get(code, ('upstream_error', f'配布元でエラーが発生しました（HTTP {code}）。'))
                                retry = response.headers.get('retry-after', '')
                                raise HubError(key, message, code if code in labels else 502,
                                               retry if retry.isdigit() and len(retry) < 9 else None)
                            size = response.headers.get('content-length', '')
                            if response.headers.get('content-encoding', 'identity').lower() not in ('', 'identity'):
                                raise HubError('unsupported_encoding', '非圧縮のHTTP応答を取得できません。', 502)
                            if size.isdigit() and int(size) > limit:
                                raise HubError('too_large', 'ファイルサイズが上限を超えています。', 413)
                            body = bytearray()
                            async for chunk in response.aiter_bytes(chunk_size=65536):
                                if len(body) + len(chunk) > limit:
                                    raise HubError('too_large', 'ファイルサイズが上限を超えています。', 413)
                                body.extend(chunk)
                            return bytes(body)
        except (TimeoutError, httpx.TimeoutException) as exc:
            raise HubError('timeout', '配布元への接続がタイムアウトしました。', 504) from exc
        except (httpx.HTTPError, OSError) as exc:
            raise HubError('connection_error', '配布元との通信が中断されました。', 502) from exc

    async def json(self, url, family):
        raw = await self.get(url, family, limit=4 * 1024 * 1024)
        try:
            return json.loads(raw)
        except (ValueError, UnicodeError) as exc:
            raise HubError('invalid_response', '配布元の応答を読み取れません。', 502) from exc
