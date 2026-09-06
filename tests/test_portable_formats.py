"""Pure fixture tests for portable import/export adapters (no network, no db)."""
import base64
import io
import json
import zipfile

import pytest

from python.core import portable_binary as binary
from python.core import portable_formats as formats
from python.core.portable_export import export_document
from python.core.portable_formats import parse_import


def _b64(obj):
    return base64.b64encode(json.dumps(obj, ensure_ascii=False).encode("utf-8")).decode("ascii")


def _zip_bytes(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as handle:
        for name, blob in entries:
            if isinstance(blob, zipfile.ZipInfo):
                handle.writestr(blob, entries[1] if False else b"")
            else:
                handle.writestr(name, blob)
    return buffer.getvalue()


def _zip_raw(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as handle:
        for name, blob in entries:
            handle.writestr(name, blob)
    return buffer.getvalue()


def _ccv2_card(**changes):
    card = {"spec": "chara_card_v2", "spec_version": "2.0", "data": {
        "name": "シアン", "description": "日本語で簡潔に話す案内人",
        "personality": "素っ気ないが優しい", "scenario": "深夜の図書館",
        "first_mes": "こんばんは", "mes_example": "hello",
        "creator_notes": "CREATOR_ONLY", "tags": ["ja"],
        "extensions": {"unknown": {"keep": [1, 2]}},
    }}
    card["data"].update(changes)
    return card


def _ccv3_card(**changes):
    card = {"spec": "chara_card_v3", "spec_version": "3.0", "data": {
        "name": "シアン", "description": "日本語の案内人",
        "first_mes": "やあ", "extensions": {},
    }}
    card["data"].update(changes)
    return card


def _jpeg_bytes():
    from PIL import Image
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buffer, format="JPEG")
    return buffer.getvalue()


def test_ccv1_japanese_import_and_unknown_roundtrip():
    raw = json.dumps({"name": "シアン", "description": "日本語で話す",
                      "personality": "素っ気ない", "creator_notes": "CREATOR_ONLY",
                      "extensions": {"mystery": {"x": 1}}}, ensure_ascii=False).encode("utf-8")
    docs, assets = parse_import("cyan.json", raw)
    assert len(docs) == 1 and assets == {}
    doc = docs[0]
    assert doc.kind == "character" and doc.source_format == "ccv1"
    assert doc.name == "シアン" and doc.data["description"] == "日本語で話す"
    assert doc.data["extensions"]["mystery"] == {"x": 1}
    assert doc.source["original"]["creator_notes"] == "CREATOR_ONLY"
    payload, mime, filename, _notices = export_document(doc, "ccv3-json", assets)
    assert mime == "application/json" and filename.endswith(".json")
    again, _ = parse_import("re.json", payload)
    assert again[0].data["extensions"]["mystery"] == {"x": 1}
    assert again[0].data["creator_notes"] == "CREATOR_ONLY"


def test_user_edits_override_source_fields_on_export():
    docs, assets = parse_import("c.json", json.dumps(_ccv2_card()).encode("utf-8"))
    edited = docs[0].model_copy(deep=True)
    edited.data["description"] = "EDITED BY USER"
    payload, _mime, _name, _n = export_document(edited, "ccv2-json", assets)
    assert json.loads(payload.decode("utf-8"))["data"]["description"] == "EDITED BY USER"


def test_ccv2_unknown_top_fields_preserved_with_notice():
    card = _ccv2_card()
    card["future_field"] = {"nested": True}
    docs, _assets = parse_import("c.json", json.dumps(card).encode("utf-8"))
    assert docs[0].source["top_unknown"] == {"future_field": {"nested": True}}
    assert any(n.path == "card.top_level" and n.status == "preserved" for n in docs[0].notices)
    payload, _mime, _name, notices = export_document(docs[0], "ccv2-json", {})
    assert json.loads(payload.decode("utf-8"))["future_field"] == {"nested": True}
    assert any(n["path"] == "export.top_level" for n in notices)


def test_ccv3_import():
    docs, _assets = parse_import("c.json", json.dumps(_ccv3_card()).encode("utf-8"))
    assert docs[0].source_format == "ccv3" and docs[0].name == "シアン"


def test_png_prefers_ccv3_and_registers_portrait():
    v2 = _ccv2_card()
    v3 = _ccv3_card()
    v3["data"]["name"] = "V3優先"
    image = binary.build_png_with_text(binary.neutral_png(), {"chara": _b64(v2), "ccv3": _b64(v3)})
    docs, assets = parse_import("card.png", image)
    assert docs[0].name == "V3優先" and docs[0].source_format == "ccv2" or docs[0].name == "V3優先"
    assert docs[0].source["png_text_fields"] == ["ccv3", "chara"]
    assert any(n.path == "png.ccv3" for n in docs[0].notices)
    assert len(docs[0].assets) == 1 and docs[0].assets[0].type == "icon"
    asset_id = docs[0].assets[0].asset_id
    assert assets[asset_id][1] == "image/png"


def test_png_corrupt_crc_and_missing_chunk_rejected():
    good = binary.build_png_with_text(binary.neutral_png(), {"chara": _b64(_ccv2_card())})
    bad = bytearray(good)
    bad[40] ^= 0xFF
    with pytest.raises(ValueError):
        parse_import("card.png", bytes(bad))
    with pytest.raises(ValueError):
        parse_import("plain.png", binary.neutral_png())
    with pytest.raises(ValueError):
        parse_import("card.png", b"\x89PNG\r\n\x1a\nshort")


def test_charx_embeded_uri_and_missing_reference():
    portrait = binary.neutral_png()
    card = _ccv2_card()
    card["data"]["assets"] = [{"uri": "embeded://files/face.png", "name": "face", "type": "icon", "ext": "png"}]
    blob = _zip_raw([("rootcard.json", json.dumps(card).encode("utf-8")),
                     ("files/face.png", portrait)])
    docs, assets = parse_import("card.charx", blob)
    assert docs[0].source_format == "charx"
    assert len(docs[0].assets) == 1
    assert docs[0].assets[0].uri == "embeded://files/face.png"
    assert assets[docs[0].assets[0].asset_id][0] == portrait
    lonely = _zip_raw([("card.json", json.dumps(card).encode("utf-8"))])
    with pytest.raises(ValueError):
        parse_import("card.charx", lonely)


def test_zip_guardrails_traversal_duplicate_absolute_symlink():
    card = _ccv2_card()
    card["data"]["extensions"]["pic"] = {"src": "embeded://files/face.png"}
    evil = _zip_raw([("card.json", json.dumps(card).encode("utf-8")),
                     ("../evil.txt", b"x"), ("files/face.png", binary.neutral_png())])
    with pytest.raises(ValueError):
        parse_import("evil.charx", evil)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as handle:
        handle.writestr("a.txt", b"1")
        handle.writestr("a.txt", b"2")
    with pytest.raises(ValueError):
        parse_import("dup.zip", buffer.getvalue())
    absolute = _zip_raw([("/abs.txt", b"x")])
    with pytest.raises(ValueError):
        parse_import("abs.zip", absolute)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as handle:
        info = zipfile.ZipInfo("link")
        info.create_system = 3
        info.external_attr = (0o120777 << 16)
        handle.writestr(info, "target")
    with pytest.raises(ValueError):
        parse_import("link.zip", buffer.getvalue())
    with pytest.raises(ValueError):
        parse_import("mystery.zip", _zip_raw([("readme.txt", b"hi")]))


def test_risu_static_vars_emotions_and_script_notice():
    from PIL import Image
    emotion = io.BytesIO()
    Image.new("RGB", (4, 4), (10, 200, 90)).save(emotion, format="PNG")
    data_url = "data:image/png;base64," + base64.b64encode(emotion.getvalue()).decode("ascii")
    card = _ccv2_card()
    card["data"]["extensions"]["risuai"] = {
        "staticVariables": {"mood": "calm", "obj": {"nested": 1}},
        "emotions": [{"name": "smile", "src": data_url}],
        "scripts": [{"name": "evil", "code": "alert(1)"}],
        "html": "<b>hi</b>",
    }
    docs, assets = parse_import("risu.json", json.dumps(card).encode("utf-8"))
    doc = docs[0]
    assert doc.source_format == "risu"
    assert doc.profile.variables.get("mood") == "calm"
    assert any("staticVariables.obj" in n.path for n in doc.notices)
    assert any("scripts" in n.path and n.status == "preserved" for n in doc.notices)
    assert any("html" in n.path for n in doc.notices)
    assert any("without execution" in n.reason for n in doc.notices)
    assert len(assets) == 1


def test_st_preset_order_samplers_and_worldinfo():
    preset = {
        "name": "推しプリセット",
        "prompts": [
            {"identifier": "main", "role": "system", "content": "GLOBAL MAIN"},
            {"identifier": "chatHistory", "role": "system", "content": ""},
            {"identifier": "jailbreak", "role": "system", "content": "JB"},
            {"identifier": "custom", "role": "user", "content": "やあ", "extra": 1},
        ],
        "prompt_order": [
            {"character_id": 50, "order": [{"identifier": "main", "enabled": True}]},
            {"character_id": 100, "order": [{"identifier": "jailbreak", "enabled": True},
                                            {"identifier": "main", "enabled": True},
                                            {"identifier": "custom", "enabled": False},
                                            {"identifier": "ghost", "enabled": True}]},
        ],
        "story_string": "舞台は東京",
        "temperature": 0.7, "rep_pen": 1.1, "api_key": "secret", "api_url": "https://x",
        "mystery_setting": 5,
        "worldinfo": {"name": "W", "entries": {
            "1": {"key": ["鍵"], "content": "扉が開く"},
            "2": {"key": ["呪文"], "content": "regex", "use_regex": True},
        }},
    }
    docs, _assets = parse_import("preset.json", json.dumps(preset, ensure_ascii=False).encode("utf-8"))
    doc = docs[0]
    assert doc.kind == "profile" and doc.source_format == "sillytavern_preset"
    assert doc.name == "推しプリセット"
    assert [p["identifier"] for p in doc.profile.prompts[:3]] == ["jailbreak", "main", "custom"]
    assert doc.profile.prompts[2]["enabled"] is False
    assert doc.profile.prompts[3]["identifier"] == "chatHistory"
    assert all({"identifier", "role", "content", "marker", "enabled"} <= set(p) for p in doc.profile.prompts)
    assert doc.profile.prompts[2]["extra"] == 1
    assert any(n.path == "profile.prompts.ghost" and n.status == "error" for n in doc.notices)
    assert doc.profile.settings["temperature"] == 0.7
    assert doc.profile.settings["repeat_penalty"] == 1.1
    assert "api_key" not in doc.profile.settings and "api_url" not in doc.profile.settings
    assert any("never imported" in n.reason for n in doc.notices)
    assert doc.profile.context_template == "舞台は東京"
    book = doc.data["character_book"]["entries"]
    assert book[0]["keys"] == ["鍵"] and book[0]["enabled"] is True
    assert book[1]["enabled"] is False
    assert any("advanced condition" in n.reason for n in doc.notices)
    assert doc.source["original"]["mystery_setting"] == 5
    assert doc.source["prompt_order_selected"] == 100


def test_st_worldinfo_standalone_is_lorebook():
    book = {"name": "世界書", "entries": {"10": {"key": "竜,ドラゴン", "content": "竜は空を飛ぶ"}}}
    docs, _assets = parse_import("world.json", json.dumps(book, ensure_ascii=False).encode("utf-8"))
    assert docs[0].kind == "lorebook"
    assert docs[0].data["character_book"]["entries"][0]["keys"] == ["竜", "ドラゴン"]


def _byaf_zip():
    from portable_samples import byaf_sample
    return byaf_sample()


def test_byaf_official_v1_paths_images_history_selection():
    blob, portrait = _byaf_zip()
    docs, assets = parse_import('pack.byaf', blob)
    assert len(docs) == 2
    alice = docs[0]
    assert alice.name == 'アリス · 森'
    assert alice.data['description'].startswith('不思議')
    assert alice.data['scenario'] == '森の入り口'
    assert alice.data['first_mes'] == 'こんにちは'
    assert alice.profile.settings['temperature'] == 0.7
    assert alice.profile.settings['min_p'] == 0.05
    assert assets[alice.assets[0].asset_id][0] == portrait
    assert alice.histories[0].messages[1]['content'] == '選択された返答'
    assert len(alice.histories[0].messages[1]['origin']['original']['outputs']) == 2
    assert not alice.nsfw
    assert any(n.path == 'scenario.promptTemplate' and n.status == 'preserved' for n in alice.notices)


def test_byaf_errors_are_not_silent():
    manifest = {'schemaVersion': 1, 'createdAt': '2026-01-01T00:00:00Z', 'characters': ['characters/gone/character.json'], 'scenarios': ['scenarios/one.json']}
    blob = _zip_raw([('manifest.json', json.dumps(manifest).encode())])
    with pytest.raises(ValueError, match='missing file'):
        parse_import('pack.byaf', blob)


def test_cai_json_character():
    obj = {"name": "シアン", "description": "案内人", "greeting": "こんにちは",
           "definition": "Stay in character.", "mystery": 1}
    docs, _assets = parse_import("cai.json", json.dumps(obj, ensure_ascii=False).encode("utf-8"))
    assert docs[0].source_format == "characterai" and docs[0].data["first_mes"] == "こんにちは"
    assert docs[0].data["definition"] == "Stay in character."
    assert any(n.path == "character.top_level" for n in docs[0].notices)


def test_cai_pasted_labels_keep_definition_verbatim():
    text = "Name: シアン\nDescription: 日本語で話す案内人\nGreeting: こんにちは\nDefinition: You are Cyan.\nSecond line.\n{{user}}: hi\n"
    docs, _assets = parse_import("paste.txt", text.encode("utf-8"))
    assert docs[0].name == "シアン"
    assert docs[0].data["definition"] == "You are Cyan.\nSecond line.\n{{user}}: hi\n"
    assert docs[0].source["pasted"] is True


def test_cai_lorebook_text_and_json():
    text = ("Lorebook Name: 図書館\nEntry Title: 鍵\nKeywords: 鍵, かぎ\nContent: 青い鍵がある\n"
            "Entry Title: 扉\nKeywords: 扉\nContent: 重い扉\n")
    docs, _assets = parse_import("book.txt", text.encode("utf-8"))
    assert docs[0].kind == "lorebook"
    assert docs[0].data["character_book"]["entries"][0]["keys"] == ["鍵", "かぎ"]
    assert docs[0].data["character_book"]["entries"][1]["content"] == "重い扉"
    obj = {"name": "Book", "entries": [{"comment": "鍵", "key": "鍵, かぎ", "content": "青い"}]}
    docs, _assets = parse_import("book.json", json.dumps(obj, ensure_ascii=False).encode("utf-8"))
    assert docs[0].kind == "lorebook"
    assert docs[0].data["character_book"]["entries"][0]["keys"] == ["鍵", "かぎ"]


def test_backup_roundtrip_keeps_histories_and_assets():
    blob, _portrait = _byaf_zip()
    docs, assets = parse_import("pack.zip", blob)
    alice = docs[0]
    payload, mime, filename, _notices = export_document(alice, "backup", assets)
    assert mime == "application/zip" and filename.endswith(".zip")
    again, assets2 = parse_import(filename, payload)
    assert again[0].name == "アリス · 森" and len(again[0].histories) == 1
    assert assets2[alice.assets[0].asset_id][0] == assets[alice.assets[0].asset_id][0]


def test_export_all_six_png_reimport_and_charx():
    docs, assets = parse_import("c.json", json.dumps(_ccv3_card()).encode("utf-8"))
    doc = docs[0]
    for fmt in ("ccv2-json", "ccv3-json", "ccv2-png", "ccv3-png", "charx", "backup"):
        payload, mime, filename, _notices = export_document(doc, fmt, assets)
        assert payload and mime and filename
        if fmt.endswith("png"):
            assert mime == "image/png"
            back, _a = parse_import(filename, payload)
            assert back[0].name == "シアン"
        if fmt == "charx":
            back, _a = parse_import(filename, payload)
            assert back[0].name == "シアン"


def test_export_jpeg_portrait_uses_neutral_fallback_with_warning():
    jpeg = _jpeg_bytes()
    docs, _a = parse_import("c.json", json.dumps(_ccv2_card()).encode("utf-8"))
    doc = docs[0].model_copy(deep=True)
    from python.core.portable_binary import validate_image
    asset_id, mime = validate_image(jpeg)
    assert mime == "image/jpeg"
    assets = {asset_id: (jpeg, mime)}
    from python.core.portable_schema import PortableAsset
    doc.assets = [PortableAsset(name="portrait", type="icon", uri="photo.jpg",
                                media_type=mime, asset_id=asset_id)]
    payload, mime_out, _name, notices = export_document(doc, "ccv3-png", assets)
    assert mime_out == "image/png"
    assert any(n["path"] == "assets.portrait" and n["status"] == "preserved" for n in notices)
    back, _a = parse_import("card.png", payload)
    assert back[0].name == "シアン"


def test_v2_export_warns_on_unrepresentable_content():
    docs, _a = parse_import("c.json", json.dumps(_ccv3_card()).encode("utf-8"))
    doc = docs[0].model_copy(deep=True)
    doc.profile.system_prompt = "sys"
    doc.histories = [{"name": "h", "messages": [{"role": "user", "content": "hi"}]}]
    _payload, _mime, _name, notices = export_document(doc, "ccv2-json", {})
    assert any(n["status"] == "converted" and "CCv2" in n["reason"] for n in notices)
    with pytest.raises(ValueError):
        export_document(doc, "nope", {})


def test_malformed_inputs_all_raise_valueerror(monkeypatch):
    with pytest.raises(ValueError):
        parse_import("empty.json", b"")
    with pytest.raises(ValueError):
        parse_import("bad.json", b"{oops")
    with pytest.raises(ValueError):
        parse_import("bin.bin", b"\x00\x01\x02\xff\xfe")
    with pytest.raises(ValueError):
        parse_import("weird.json", json.dumps({"zzz": 1}).encode("utf-8"))
    with pytest.raises(ValueError):
        parse_import("noname.json", json.dumps({"description": "x"}).encode("utf-8"))
    monkeypatch.setattr(formats, "MAX_UPLOAD_BYTES", 10)
    with pytest.raises(ValueError):
        parse_import("big.json", json.dumps(_ccv2_card()).encode("utf-8"))


def test_creator_notes_never_become_prompt_text():
    docs, _a = parse_import("c.json", json.dumps(_ccv2_card()).encode("utf-8"))
    from python.core.portable_prompt import compile_portable
    compiled = compile_portable({"document": docs[0].model_dump()})
    joined = "\n".join(m.get("content", "") for m in compiled.ordered_messages)
    assert "CREATOR_ONLY" not in joined
    assert docs[0].data["creator_notes"] == "CREATOR_ONLY"


def test_kyalulu_profile_roundtrip_through_ccv3():
    docs, _a = parse_import("c.json", json.dumps(_ccv2_card()).encode("utf-8"))
    doc = docs[0].model_copy(deep=True)
    doc.speaking_style = "簡潔"
    doc.nsfw = True
    doc.profile.system_prompt = "ORIGINAL"
    payload, _mime, _name, _n = export_document(doc, "ccv3-json", {})
    back, _a = parse_import("re.json", payload)
    assert back[0].speaking_style == "簡潔" and back[0].nsfw is True
    assert back[0].profile.system_prompt == "ORIGINAL"
