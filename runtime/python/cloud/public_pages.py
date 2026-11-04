"""Server-rendered head and body text for public routes (crawlers, link previews).

React's createRoot replaces the #root content on load, so this is plain HTML, not hydration.
"""
import re
from functools import cache
from html import escape
from urllib.parse import quote

from python.core.prompt_compiler import CHAR_DIR, list_available

_HEAD = re.compile(r'\s*<(?:title>[^<]*</title|meta (?:name="description"|property="og:[a-z]+")[^>]*)>')


@cache
def _characters() -> dict[str, dict]:
    # Same source and SFW filter as the guest catalog in app.py.
    return {c['id']: c for c in list_available(CHAR_DIR) if not c.get('nsfw')}


def _page(path: str, origin: str) -> tuple[str, str, str, str] | None:
    parts = path.strip('/').split('/')
    if parts == ['discover']:
        items = ''.join(f'<li><a href="/characters/{quote(c["id"])}">{escape(c.get("display_name", c["id"]))}</a>'
                        f' — {escape(c.get("description", ""))}</li>' for c in _characters().values())
        description = 'Kyaluluで話せるキャラクターの一覧です。'
        return 'ディスカバー | Kyalulu', description, origin + '/apple-touch-icon.png', f'<main><h1>ディスカバー</h1><p>{description}</p><ul>{items}</ul></main>'
    if len(parts) == 2 and parts[0] == 'characters' and (c := _characters().get(parts[1])):
        name, description = c.get('display_name', c['id']), c.get('description', '')
        image = origin + (c['portrait_url'] if str(c.get('portrait_url', '')).startswith('/') else '/apple-touch-icon.png')
        body = (f'<main><article><h1>{escape(name)}</h1><p>{escape(description)}</p>'
                f'<p><a href="/discover">ほかのキャラクターを見る</a></p></article></main>')
        return f'{name} | Kyalulu', description, image, body
    return None


def render(path: str, shell: str, origin: str) -> str | None:
    """Return the shell with route-specific metadata, or None for routes left to the client."""
    page = _page(path, origin)
    if page is None:
        return None
    title, description, image, body = page
    url = origin + '/' + path.strip('/')
    head = (f'<title>{escape(title)}</title><meta name="description" content="{escape(description)}">'
            f'<link rel="canonical" href="{escape(url)}"><meta property="og:title" content="{escape(title)}">'
            f'<meta property="og:description" content="{escape(description)}"><meta property="og:url" content="{escape(url)}">'
            f'<meta property="og:image" content="{escape(image)}">')
    return _HEAD.sub('', shell).replace('</head>', head + '</head>', 1).replace(
        '<div id="root"></div>', f'<div id="root">{body}</div>', 1)
