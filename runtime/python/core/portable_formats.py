"""Pure import adapters for Kyalulu portable characters (no network, no execution)."""
from __future__ import annotations
import base64
import binascii
import copy
import hashlib
import json
import posixpath
import re
from .portable_binary import (
    MAX_UPLOAD_BYTES,
    PNG_MAGIC,
    get_png_texts,
    safe_open_zip,
    sanitize_stem,
    sniff_mime,
    validate_image,
)
from .portable_schema import ImportNotice, PortableAsset, PortableDocument, PortableProfile

ST_STANDARD_IDENTIFIERS = {
    "main", "worldInfoBefore", "charDescription", "charPersonality", "scenario",
    "personaDescription", "dialogueExamples", "chatHistory", "worldInfoAfter", "jailbreak",
}

SAMPLER_ALIASES = {
    "temp": "temperature", "temperature": "temperature",
    "topp": "top_p", "top_p": "top_p",
    "topk": "top_k", "top_k": "top_k",
    "minp": "min_p", "min_p": "min_p",
    "reppen": "repeat_penalty", "repeatpenalty": "repeat_penalty",
    "repetitionpenalty": "repeat_penalty", "repeat_penalty": "repeat_penalty",
    "repeatlastn": "repeat_last_n", "repeat_last_n": "repeat_last_n",
    "freqpen": "frequency_penalty", "frequencypenalty": "frequency_penalty",
    "frequency_penalty": "frequency_penalty",
    "prespen": "presence_penalty", "presencepenalty": "presence_penalty",
    "presence_penalty": "presence_penalty",
    "seed": "seed",
    "maxtokens": "max_tokens", "max_tokens": "max_tokens",
    "maxlength": "max_tokens", "max_length": "max_tokens", "genamt": "max_tokens",
    "stop": "stop", "stopsequence": "stop", "stop_sequence": "stop",
}

URLKEY_HINT = re.compile(r"url|key|endpoint|secret|token|password|proxy|host|port|api_|apikey|plugin", re.IGNORECASE)
LABEL_RE = re.compile(r"^\s*(name|description|greeting|definition)\s*:(.*)$", re.IGNORECASE)
Lorebook_NAME_RE = re.compile(r"^\s*lorebook name\s*:(.*)$", re.IGNORECASE)
ENTRY_TITLE_RE = re.compile(r"^\s*entry title\s*:(.*)$", re.IGNORECASE)
KEYWORDS_RE = re.compile(r"^\s*keywords\s*:(.*)$", re.IGNORECASE)
CONTENT_RE = re.compile(r"^\s*content\s*:(.*)$", re.IGNORECASE)
SHA_RE = re.compile(r"[0-9a-f]{64}")
EMBED_PREFIXES = ("embeded://", "embedded://")


def _note(path, status, reason):
    return ImportNotice(path=path, status=status, reason=reason)


def _stem(filename, default="character"):
    base = (filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    base = base.rsplit(".", 1)[0] if "." in base else base
    return sanitize_stem(base, default)


def _decode_card_text(value):
    """Accept raw JSON or base64-encoded JSON from a PNG text chunk."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Empty embedded character data")
    text = value.strip()
    if text.startswith("{"):
        try:
            obj = json.loads(text)
        except Exception as exc:
            raise ValueError("Embedded character data is not valid JSON: %s" % exc) from exc
        if not isinstance(obj, dict):
            raise ValueError("Embedded character data must be a JSON object")
        return obj
    try:
        raw = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Embedded character data is neither JSON nor base64 JSON") from exc
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("Embedded character data is too large")
    try:
        obj = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise ValueError("Embedded character data is not valid JSON: %s" % exc) from exc
    if not isinstance(obj, dict):
        raise ValueError("Embedded character data must be a JSON object")
    return obj


def _find_embedded_refs(node, found=None):
    if found is None:
        found = set()
    if isinstance(node, dict):
        for value in node.values():
            _find_embedded_refs(value, found)
    elif isinstance(node, list):
        for value in node:
            _find_embedded_refs(value, found)
    elif isinstance(node, str):
        lowered = node.lower()
        for prefix in EMBED_PREFIXES:
            if lowered.startswith(prefix):
                found.add(node)
                break
    return found


def _data_url_bytes(uri):
    try:
        header, payload = uri.split(",", 1)
    except ValueError as exc:
        raise ValueError("Malformed data URL") from exc
    mime = "application/octet-stream"
    if ";" in header:
        mime = header[5:header.index(";")] or mime
        if "base64" not in header:
            raise ValueError("Only base64 data URLs are supported")
    else:
        raise ValueError("Only base64 data URLs are supported")
    try:
        raw = base64.b64decode(payload.strip(), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Malformed data URL payload") from exc
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("Embedded data URL is too large")
    return raw, mime


def _store_asset(assets, raw, uri, name, atype):
    asset_id, mime = validate_image(raw)
    assets.setdefault(asset_id, (bytes(raw), mime))
    return PortableAsset(name=name or "asset", type=atype or "asset", uri=uri or "",
                          media_type=mime, asset_id=asset_id)


def _apply_kyalulu_roundtrip(data, profile, notices):
    """Restore speaking style, nsfw flag, and profile kept in extensions.kyalulu."""
    extensions = data.get("extensions")
    kyalulu = extensions.get("kyalulu") if isinstance(extensions, dict) else None
    if not isinstance(kyalulu, dict):
        return "", False
    if 'personality_without_style' in kyalulu:
        data['personality'] = kyalulu['personality_without_style']
    if 'characterai_definition' in kyalulu:
        data['definition'] = kyalulu['characterai_definition']
        data['description'] = kyalulu.get('characterai_description', '')
    for key, value in kyalulu.get('v3_fields', {}).items():
        data.setdefault(key, value)
    speaking = kyalulu.get("speaking_style", "")
    speaking = speaking if isinstance(speaking, str) else ""
    nsfw = bool(kyalulu.get("nsfw", False))
    stored = kyalulu.get("profile")
    if isinstance(stored, dict) and stored:
        try:
            restored = PortableProfile.model_validate(stored)
        except Exception:
            notices.append(_note("extensions.kyalulu.profile", "preserved",
                                 "Stored Kyalulu profile was malformed; live profile kept"))
        else:
            if not profile.settings and restored.settings:
                profile.settings = dict(restored.settings)
            if not profile.system_prompt and restored.system_prompt:
                profile.system_prompt = restored.system_prompt
            if not profile.post_history_instructions and restored.post_history_instructions:
                profile.post_history_instructions = restored.post_history_instructions
            if not profile.context_template and restored.context_template:
                profile.context_template = restored.context_template
            if not profile.prompts and restored.prompts:
                profile.prompts = [dict(p) for p in restored.prompts]
            if not profile.model_hint and restored.model_hint:
                profile.model_hint = restored.model_hint
            if not profile.variables and restored.variables:
                profile.variables = dict(restored.variables)
            notices.append(_note("extensions.kyalulu.profile", "converted",
                                 "Restored prompt profile kept by a previous Kyalulu export"))
    return speaking, nsfw


def _cc_document(card_obj, filename, assets, portrait=None, fmt_hint=None):
    if not isinstance(card_obj, dict):
        raise ValueError("Character card must be a JSON object")
    spec = card_obj.get("spec")
    version = card_obj.get("spec_version")
    if spec == "chara_card_v3" or version == "3.0":
        detected = "ccv3"
        data_raw = card_obj.get("data")
        if not isinstance(data_raw, dict):
            raise ValueError("CCv3 card is missing its data object")
        top_unknown = {k: copy.deepcopy(v) for k, v in card_obj.items()
                       if k not in ("spec", "spec_version", "data")}
    elif spec == "chara_card_v2" or version == "2.0":
        detected = "ccv2"
        data_raw = card_obj.get("data")
        if not isinstance(data_raw, dict):
            raise ValueError("CCv2 card is missing its data object")
        top_unknown = {k: copy.deepcopy(v) for k, v in card_obj.items()
                       if k not in ("spec", "spec_version", "data")}
    else:
        detected = "ccv1"
        data_raw = card_obj
        top_unknown = {}
    data = copy.deepcopy(data_raw)
    notices = [_note("card.spec", "converted", "Imported as %s" % detected)]
    for field in ('name', 'description', 'personality', 'scenario', 'first_mes', 'alternate_greetings',
                  'mes_example', 'system_prompt', 'post_history_instructions', 'character_book', 'creator', 'creator_notes'):
        if field in data:
            notices.append(_note('data.' + field, 'applied' if field not in ('creator', 'creator_notes') else 'preserved',
                'Used as character configuration' if field not in ('creator', 'creator_notes') else 'Creator metadata; excluded from generation'))
    if data.get('extensions'):
        notices.append(_note('data.extensions', 'preserved', 'Unknown extensions are retained verbatim; only documented static fields are interpreted'))
    if top_unknown:
        notices.append(_note("card.top_level", "preserved",
                              "Unknown top-level fields kept: %s" % ", ".join(sorted(top_unknown))))
    name = data.get("name", "")
    name = name if isinstance(name, str) else str(name)
    if not name.strip():
        raise ValueError("Character card is missing its name")
    profile = PortableProfile()
    speaking, kyalulu_nsfw = _apply_kyalulu_roundtrip(data, profile, notices)
    nsfw = bool(data.get("nsfw", False) or kyalulu_nsfw)
    extensions = data.get("extensions")
    risu = extensions.get("risuai") if isinstance(extensions, dict) else None
    source_format = fmt_hint or detected
    if isinstance(risu, dict) and risu:
        source_format = "risu" if fmt_hint is None else fmt_hint
        _import_risu(risu, data, profile, assets, notices)
    doc_assets = []
    for entry in data.get("assets") or []:
        if not isinstance(entry, dict):
            continue
        uri = entry.get("uri", "")
        if not isinstance(uri, str) or not uri:
            continue
        lowered = uri.lower()
        if uri.startswith("data:"):
            try:
                raw, _mime = _data_url_bytes(uri)
                asset = _store_asset(assets, raw, uri, entry.get("name", "asset"),
                                     entry.get("type", "asset"))
                doc_assets.append(asset)
                notices.append(_note("data.assets.%s" % asset.asset_id[:8], "converted",
                                     "Inline data URL asset stored by content hash"))
            except ValueError as exc:
                raise ValueError("Invalid inline asset: %s" % exc) from exc
        else:
            doc_assets.append(PortableAsset(name=entry.get('name', 'asset'), type=entry.get('type', 'asset'), uri=uri))
            if lowered.startswith(('http://', 'https://')):
                notices.append(_note('data.assets', 'preserved', 'Remote asset retained without downloading'))
    if portrait is not None:
        raw, uri = portrait
        try:
            asset = _store_asset(assets, bytes(raw), uri, "portrait", "icon")
        except ValueError as exc:
            raise ValueError("Invalid portrait image: %s" % exc) from exc
        data.setdefault("name", name)
        notices.append(_note("assets.portrait", "converted", "Portrait stored by content hash"))
        doc_assets = [asset] + [a for a in doc_assets if a.uri != 'ccdefault:']
    if isinstance(data.get('character_book'), dict):
        book = data['character_book']
        book['entries'] = _normalize_book_entries(book.get('entries', []), 'data.character_book', notices)
    restored_kind = (data.get('extensions') or {}).get('kyalulu', {}).get('kind', 'character')
    doc = PortableDocument(
        kind=restored_kind if restored_kind in ('character', 'profile', 'lorebook') else 'character',
        name=name.strip(),
        data=data,
        speaking_style=speaking,
        nsfw=nsfw,
        profile=profile,
        assets=doc_assets,
        histories=[],
        source_format=source_format,
        source={"filename": filename, "format": source_format, "card_spec": detected,
                "original": copy.deepcopy(card_obj), "top_unknown": top_unknown},
        notices=notices,
    )
    if isinstance(risu, dict) and risu:
        doc.source["risu"] = True
    return doc


def _import_risu(risu, data, profile, assets, notices):
    variables = dict(profile.variables)
    for key in ("staticVariables", "defaultVariables", "variables"):
        values = risu.get(key)
        if isinstance(values, str):
            values = dict((m.group(1).strip(), m.group(2)) for line in values.splitlines()
                          if (m := re.match(r'^([^=:\n]+)\s*[=:]\s*(.*)$', line)))
        if not isinstance(values, dict):
            continue
        for var_name, var_value in values.items():
            if isinstance(var_value, str):
                variables.setdefault(var_name, var_value)
            else:
                notices.append(_note("extensions.risuai.%s.%s" % (key, var_name), "preserved",
                                     "Only static string variables are imported"))
    if variables:
        profile.variables = variables
        notices.append(_note("extensions.risuai.variables", "converted",
                              "Static string variables mapped to the prompt profile"))
    for field, atype in (("emotions", "emotion"), ("additionalAssets", "asset"), ("background", "background")):
        items = risu.get(field)
        if items is None:
            continue
        if isinstance(items, str) and field == 'background':
            items = [{'name': 'background', 'uri': items}]
        if not isinstance(items, list):
            notices.append(_note("extensions.risuai.%s" % field, "preserved",
                                 "Unsupported layout kept in source extensions"))
            continue
        for index, item in enumerate(items):
            if isinstance(item, list) and len(item) >= 2:
                item = {'name': item[0], 'uri': item[1]}
            if not isinstance(item, dict):
                continue
            src = item.get("src", item.get("uri", item.get("url", "")))
            if not isinstance(src, str) or not src:
                continue
            lowered = src.lower()
            label = item.get("name", item.get("id", str(index)))
            entry = {'name': str(label), 'type': atype, 'uri': src}
            if not any(all(a.get(k) == v for k, v in entry.items()) for a in data.setdefault('assets', [])):
                data['assets'].append(entry)
            if src.startswith("data:"):
                try:
                    raw, _mime = _data_url_bytes(src)
                    _store_asset(assets, raw, src, str(label), atype)
                    notices.append(_note("extensions.risuai.%s.%s" % (field, label), "converted",
                                         "Inline Risu asset stored by content hash"))
                except ValueError as exc:
                    raise ValueError("Invalid Risu asset %s: %s" % (label, exc)) from exc
            elif lowered.startswith(EMBED_PREFIXES) or lowered.startswith(("http://", "https://")):
                notices.append(_note("extensions.risuai.%s.%s" % (field, label), "preserved",
                                     "Risu asset reference kept without download: %s" % src))
            else:
                notices.append(_note("extensions.risuai.%s.%s" % (field, label), "preserved",
                                     "Risu asset reference kept: %s" % src))
    for key in ("scripts", "script", "html", "dynamicVariables", "dynamic_variables", "dynamicVars", "triggerscript", "customscript", "backgroundHTML", "virtualscript"):
        if risu.get(key):
            notices.append(_note("extensions.risuai.%s" % key, "preserved",
                                 "Scripts, HTML, and dynamic variables are preserved without execution"))


def _parse_png_card(filename, raw, assets):
    texts = get_png_texts(raw)
    payload = None
    if "ccv3" in texts:
        payload = texts["ccv3"]
    elif "chara" in texts:
        payload = texts["chara"]
    else:
        raise ValueError("PNG has no embedded character data (missing chara/ccv3 tEXt chunk)")
    try:
        card_obj = _decode_card_text(payload)
    except ValueError as exc:
        raise ValueError("Invalid embedded character data: %s" % exc) from exc
    doc = _cc_document(card_obj, filename, assets, portrait=(bytes(raw), filename))
    for index, asset in enumerate(doc.assets):
        if asset.uri.startswith('__asset:'):
            key = 'chara-ext-asset_:' + asset.uri[len('__asset:'):]
            if key not in texts:
                raise ValueError('PNG references a missing embedded asset')
            blob = base64.b64decode(texts[key], validate=True)
            doc.assets[index] = _store_asset(assets, blob, asset.uri, asset.name, asset.type)
    doc.source["png_text_fields"] = sorted(texts)
    if "ccv3" in texts and "chara" in texts:
        doc.notices.append(_note("png.ccv3", "converted",
                                  "Both chara and ccv3 chunks present; ccv3 preferred"))
    has_actl = any(ctype == "acTL" for ctype, _data in
                   __import__("python.core.portable_binary", fromlist=["parse_png_chunks"]).parse_png_chunks(raw))
    if has_actl:
        doc.notices.append(_note("png.animated", "converted",
                                  "Animated PNG accepted; still image used as portrait"))
    return [doc], assets


def _resolve_zip_path(files, base, ref):
    candidates = []
    if base:
        candidates.append(posixpath.normpath(posixpath.join(base, ref)))
    candidates.append(posixpath.normpath(ref))
    for candidate in candidates:
        if candidate in files:
            return candidate, files[candidate]
    return None, None


def _parse_charx(filename, raw, assets):
    files = safe_open_zip(raw)
    card_name = None
    for candidate in ("card.json", "rootcard.json"):
        if candidate in files:
            card_name = candidate
            break
    if card_name is None:
        for key in sorted(files):
            lowered = key.lower()
            if lowered == "card.json" or lowered.endswith("/card.json"):
                card_name = key
                break
            if lowered == "rootcard.json" or lowered.endswith("/rootcard.json"):
                card_name = key
                break
    if card_name is None:
        raise ValueError("CHARX archive is missing card.json/rootcard.json")
    try:
        card_obj = json.loads(files[card_name].decode("utf-8"))
    except Exception as exc:
        raise ValueError("CHARX %s is not valid JSON: %s" % (card_name, exc)) from exc
    doc = _cc_document(card_obj, filename, assets, portrait=None, fmt_hint="charx")
    base = posixpath.dirname(card_name)
    resolved = {}
    for index, asset in enumerate(doc.assets):
        if not asset.uri.startswith(EMBED_PREFIXES):
            continue
        rel = asset.uri.split('://', 1)[1]
        if '..' in rel.split('/') or rel.startswith('/'):
            raise ValueError('Unsafe CHARX asset reference')
        found, blob = _resolve_zip_path(files, base, rel)
        if blob is None:
            raise ValueError('CHARX references missing embedded file: ' + asset.uri)
        if sniff_mime(blob):
            resolved[asset.uri] = _store_asset(assets, blob, asset.uri, asset.name, asset.type)
            doc.assets[index] = resolved[asset.uri]
        else:
            doc.notices.append(_note('assets.' + asset.name, 'preserved', 'Unsupported media retained in original archive'))
    doc.source["charx_card"] = card_name
    doc.notices.append(_note("charx.card", "converted",
                              "CHARX %s imported with %d embedded file(s)" % (card_name, len(resolved))))
    return [doc], assets


def _normalize_sampler_settings(obj, notices):
    settings = {}
    model_hint = ""
    candidates = {}
    for key in ("generation_settings", "sampler_settings", "settings", "samplers"):
        values = obj.get(key)
        if isinstance(values, dict):
            for name, value in values.items():
                candidates.setdefault(name, value)
    for name, value in obj.items():
        if name in ("prompts", "prompt_order", "entries", "worldinfo", "world_info",
                    "lorebook", "worldInfo", "story_string", "context", "name",
                    "system_prompt", "extensions", "data"):
            continue
        candidates.setdefault(name, value)
    for name, value in candidates.items():
        if not isinstance(name, str):
            continue
        lowered = name.lower()
        if lowered in ("model", "model_name", "llm_model", "model_hint"):
            if isinstance(value, str) and value and not model_hint:
                model_hint = value
                notices.append(_note("generation_settings.%s" % name, "converted",
                                     "Model name kept as a display hint only"))
            continue
        if URLKEY_HINT.search(name) and lowered.replace('_', '') not in SAMPLER_ALIASES:
            notices.append(_note("generation_settings.%s" % name, "preserved",
                                 "API URL, key, and endpoint configuration is never imported"))
            continue
        canonical = SAMPLER_ALIASES.get(lowered.replace("-", "").replace("_", ""))
        if canonical is None:
            canonical = SAMPLER_ALIASES.get(lowered)
        if canonical is None:
            notices.append(_note("generation_settings.%s" % name, "preserved",
                                 "Unknown generation setting kept in source only"))
            continue
        settings[canonical] = value
    return settings, model_hint


def _normalize_prompt(raw, notices):
    if not isinstance(raw, dict):
        raise ValueError("Prompt preset entries must be objects")
    prompt = dict(raw)
    identifier = prompt.get("identifier", prompt.get("name", ""))
    identifier = identifier if isinstance(identifier, str) else str(identifier)
    if not identifier:
        raise ValueError("Prompt preset entry is missing its identifier")
    role = prompt.get("role", "system")
    if role not in ("system", "user", "assistant"):
        notices.append(_note("profile.prompts.%s" % identifier, "preserved",
                             "Unsupported message role kept in source"))
        role = "system"
    content = prompt.get("content", prompt.get("system_prompt", prompt.get("prompt", "")))
    content = content if isinstance(content, str) else str(content)
    prompt["identifier"] = identifier
    prompt["role"] = role
    prompt["content"] = content
    prompt["marker"] = bool(prompt.get("marker", True))
    prompt["enabled"] = bool(prompt.get("enabled", True))
    return prompt


def _normalize_book_entries(raw_entries, prefix, notices):
    if isinstance(raw_entries, dict):
        def sort_key(item):
            key = item[0]
            try:
                return (0, int(key))
            except (TypeError, ValueError):
                return (1, str(key))
        items = [(key, raw_entries[key]) for key, _v in sorted(raw_entries.items(), key=sort_key)]
    elif isinstance(raw_entries, list):
        items = list(enumerate(raw_entries))
    else:
        raise ValueError("Lorebook entries must be an object or array")
    entries = []
    for position, (origin, raw) in enumerate(items):
        if not isinstance(raw, dict):
            raise ValueError("Lorebook entry %s must be an object" % (origin,))
        entry = dict(raw)
        ext = entry.get('extensions')
        if isinstance(ext, dict):
            for key in ('useProbability', 'probability', 'delay', 'cooldown', 'sticky', 'selectiveLogic',
                        'matchWholeWords', 'excludeRecursion', 'preventRecursion', 'delayUntilRecursion', 'group'):
                if key in ext:
                    entry.setdefault(key, ext[key])
        keys = entry.get("keys", entry.get("key", []))
        if isinstance(keys, str):
            keys = keys.split(",")
        else:
            keys = [part for k in keys for part in str(k).split(",")]
        keys = [k.strip() for k in (str(k) for k in keys) if k.strip()]
        secondary = entry.get("secondary_keys", entry.get("keysecondary", entry.get("secondaryKeys", [])))
        if isinstance(secondary, str):
            secondary = secondary.split(",")
        else:
            secondary = [part for k in secondary for part in str(k).split(",")]
        secondary = [k.strip() for k in (str(k) for k in secondary) if k.strip()]
        content = entry.get("content", "")
        content = content if isinstance(content, str) else str(content)
        entry["keys"] = keys
        entry["secondary_keys"] = secondary
        entry["constant"] = bool(entry.get("constant", False))
        entry["enabled"] = bool(entry.get("enabled", not entry.get("disable", False)))
        entry['insertion_order'] = entry.get('insertion_order', entry.get('order', position))
        entry['case_sensitive'] = entry.get('case_sensitive', entry.get('caseSensitive', False))
        entry['selective'] = bool(entry.get('selective', False))
        raw_position = entry.get('position', 'after_char')
        entry['position'] = {0: 'before_char', 1: 'after_char'}.get(raw_position, raw_position)
        entry["content"] = content
        entry.setdefault("comment", entry.get("comment", entry.get("title", "")))
        from .portable_prompt import unsupported_lore_condition
        advanced = unsupported_lore_condition(entry)
        if advanced and entry["enabled"]:
            entry["enabled"] = False
            notices.append(_note("%s.entries.%s" % (prefix, origin), "converted",
                                 "Unsupported advanced condition disabled (regex, probability, or time); source preserved"))
        entries.append(entry)
    return entries


def _parse_st_preset(obj, filename, assets):
    prompts_raw = obj.get("prompts")
    order_raw = obj.get("prompt_order")
    if not isinstance(prompts_raw, list) or not prompts_raw:
        raise ValueError("SillyTavern preset is missing its prompts array")
    if not isinstance(order_raw, list) or not order_raw:
        raise ValueError("SillyTavern preset is missing its prompt_order array")
    notices = [_note("preset", "converted", "SillyTavern prompt preset imported as a profile")]
    selected = None
    for entry in order_raw:
        if isinstance(entry, dict) and entry.get("character_id") == 100:
            selected = entry
            break
    if selected is None:
        selected = order_raw[0]
        if not isinstance(selected, dict):
            raise ValueError("SillyTavern prompt_order entries must be objects")
        notices.append(_note("preset.prompt_order", "preserved",
                              "No character_id 100 block found; first prompt_order block used"))
    order = selected.get("order")
    if not isinstance(order, list) or not order:
        raise ValueError("Selected SillyTavern prompt_order block has no order array")
    by_id = {}
    for prompt in prompts_raw:
        if not isinstance(prompt, dict):
            raise ValueError("SillyTavern prompts must be objects")
        key = prompt.get("identifier", prompt.get("name", ""))
        key = key if isinstance(key, str) else str(key)
        if key and key not in by_id:
            by_id[key] = prompt
    ordered = []
    referenced = set()
    for item in order:
        if not isinstance(item, dict) or not item.get("identifier"):
            raise ValueError("SillyTavern prompt_order items must carry an identifier")
        identifier = item["identifier"]
        raw = by_id.get(identifier)
        if raw is None:
            notices.append(_note("profile.prompts.%s" % identifier, "error",
                                 "prompt_order references a prompt that is not defined"))
            continue
        prompt = _normalize_prompt(raw, notices)
        if "enabled" in item:
            prompt["enabled"] = bool(item["enabled"])
        ordered.append(prompt)
        referenced.add(identifier)
    leftovers = [p for p in prompts_raw
                 if (p.get("identifier", p.get("name", "")) or "") not in referenced]
    for raw in leftovers:
        try:
            prompt = _normalize_prompt(raw, notices)
            prompt['enabled'] = False
            ordered.append(prompt)
        except ValueError as exc:
            notices.append(_note("profile.prompts", "error", "Skipped malformed prompt: %s" % exc))
    if leftovers:
        notices.append(_note("profile.prompts.unreferenced", "converted",
                              "%d prompt(s) outside prompt_order preserved but disabled" % len(leftovers)))
    settings, model_hint = _normalize_sampler_settings(obj, notices)
    context = obj.get("context")
    story = obj.get("story_string", "")
    if not story and isinstance(context, dict):
        story = context.get("story_string", "")
    story = story if isinstance(story, str) else str(story)
    system_prompt = obj.get("system_prompt", "")
    system_prompt = system_prompt if isinstance(system_prompt, str) else str(system_prompt)
    profile = PortableProfile(settings=settings, system_prompt=system_prompt,
                               context_template=story, prompts=ordered,
                               model_hint=model_hint, variables={})
    data = {"description": ""}
    for key in ("worldinfo", "world_info", "worldInfo", "lorebook"):
        world = obj.get(key)
        if isinstance(world, dict) and isinstance(world.get("entries"), (dict, list)):
            entries = _normalize_book_entries(world["entries"], "data.character_book", notices)
            data["character_book"] = {"name": world.get("name", ""), "entries": entries}
            notices.append(_note("preset.worldinfo", "converted",
                                 "Embedded world info normalized to a character book"))
            break
    name = obj.get("name", "") or _stem(filename, "SillyTavern Preset")
    name = name if isinstance(name, str) else str(name)
    doc = PortableDocument(
        kind="profile",
        name=name.strip() or "SillyTavern Preset",
        data=data,
        speaking_style="",
        nsfw=False,
        profile=profile,
        assets=[],
        histories=[],
        source_format="sillytavern_preset",
        source={"filename": filename, "format": "sillytavern_preset",
                "original": copy.deepcopy(obj),
                "prompt_order_selected": selected.get("character_id")},
        notices=notices,
    )
    return [doc], assets


def _parse_st_worldinfo(obj, filename, assets):
    entries_raw = obj.get("entries")
    if not isinstance(entries_raw, (dict, list)):
        raise ValueError("SillyTavern world info is missing its entries object")
    notices = [_note("lorebook", "converted", "SillyTavern world info imported as a lorebook")]
    entries = _normalize_book_entries(entries_raw, "data.character_book", notices)
    name = obj.get("name", "") or _stem(filename, "World Info")
    name = name if isinstance(name, str) else str(name)
    doc = PortableDocument(
        kind="lorebook",
        name=name.strip() or "World Info",
        data={"character_book": {"name": obj.get("name", ""), "entries": entries}},
        speaking_style="",
        nsfw=False,
        profile=PortableProfile(),
        assets=[],
        histories=[],
        source_format="sillytavern_worldinfo",
        source={"filename": filename, "format": "sillytavern_worldinfo",
                "original": copy.deepcopy(obj)},
        notices=notices,
    )
    return [doc], assets


def _parse_byaf(filename, raw, assets):
    from .portable_byaf import parse_byaf
    return parse_byaf(filename, raw, assets)


def _parse_cai_character(obj, filename, assets):
    name = obj.get("name", "")
    name = name if isinstance(name, str) else str(name)
    if not name.strip():
        raise ValueError("Character.AI character is missing its name")
    description = obj.get("description", "")
    greeting = obj.get("greeting", obj.get("first_mes", ""))
    definition = obj.get("definition", "")
    description = description if isinstance(description, str) else str(description)
    greeting = greeting if isinstance(greeting, str) else str(greeting)
    definition = definition if isinstance(definition, str) else str(definition)
    known = {"name", "description", "greeting", "first_mes", "definition"}
    unknown = sorted(k for k in obj if k not in known)
    notices = [_note("character.definition", "converted",
                      "Character.AI definition preserved verbatim; creator notes stay out of prompt text")]
    if unknown:
        notices.append(_note("character.top_level", "preserved",
                              "Unknown fields kept: %s" % ", ".join(unknown)))
    data = {"description": description, "first_mes": greeting, "greeting": greeting,
            "definition": definition, "personality": "", "scenario": "",
            "creator_notes": obj.get("creator_notes", obj.get("creatorNotes", ""))}
    doc = PortableDocument(
        kind="character",
        name=name.strip(),
        data=data,
        speaking_style="",
        nsfw=bool(obj.get("nsfw", False)),
        profile=PortableProfile(),
        assets=[],
        histories=[],
        source_format="characterai",
        source={"filename": filename, "format": "characterai", "original": copy.deepcopy(obj)},
        notices=notices,
    )
    return [doc], assets


def _parse_cai_lorebook_entries(entries, name, filename, assets, original):
    normalized = []
    for index, raw in enumerate(entries):
        if not isinstance(raw, dict) or "content" not in raw:
            raise ValueError("Character.AI lorebook entry %d must carry content" % index)
        keys = raw.get("key", raw.get("keys", []))
        if isinstance(keys, str):
            keys = [k.strip() for k in keys.split(",")]
        keys = [k for k in (str(k).strip() for k in keys) if k]
        normalized.append({"comment": str(raw.get("comment", raw.get("title", ""))),
                           "keys": keys, "content": str(raw.get("content", "")),
                           "enabled": bool(raw.get("enabled", True))})
    doc = PortableDocument(
        kind="lorebook",
        name=(name or _stem(filename, "Lorebook")).strip() or "Lorebook",
        data={"character_book": {"name": name, "entries": normalized}},
        speaking_style="",
        nsfw=False,
        profile=PortableProfile(),
        assets=[],
        histories=[],
        source_format="characterai_lorebook",
        source={"filename": filename, "format": "characterai_lorebook",
                "original": copy.deepcopy(original)},
        notices=[_note("lorebook", "converted", "Character.AI lorebook imported with %d entries" % len(normalized))],
    )
    return [doc], assets


def _parse_cai_text(text, filename, assets):
    lines = text.splitlines()
    if any(Lorebook_NAME_RE.match(line) for line in lines) or any(ENTRY_TITLE_RE.match(line) for line in lines):
        return _parse_cai_lorebook_text(text, filename, assets)
    positions = {}
    for index, line in enumerate(lines):
        match = LABEL_RE.match(line)
        if match and match.group(1).lower() not in positions:
            positions[match.group(1).lower()] = (index, match.group(2))
    if "name" not in positions:
        raise ValueError("Character.AI pasted text requires a Name label")
    # Definition is opaque: labels appearing inside it are never parsed as fields.
    definition_line = positions.get("definition", (len(lines), ""))[0]
    fields = sorted((index, key, value) for key, (index, value) in positions.items()
                    if index <= definition_line)
    obj = {"description": "", "greeting": "", "definition": ""}
    for n, (index, key, value) in enumerate(fields):
        end = fields[n + 1][0] if n + 1 < len(fields) else len(lines)
        if key == 'definition':
            original_lines = text.splitlines(keepends=True)
            offset = sum(len(line) for line in original_lines[:index])
            colon = original_lines[index].index(':') + 1
            body = text[offset + colon:]
            if body.startswith((' ', '\t')):
                body = body[1:]
            if body.startswith('\r\n'):
                body = body[2:]
            elif body.startswith('\n'):
                body = body[1:]
            obj[key] = body
        else:
            obj[key] = "\n".join([value, *lines[index + 1:end]]).strip()
    if not obj.get('name'):
        raise ValueError("Character.AI pasted text is missing its Name")
    docs, assets = _parse_cai_character(obj, filename, assets)
    docs[0].source["pasted"] = True
    return docs, assets


def _parse_cai_lorebook_text(text, filename, assets):
    lines = text.splitlines()
    book_name = ""
    for line in lines:
        match = Lorebook_NAME_RE.match(line)
        if match:
            book_name = match.group(1).strip()
            break
    blocks = []
    current = None
    for line in lines:
        title = ENTRY_TITLE_RE.match(line)
        if title:
            current = [title.group(1).strip()]
            blocks.append(current)
        elif current is not None:
            current.append(line)
    if not blocks:
        raise ValueError("Character.AI lorebook text has no entries")
    entries = []
    for block in blocks:
        title = block[0]
        keywords = []
        content_lines = None
        for index, line in enumerate(block[1:]):
            key_match = KEYWORDS_RE.match(line)
            content_match = CONTENT_RE.match(line)
            if key_match and not keywords:
                keywords = [k.strip() for k in key_match.group(1).split(",") if k.strip()]
            if content_match:
                content_lines = [content_match.group(1)] + block[1:][index + 1:]
                break
        if content_lines is None:
            raise ValueError("Character.AI lorebook entry is missing its Content")
        content = "\n".join(content_lines).strip("\n").strip("\r").strip()
        entries.append({"comment": title, "key": keywords, "content": content})
    return _parse_cai_lorebook_entries(entries, book_name or _stem(filename, "Lorebook"),
                                        filename, assets, {"text": text})


def _parse_backup(filename, raw, assets):
    files = safe_open_zip(raw)
    if "manifest.json" not in files:
        raise ValueError("Kyalulu backup is missing manifest.json")
    try:
        manifest = json.loads(files["manifest.json"].decode("utf-8"))
    except Exception as exc:
        raise ValueError("Kyalulu backup manifest is not valid JSON: %s" % exc) from exc
    if not isinstance(manifest, dict) or manifest.get("format") != "kyalulu_backup":
        raise ValueError("Not a Kyalulu backup archive")
    if manifest.get("version") != 1:
        raise ValueError("Unsupported Kyalulu backup version")
    if "document.json" not in files:
        raise ValueError("Kyalulu backup is missing document.json")
    try:
        doc = PortableDocument.model_validate_json(files["document.json"].decode("utf-8"))
    except Exception as exc:
        raise ValueError("Kyalulu backup document is invalid: %s" % exc) from exc
    for arc_name, blob in files.items():
        if arc_name in ("manifest.json", "document.json"):
            continue
        if not arc_name.startswith("assets/"):
            doc.notices.append(_note(arc_name, "preserved", "Unknown backup file kept without interpretation"))
            continue
        asset_id = posixpath.basename(arc_name)
        if not SHA_RE.fullmatch(asset_id or ""):
            raise ValueError("Invalid backup asset name: %s" % arc_name)
        if hashlib.sha256(blob).hexdigest() != asset_id:
            raise ValueError("Backup asset checksum mismatch: %s" % arc_name)
        mime = sniff_mime(blob) or "application/octet-stream"
        _checked, mime = validate_image(blob)
        assets[asset_id] = (bytes(blob), mime)
    for asset in doc.assets:
        if asset.asset_id and asset.asset_id not in assets:
            raise ValueError("Backup document references missing asset: %s" % asset.asset_id)
    doc.source["backup_filename"] = filename
    return [doc], assets


def _looks_like_cai_lorebook_list(entries):
    sample = entries[:3] if len(entries) >= 3 else entries
    return bool(sample) and all(isinstance(e, dict) and "content" in e
                                and ("comment" in e or "key" in e or "keys" in e) for e in sample)


def parse_import(filename, raw):
    """Parse one uploaded file into (documents, assets). Never fetches URLs."""
    try:
        return _parse_import_inner(filename, raw)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Could not parse upload: %s" % exc) from exc


def _parse_import_inner(filename, raw):
    if not isinstance(raw, (bytes, bytearray)):
        raise ValueError("Upload must be bytes")
    raw = bytes(raw)
    if not raw:
        raise ValueError("Empty file")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("Upload exceeds 32 MiB")
    if not isinstance(filename, str) or not filename:
        filename = "upload.bin"
    assets = {}
    if bytes(raw[:8]) == PNG_MAGIC:
        return _parse_png_card(filename, raw, assets)
    if raw[:2] == b"PK":
        files = safe_open_zip(raw)
        if "manifest.json" in files:
            try:
                maybe = json.loads(files["manifest.json"].decode("utf-8"))
            except Exception:
                maybe = None
            if isinstance(maybe, dict) and maybe.get("format") == "kyalulu_backup":
                return _parse_backup(filename, raw, assets)
        lowered = [k.lower() for k in files]
        if "card.json" in files or "rootcard.json" in files or any(
                k == "card.json" or k.endswith("/card.json") or k == "rootcard.json"
                or k.endswith("/rootcard.json") for k in lowered):
            return _parse_charx(filename, raw, assets)
        if "manifest.json" in files:
            return _parse_byaf(filename, raw, assets)
        raise ValueError("Archive is not a recognized ZIP format")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("File is not UTF-8 text: %s" % exc) from exc
    if not text.strip():
        raise ValueError("Empty file")
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        docs, assets = _parse_cai_text(text, filename, assets)
        return docs, assets
    if isinstance(obj, list):
        if _looks_like_cai_lorebook_list(obj):
            return _parse_cai_lorebook_entries(obj, _stem(filename, "Lorebook"), filename, assets, obj)
        raise ValueError("Unsupported JSON format")
    if not isinstance(obj, dict):
        raise ValueError("Unsupported JSON format")
    if ('story_string' in obj or 'system_prompt' in obj or 'input_sequence' in obj
            or 'output_sequence' in obj or any(k in obj for k in ('temperature', 'temp', 'top_p', 'top_k'))
            or ('content' in obj and 'name' in obj and 'description' not in obj)) and not any(k in obj for k in ('spec', 'description', 'first_mes', 'definition')) and 'prompts' not in obj:
        notes = [_note('preset', 'converted', 'Standalone SillyTavern profile imported')]
        settings, hint = _normalize_sampler_settings(obj, notes)
        profile = PortableProfile(settings=settings, model_hint=hint, system_prompt=obj.get('system_prompt', obj.get('content', '')),
                                  context_template=obj.get('story_string', ''), post_history_instructions=obj.get('post_history_instructions', ''))
        return [PortableDocument(kind='profile', name=obj.get('name') or _stem(filename), profile=profile,
                source_format='sillytavern_preset', source={'original': obj}, notices=notes)], assets
    if isinstance(obj.get("prompts"), list) and isinstance(obj.get("prompt_order"), list):
        return _parse_st_preset(obj, filename, assets)
    if isinstance(obj.get("entries"), dict):
        return _parse_st_worldinfo(obj, filename, assets)
    if "spec" in obj or "spec_version" in obj:
        return [_cc_document(obj, filename, assets)], assets
    if isinstance(obj.get("data"), dict) and any(
            k in obj["data"] for k in ("name", "description", "first_mes", "mes_example", "personality")):
        return [_cc_document(obj, filename, assets)], assets
    if isinstance(obj.get("extensions"), dict) and "risuai" in obj["extensions"]:
        return [_cc_document(obj, filename, assets)], assets
    if isinstance(obj.get("entries"), list):
        if _looks_like_cai_lorebook_list(obj["entries"]):
            return _parse_cai_lorebook_entries(obj["entries"], obj.get("name", "") or _stem(filename, "Lorebook"),
                                                filename, assets, obj)
        if all(isinstance(e, dict) and "content" in e for e in obj["entries"][:3]):
            notices_holder = []
            entries = _normalize_book_entries(obj["entries"], "data.character_book", notices_holder)
            doc = PortableDocument(kind="lorebook", name=(obj.get("name", "") or _stem(filename, "World Info")),
                                   data={"character_book": {"name": obj.get("name", ""), "entries": entries}},
                                   source_format="sillytavern_worldinfo",
                                   source={"filename": filename, "format": "sillytavern_worldinfo",
                                           "original": copy.deepcopy(obj)},
                                   notices=[_note("lorebook", "converted",
                                                  "World entries imported as a lorebook")] + notices_holder)
            return [doc], assets
        raise ValueError("Unsupported JSON format")
    if "greeting" in obj or "definition" in obj:
        return _parse_cai_character(obj, filename, assets)
    if "name" in obj and "description" in obj:
        return [_cc_document(obj, filename, assets)], assets
    if "name" in obj and isinstance(obj.get("name"), str):
        return [_cc_document(obj, filename, assets)], assets
    raise ValueError("Unsupported JSON format")
