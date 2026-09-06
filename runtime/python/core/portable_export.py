"""Common card and backup exports. Losses are reported before downloading."""
import base64
import copy
import io
import json
import zipfile
from .portable_schema import PortableDocument
from .portable_binary import build_png_with_text, neutral_png, sanitize_stem

FORMATS = ('ccv2-json', 'ccv3-json', 'ccv2-png', 'ccv3-png', 'charx', 'backup')
MIME_EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'}
STRINGS = ('name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
           'creator_notes', 'system_prompt', 'post_history_instructions', 'creator', 'character_version')


def dump(value):
    return json.dumps(value, ensure_ascii=False, indent=2).encode('utf-8')


def archive(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for path, raw in files.items():
            z.writestr(path, raw)
    return out.getvalue()


def rewrite(value, mapping):
    if isinstance(value, str):
        return mapping.get(value, value)
    if isinstance(value, list):
        return [rewrite(v, mapping) for v in value]
    if isinstance(value, dict):
        return {k: rewrite(v, mapping) for k, v in value.items()}
    return value


def export_document(doc, format, assets):
    if format not in FORMATS:
        raise ValueError('Unsupported export format')
    doc = PortableDocument.model_validate(doc).model_copy(deep=True)
    notices = []
    def note(path, reason, status='converted'):
        notices.append({'path': path, 'status': status, 'reason': reason})
    stem = sanitize_stem(doc.name)
    for asset in doc.assets:
        if asset.asset_id and asset.asset_id not in assets:
            raise ValueError('Missing asset bytes; export cannot preserve the document')
    if format == 'backup':
        files = {'manifest.json': dump({'format': 'kyalulu_backup', 'version': 1}), 'document.json': dump(doc.model_dump())}
        files.update({'assets/' + a.asset_id: assets[a.asset_id][0] for a in doc.assets if a.asset_id})
        return archive(files), 'application/zip', stem + '.kyalulu-backup.zip', notices

    v2 = format.startswith('ccv2')
    data = copy.deepcopy(doc.data)
    for key in STRINGS:
        data.setdefault(key, '')
    data.update(name=doc.name)
    data.setdefault('tags', []); data.setdefault('alternate_greetings', [])
    data.setdefault('extensions', {})
    ext = data['extensions'].setdefault('kyalulu', {})
    ext.update(schema_version=1, speaking_style=doc.speaking_style, nsfw=doc.nsfw,
               profile=doc.profile.model_dump(), kind=doc.kind)
    # Definition is part of the character, not a creator note or an invisible field.
    if data.get('definition'):
        definition = data.pop('definition')
        ext['characterai_definition'] = definition
        ext['characterai_description'] = data['description']
        data['description'] = '\n\n'.join(v for v in (data['description'], definition) if v)
    if doc.profile.system_prompt and not data['system_prompt']:
        data['system_prompt'] = doc.profile.system_prompt
    if doc.profile.post_history_instructions and not data['post_history_instructions']:
        data['post_history_instructions'] = doc.profile.post_history_instructions
    if doc.speaking_style:
        # Keep a conventional card field usable by applications that ignore Kyalulu extensions.
        ext['personality_without_style'] = data['personality']
        data['personality'] = '\n\n'.join(v for v in (data['personality'], doc.speaking_style) if v)
    if doc.kind != 'character':
        note('kind', 'Standalone profile/Lore exported as a carrier card; use backup for native library restoration')
    if doc.histories:
        note('histories', 'CCv2/CCv3 cards exclude conversation history; use backup or original')
    if doc.profile.settings or doc.profile.prompts or doc.profile.context_template or doc.profile.variables:
        note('profile', 'Generation settings, prompt ordering and static variables are stored in Kyalulu extensions; destination apps may not apply them')
    if data.get('attached_profile_lore'):
        note('attached_profile_lore', 'Attached preset Lore is preserved as a Kyalulu field; use backup for faithful restoration')
    for notice in doc.notices:
        if notice.status in ('preserved', 'error'):
            note(notice.path, notice.reason, 'preserved')
    book = data.get('character_book')
    if isinstance(book, dict):
        book.setdefault('extensions', {})
        for index, entry in enumerate(book.get('entries', [])):
            entry.setdefault('keys', []); entry.setdefault('content', ''); entry.setdefault('enabled', True)
            entry.setdefault('insertion_order', index); entry.setdefault('extensions', {})
            if not v2:
                entry.setdefault('use_regex', False)
    files, png_fields, metas, mapping = {}, {}, [], {}
    portrait = next((a for a in doc.assets if a.type == 'icon' and a.asset_id), None)
    for asset in doc.assets:
        meta = {'type': asset.type, 'name': asset.name, 'uri': asset.uri, 'ext': MIME_EXT.get(asset.media_type, 'unknown')}
        if asset.asset_id:
            raw, mime = assets[asset.asset_id]
            extname = MIME_EXT.get(mime, 'bin')
            meta['ext'] = extname
            if format == 'charx':
                path = f'assets/{asset.asset_id}.{extname}'
                files[path] = raw
                meta['uri'] = 'embeded://' + path
            elif format.endswith('png'):
                if asset is portrait:
                    meta['uri'] = 'ccdefault:'
                else:
                    meta['uri'] = '__asset:' + asset.asset_id
                    png_fields['chara-ext-asset_:' + asset.asset_id] = base64.b64encode(raw).decode('ascii')
            else:
                meta['uri'] = f'data:{mime};base64,' + base64.b64encode(raw).decode('ascii')
            if asset.uri:
                mapping[asset.uri] = meta['uri']
        metas.append(meta)
    data['extensions'] = rewrite(data['extensions'], mapping)
    if v2:
        v3 = {k: data.pop(k) for k in ('nickname', 'group_only_greetings', 'creator_notes_multilingual', 'source', 'creation_date', 'modification_date') if k in data}
        if v3:
            data['extensions']['kyalulu']['v3_fields'] = v3
            note('ccv2', 'V3-only fields preserved in extensions.kyalulu.v3_fields')
        data.pop('assets', None)
        if doc.assets:
            note('assets', 'CCv2 exposes one PNG portrait; other assets remain available in CHARX/backup')
        if doc.profile.settings or doc.profile.prompts or doc.profile.context_template:
            note('profile', 'Generation profile is preserved in extensions; other apps may not apply it')
    else:
        data['assets'] = metas
        if format == 'ccv3-json' and any(a.asset_id for a in doc.assets):
            note('assets', 'JSON uses data URIs; use CHARX if the destination does not support them')
    top = copy.deepcopy(doc.source.get('top_unknown') or {})
    if top:
        note('export.top_level', 'Unknown top-level fields preserved', 'preserved')
    card = {**top, 'spec': 'chara_card_v2' if v2 else 'chara_card_v3', 'spec_version': '2.0' if v2 else '3.0', 'data': data}
    if format.endswith('json'):
        return dump(card), 'application/json', stem + '.' + format + '.json', notices
    if format == 'charx':
        files['card.json'] = dump(card)
        return archive(files), 'application/zip', stem + '.charx', notices
    base = neutral_png()
    if portrait and assets[portrait.asset_id][1] == 'image/png':
        base = assets[portrait.asset_id][0]
    else:
        note('assets.portrait', 'No PNG portrait available; neutral placeholder used (original kept in backup)', 'preserved')
    if v2:
        png_fields = {'chara': base64.b64encode(dump(card)).decode('ascii')}
    else:
        png_fields['ccv3'] = base64.b64encode(dump(card)).decode('ascii')
        fallback = copy.deepcopy(card)
        fallback.update(spec='chara_card_v2', spec_version='2.0')
        fallback['data'].pop('assets', None)
        fallback['data']['creator_notes'] += '\nBackfilled from CCv3. Use a CCv3-compatible application for all features.'
        png_fields['chara'] = base64.b64encode(dump(fallback)).decode('ascii')
    return build_png_with_text(base, png_fields), 'image/png', stem + '.' + format + '.png', notices
