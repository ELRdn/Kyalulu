"""Author-facing card fields (docs/MOBILE_UX_SPEC.md §6): tags, hook and opening replies.

Tags are stored as typed (NFKC, no leading #) and compared by a folded key, so
"＃ネコ", "#ねこ" and "ネコ" count as one tag. Keep in sync with apps/web/src/lib/authorFields.ts.
"""
import unicodedata

MAX_TAGS, MAX_TAG_LENGTH = 10, 20
MAX_HOOK_LENGTH, MAX_OPENING_REPLIES, MAX_REPLY_LENGTH = 60, 3, 100
# Tags that signal minors (spec §7 prohibitions).
# ponytail: exact matches only; substring rules would also block common SFW tags such as ゴスロリ.
BANNED = ('ロリ', 'ロリコン', 'ショタ', 'ショタコン', '幼女', '幼児', '園児', '小学生', '中学生', '児童',
          'JS', 'JC', 'loli', 'lolicon', 'shota', 'shotacon', 'underage', 'preteen', 'child', 'minor')


def tag_key(tag: str) -> str:
    text = unicodedata.normalize('NFKC', tag).strip().lstrip('#').strip().casefold()
    return ''.join(chr(ord(c) + 0x60) if 'ぁ' <= c <= 'ゖ' else c for c in text)


BANNED_KEYS = frozenset(map(tag_key, BANNED))


def clean_tag(tag: str) -> str:
    return ' '.join(unicodedata.normalize('NFKC', tag).strip().lstrip('#').split())


def clean_tags(tags) -> list:
    """Normalize, drop banned/duplicate/overlong tags and keep the first ten. Non-string items are preserved."""
    kept, extra, seen = [], [], set()
    for tag in tags if isinstance(tags, list) else []:
        if not isinstance(tag, str):
            extra.append(tag)
            continue
        text, key = clean_tag(tag), tag_key(tag)
        if text and len(text) <= MAX_TAG_LENGTH and key not in BANNED_KEYS and key not in seen:
            seen.add(key)
            kept.append(text)
    return kept[:MAX_TAGS] + extra


def clean_author_fields(data: dict) -> dict:
    """Return the author fields of a character's data, cleaned for storage."""
    out = {}
    if 'tags' in data:
        out['tags'] = clean_tags(data['tags'])
    if isinstance(data.get('hook'), str):
        out['hook'] = ' '.join(data['hook'].split())[:MAX_HOOK_LENGTH]
    if isinstance(data.get('opening_replies'), list):
        replies = [' '.join(r.split())[:MAX_REPLY_LENGTH] for r in data['opening_replies'] if isinstance(r, str)]
        out['opening_replies'] = [r for r in replies if r][:MAX_OPENING_REPLIES]
    return out


if __name__ == '__main__':
    assert clean_tags(['#ねこ', '＃ネコ', ' 執事 ', 'ロリ', 'ゴスロリ', 'x' * 21, 3]) == ['ねこ', '執事', 'ゴスロリ', 3]
    assert len(clean_tags([f't{i}' for i in range(12)])) == 10 and tag_key('ＪＳ') == 'js'
    assert clean_author_fields({'hook': ' 雨の  夜に ', 'opening_replies': ['こんばんは', '', 1, 'a', 'b', 'c']}) == \
        {'hook': '雨の 夜に', 'opening_replies': ['こんばんは', 'a', 'b']}
    print('ok')
