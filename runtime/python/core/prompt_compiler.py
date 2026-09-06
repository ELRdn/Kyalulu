"""Prompt Compiler — M3 最小実装

Character / Persona / World / 追加system_prompt を束ねて最終system_promptを生成。
PROJECT_SPEC.md 10章「PromptはCharacterと分離」を満たす。
"""

from __future__ import annotations
import pathlib
import yaml
from typing import Any
from .schemas import CompiledPrompt

PROMPT_VERSION = "prompt:character-runtime@0.1.3"

ROOT = pathlib.Path(__file__).resolve().parents[3]
CHAR_DIR = ROOT / "characters"
PERSONA_DIR = ROOT / "personas"
WORLD_DIR = ROOT / "worlds"
TEMPLATE_PATH = ROOT / "prompts" / "kyalulu_base.md"
SKILL_PATH = ROOT / "prompts" / "Zeta-style-skill.md"  # 旧単一ファイル（互換）
SKILL_SFW_PATH = ROOT / "prompts" / "Zeta-style-skill_SFW.md"
SKILL_NSFW_PATH = ROOT / "prompts" / "Zeta-style-skill_NSFW.md"

def _load_yaml(dir_path: pathlib.Path, id_: str) -> dict[str, Any] | None:
    if dir_path == CHAR_DIR and id_ and id_.startswith('lib_'):
        from python.storage.library import get_item, character_info
        item = get_item(id_)
        return character_info(item) if item and item.document.kind == 'character' else None
    if not id_ or not dir_path.exists():
        return None
    p = dir_path / f"{id_}.yaml"
    if not p.exists():
        # idがファイル名と異なる場合も探索
        for f in dir_path.glob("*.yaml"):
            try:
                data = yaml.safe_load(f.read_text(encoding="utf-8"))
                if isinstance(data, dict) and data.get("id") == id_:
                    return data
            except Exception:
                continue
        return None
    try:
        return yaml.safe_load(p.read_text(encoding="utf-8"))
    except Exception:
        return None

def _estimate_tokens(text: str) -> int:
    # 超簡易: 1.5文字 ≒ 1 token として概算
    return max(1, int(len(text) / 1.5))

def _resolve_placeholder(key: str, char: dict | None, persona: dict | None, world: dict | None) -> str:
    k = key.strip()
    lk = k.lower()
    # ハーレム用インデックス付き (@CHARA1, @CHARA2, @CHAR1 等) は一旦独立ラベルとして保持
    # 単一キャラ時は CHARA1 → 今のキャラ名、CHARA2以降は仮ラベルで区別を保持（後で複数キャラ対応時に本名に置換）
    import re as _re2
    m_idx = _re2.match(r"^(char|chara)(\d+)$", lk)
    if m_idx:
        num = m_idx.group(2)
        if num == "1":
            return (char or {}).get("display_name", "") or (char or {}).get("id", "") or f"CHARA{num}"
        else:
            # 2人目以降はまだ単一キャラなので仮ラベルで区別（将来ハーレムYAMLで本名に差し替え）
            return f"CHARA{num}"
    # エイリアス
    if lk in ("char", "chara", "char.display_name", "chara.display_name"):
        return (char or {}).get("display_name", "") or (char or {}).get("id", "") or ""
    if lk in ("user",):
        # personaの表示名、なければ USER
        return (persona or {}).get("display_name", "") or "USER"
    # char.*
    if lk.startswith("char."):
        field = k.split(".", 1)[1]
        # 大文字小文字無視で取得
        for fk, fv in (char or {}).items():
            if fk.lower() == field.lower():
                return str(fv) if fv is not None else ""
        return ""
    if lk.startswith("chara."):
        field = k.split(".", 1)[1]
        for fk, fv in (char or {}).items():
            if fk.lower() == field.lower():
                return str(fv) if fv is not None else ""
        return ""
    if lk.startswith("persona."):
        field = k.split(".", 1)[1]
        for fk, fv in (persona or {}).items():
            if fk.lower() == field.lower():
                return str(fv) if fv is not None else ""
        return ""
    if lk.startswith("user."):
        # user.* は persona.* のエイリアス
        field = k.split(".", 1)[1]
        for fk, fv in (persona or {}).items():
            if fk.lower() == field.lower():
                return str(fv) if fv is not None else ""
        return ""
    if lk.startswith("world."):
        field = k.split(".", 1)[1]
        for fk, fv in (world or {}).items():
            if fk.lower() == field.lower():
                return str(fv) if fv is not None else ""
        return ""
    # fallback: そのまま空
    return ""

def _render_template(template: str, char: dict | None, persona: dict | None, world: dict | None) -> str:
    import re
    def repl(m):
        key = m.group(1)
        return _resolve_placeholder(key, char, persona, world)
    # @NARRATOR / @USER / @CHARA / @CHAR も {{}} のエイリアスとして解決（複数キャラ例でも使いやすい）
    def at_repl(m):
        key = m.group(1)
        # @NARRATOR はそのままラベルとして残すが、{{}}同様に解決（現在はNARRATOR固定）
        if key.lower() == "narrator":
            return "NARRATOR"
        return _resolve_placeholder(key, char, persona, world)
    out = re.sub(r"@([A-Za-z_][A-Za-z0-9_.]*)", at_repl, template)
    out = re.sub(r"\{\{\s*([^}]+?)\s*\}\}", repl, out)
    if "{{" in out or "@" in out:
        out = re.sub(r"@([A-Za-z_][A-Za-z0-9_.]*)", at_repl, out)
        out = re.sub(r"\{\{\s*([^}]+?)\s*\}\}", repl, out)
    return out

def _get_skill_contents(char: dict | None) -> list[tuple[str, str]]:
    """SFW/NSFW分割に対応。戻りは [(name, content), ...] 順に追記する"""
    out: list[tuple[str, str]] = []
    # 新方式（SFW/NSFW分割）があれば優先
    has_sfw = SKILL_SFW_PATH.exists()
    has_nsfw = SKILL_NSFW_PATH.exists()
    if has_sfw or has_nsfw:
        is_nsfw = bool(char and char.get("nsfw"))
        if has_sfw:
            try:
                c = SKILL_SFW_PATH.read_text(encoding="utf-8").strip()
                if c:
                    out.append((SKILL_SFW_PATH.name, c))
            except Exception as e:
                print(f"[compiler] skill SFW load failed: {e}")
        if is_nsfw and has_nsfw:
            try:
                c = SKILL_NSFW_PATH.read_text(encoding="utf-8").strip()
                if c:
                    out.append((SKILL_NSFW_PATH.name, c))
            except Exception as e:
                print(f"[compiler] skill NSFW load failed: {e}")
        return out
    # 旧単一ファイル互換
    if SKILL_PATH.exists():
        try:
            c = SKILL_PATH.read_text(encoding="utf-8").strip()
            if c:
                out.append((SKILL_PATH.name, c))
        except Exception as e:
            print(f"[compiler] skill load failed: {e}")
    return out

def _portable_snapshot(character_id, persona_id, world_id, extra_system_prompt, binding=None):
    from python.storage.library import get_item
    from .portable_schema import PortableDocument
    binding = binding or {}
    ref = binding.get('character')
    item = get_item(ref['id'], ref['revision']) if ref else get_item(character_id) if character_id and character_id.startswith('lib_') else None
    if character_id and character_id.startswith('lib_') and not item:
        raise ValueError('portable character revision not found')
    if not item and not binding.get('profile') and not binding.get('lorebooks'):
        return None
    if item:
        if item.document.kind != 'character' or item.id != character_id:
            raise ValueError('invalid character binding')
        doc = item.document.model_copy(deep=True)
        revision = f'1.0.{item.revision}'
    else:
        native = _load_yaml(CHAR_DIR, character_id) or {}
        doc = PortableDocument(name=native.get('display_name') or 'Assistant', data={
            'description': native.get('description', ''), 'personality': native.get('personality', ''),
            'first_mes': native.get('intro', '')}, speaking_style=native.get('speaking_style', ''), nsfw=bool(native.get('nsfw')))
        revision = native.get('version')
    lorebooks = []
    if binding.get('profile'):
        profile = get_item(**{'item_id': binding['profile']['id'], 'revision': binding['profile']['revision']})
        if not profile or profile.document.kind != 'profile':
            raise ValueError('profile revision not found')
        doc.profile = profile.document.profile.model_copy(deep=True)
        doc.nsfw = doc.nsfw or profile.document.nsfw
        doc.notices.extend(profile.document.notices)
        if profile.document.data.get('character_book'):
            lorebooks.append(profile.document.data['character_book'])
    for ref in binding.get('lorebooks', []):
        lore = get_item(ref['id'], ref['revision'])
        if not lore or lore.document.kind != 'lorebook':
            raise ValueError('lorebook revision not found')
        lorebooks.append(lore.document.data.get('character_book', {}))
        doc.nsfw = doc.nsfw or lore.document.nsfw
        doc.notices.extend(lore.document.notices)
    return {'document': doc.model_dump(), 'character_version': revision, 'library_binding': binding,
            'lorebooks': lorebooks, 'persona': _load_yaml(PERSONA_DIR, persona_id),
            'world': _load_yaml(WORLD_DIR, world_id), 'extra_system_prompt': extra_system_prompt}


def compile_prompt(
    character_id: str | None = None,
    persona_id: str | None = None,
    world_id: str | None = None,
    extra_system_prompt: str | None = None,
    library_binding: dict | None = None,
) -> CompiledPrompt:
    """
    優先順位: World rules → Character personality/speaking_style → Persona traits → extra_system_prompt
    extra_system_prompt はユーザーが直書きした system_prompt（プリセット等）。あれば末尾に追記。
    新: prompts/kyalulu_base.md があればテンプレを {{char}}/{{user}} でレンダリング（全キャラ対応）。
    """
    portable = _portable_snapshot(character_id, persona_id, world_id, extra_system_prompt, library_binding)
    if portable:
        from .portable_prompt import compile_portable
        return compile_portable(portable)
    sections: dict[str, str] = {}
    char = _load_yaml(CHAR_DIR, character_id) if character_id else None
    persona = _load_yaml(PERSONA_DIR, persona_id) if persona_id else None
    world = _load_yaml(WORLD_DIR, world_id) if world_id else None

    # テンプレがあればそちらを優先（全キャラ対応の {{char}}/{{user}} 関数）
    if TEMPLATE_PATH.exists() and (char or persona or world):
        try:
            tmpl = TEMPLATE_PATH.read_text(encoding="utf-8")
            rendered = _render_template(tmpl, char, persona, world)
            # Zeta-style skill は必ずトーク開始時に自動読み込み（SFWは常時、NSFWはnsfwキャラのみ追加）
            for name, content in _get_skill_contents(char):
                rendered = rendered.rstrip() + f"\n\n---\n\n{content}"
                # 複数ある場合はカンマ区切りで記録
                prev = sections.get("skill")
                sections["skill"] = f"{prev},{name}" if prev else name
            # extra_system_prompt は末尾に追記
            if extra_system_prompt and extra_system_prompt.strip():
                rendered = rendered.rstrip() + f"\n\n---\n\n# Additional Instructions\n{extra_system_prompt.strip()}"
                sections["extra"] = extra_system_prompt.strip()
            sections["template"] = TEMPLATE_PATH.name
            sections["rendered"] = rendered[:2000]  # デバッグ用先頭
            # M7: token内訳（概算）— デバッグ Drawer で表示
            try:
                import json as _json
                breakdown = {
                    "template": _estimate_tokens(tmpl),
                    "total": _estimate_tokens(rendered),
                }
                if char:
                    breakdown["character"] = _estimate_tokens(char.get("personality","")+char.get("speaking_style",""))
                if world:
                    breakdown["world"] = _estimate_tokens(world.get("rules","")+world.get("description",""))
                if persona:
                    breakdown["persona"] = _estimate_tokens(persona.get("traits","")+persona.get("description",""))
                sections["token_breakdown"] = _json.dumps(breakdown, ensure_ascii=False)
            except Exception:
                pass
            return CompiledPrompt(
                system_prompt=rendered,
                prompt_version=PROMPT_VERSION,
                character_version=char.get("version") if char else None,
                persona_version=persona.get("version") if persona else None,
                world_version=world.get("version") if world else None,
                token_estimate=_estimate_tokens(rendered),
                sections=sections,
            )
        except Exception as e:
            print(f"[compiler] template render failed: {e}, fallback to legacy")

    parts: list[str] = []

    if world:
        w = world.get("rules") or world.get("description") or ""
        if w:
            parts.append(f"# World: {world.get('display_name', world_id)}\n{w.strip()}")
            sections["world"] = w.strip()
    if char:
        # personality + speaking_style + description を束ねる
        c_parts = []
        if char.get("description"):
            c_parts.append(char["description"].strip())
        if char.get("personality"):
            c_parts.append(char["personality"].strip())
        if char.get("speaking_style"):
            c_parts.append(f"【口調】\n{char['speaking_style'].strip()}")
        c_text = "\n\n".join(c_parts)
        if c_text:
            parts.append(f"# Character: {char.get('display_name', character_id)}\n{c_text}")
            sections["character"] = c_text
    if persona:
        p_text = persona.get("traits") or persona.get("description") or ""
        if p_text:
            parts.append(f"# Persona (USER): {persona.get('display_name', persona_id)}\n{p_text.strip()}")
            sections["persona"] = p_text.strip()
    if extra_system_prompt and extra_system_prompt.strip():
        parts.append(f"# Additional Instructions\n{extra_system_prompt.strip()}")
        sections["extra"] = extra_system_prompt.strip()

    # Zeta-style skill はレガシー経路でも自動追記（SFW常時、NSFWはnsfwキャラのみ）
    for name, content in _get_skill_contents(char):
        parts.append(content)
        prev = sections.get("skill")
        sections["skill"] = f"{prev},{name}" if prev else name

    # フォールバック: 全て空なら汎用アシスタント
    if not parts:
        parts.append("あなたは親切なAIアシスタントです。")
        sections["fallback"] = parts[0]

    # 共通フッター（出力形式）
    parts.append("必ずmarkdown形式で回答してください。")
    sections["footer"] = "必ずmarkdown形式で回答してください。"

    system_prompt = "\n\n---\n\n".join(parts)
    return CompiledPrompt(
        system_prompt=system_prompt,
        prompt_version=PROMPT_VERSION,
        character_version=char.get("version") if char else None,
        persona_version=persona.get("version") if persona else None,
        world_version=world.get("version") if world else None,
        token_estimate=_estimate_tokens(system_prompt),
        sections=sections,
    )

def list_available(dir_path: pathlib.Path) -> list[dict[str, Any]]:
    if not dir_path.exists():
        return []
    out = []
    for f in sorted(dir_path.glob("*.yaml")):
        try:
            data = yaml.safe_load(f.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("id"):
                out.append(data)
        except Exception as e:
            print(f"[compiler] failed to load {f}: {e}")
    return out
