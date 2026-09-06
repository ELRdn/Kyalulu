"""Deterministic portable prompt rendering and per-turn Lore selection."""
from __future__ import annotations
import re
from copy import deepcopy
from .schemas import CompiledPrompt
from .portable_schema import PortableDocument

VERSION = 'prompt:portable@1.0.0'
SAMPLERS = {'temperature', 'top_p', 'top_k', 'min_p', 'repeat_penalty', 'repeat_last_n',
            'frequency_penalty', 'presence_penalty', 'seed', 'max_tokens', 'stop'}


def estimate(text):
    return max(0, int(len(text) / 1.5))


def unsupported_lore_condition(entry):
    return (entry.get('use_regex') or entry.get('useRegex')
        or any(entry.get(k) for k in ('useProbability', 'delay', 'cooldown', 'sticky',
            'timeConditions', 'time_conditions', 'matchWholeWords', 'excludeRecursion',
            'preventRecursion', 'delayUntilRecursion', 'group'))
        or entry.get('selectiveLogic', 0) not in (0, None)
        or entry.get('position', 'after_char') not in ('before_char', 'after_char')
        or any(re.match(r'^/.+/[a-z]*$', str(k)) for k in entry.get('keys', [])))


def select_lore(books, history, render=lambda value: value):
    selected, audit = [], []
    for book_index, book in enumerate(books):
        if not isinstance(book, dict):
            continue
        entries = book.get('entries', [])
        if isinstance(entries, dict):
            entries = list(entries.values())
        depth = max(0, min(1000, int(book.get('scan_depth', 2) or 0)))
        budget = max(0, int(book.get('token_budget', 1024) or 0))
        remaining = budget
        text = '\n'.join(str(m.get('content', '')) for m in history[-depth:]) if depth else ''
        pending = sorted(enumerate(entries), key=lambda p: (-int(p[1].get('priority', 0) or 0), int(p[1].get('insertion_order', p[0]) or 0), p[0]))
        visited = set()
        while True:
            changed = False
            additions = []
            for idx, entry in pending:
                if idx in visited:
                    continue
                reason = None
                if not entry.get('enabled', True):
                    reason = 'disabled'
                elif unsupported_lore_condition(entry):
                    reason = 'unsupported condition'
                if reason:
                    audit.append({'book': book_index, 'entry': idx, 'selected': False, 'reason': reason})
                    visited.add(idx)
                    continue
                haystack = text if entry.get('case_sensitive') else text.casefold()
                def matches(keys):
                    return any(str(k) and (str(k) if entry.get('case_sensitive') else str(k).casefold()) in haystack for k in keys)
                active = entry.get('constant', False) or matches(entry.get('keys', entry.get('key', [])))
                if entry.get('selective') and not entry.get('constant'):
                    active = active and matches(entry.get('secondary_keys', entry.get('keysecondary', [])))
                if not active:
                    continue
                visited.add(idx)
                content = render(str(entry.get('content', '')))
                size = estimate(content)
                fits = size <= remaining
                audit.append({'book': book_index, 'entry': idx, 'selected': fits, 'estimated_tokens': size,
                              'reason': 'constant' if fits and entry.get('constant') else 'keyword' if fits else 'budget exceeded'})
                if fits:
                    remaining -= size
                    selected.append({**entry, 'content': content, '_book': book_index, '_entry': idx})
                    additions.append(content)
                    changed = True
            if not changed or not book.get('recursive_scanning', False):
                break
            text += '\n' + '\n'.join(additions)
        for idx, _ in pending:
            if idx not in visited:
                audit.append({'book': book_index, 'entry': idx, 'selected': False, 'reason': 'no keyword match'})
    selected.sort(key=lambda e: (int(e.get('insertion_order', 0) or 0), e['_book'], e['_entry']))
    return selected, audit


def compile_portable(snapshot, history=None):
    doc = PortableDocument.model_validate(snapshot['document'])
    data, profile = doc.data, doc.profile
    persona, world = snapshot.get('persona') or {}, snapshot.get('world') or {}
    notices = [n.model_dump() for n in doc.notices]
    settings = {k: v for k, v in profile.settings.items() if k in SAMPLERS}
    for key in profile.settings.keys() - SAMPLERS:
        notices.append({'path': 'profile.settings.' + key, 'status': 'preserved', 'reason': 'Not a supported generation setting'})
    macro_values = {
        'char': data.get('nickname') or doc.name, 'user': persona.get('display_name') or 'User',
        'description': data.get('description', ''), 'personality': data.get('personality', ''),
        'scenario': data.get('scenario', ''), 'persona': persona.get('description', '') + '\n' + persona.get('traits', ''),
        'mesExamplesRaw': data.get('mes_example', ''), 'mesExamples': data.get('mes_example', ''),
        'anchorBefore': '', 'anchorAfter': '', 'trim': '',
    }
    unknown = set()
    def expand(value, original=''):
        values = {**macro_values, 'original': original}
        def replace(match):
            key = match.group(1).strip()
            if key in values:
                return str(values[key])
            if key.startswith('getvar::') and key[8:] in profile.variables:
                return profile.variables[key[8:]]
            unknown.add(key)
            return match.group(0)
        text = str(value or '')
        for _ in range(3):
            rendered = re.sub(r'\{\{\s*([^{}]+?)\s*\}\}', replace, text)
            if rendered == text:
                break
            text = rendered
        return text

    books = [data.get('character_book', {}), data.get('attached_profile_lore', {})] + snapshot.get('lorebooks', [])
    lore, audit = select_lore(books, history or [], render=expand)
    before = '\n\n'.join(expand(e['content']) for e in lore if e.get('position') == 'before_char')
    after = '\n\n'.join(expand(e['content']) for e in lore if e.get('position') != 'before_char')
    macro_values.update(loreBefore=before, wiBefore=before, loreAfter=after, wiAfter=after)
    def global_prompt(identifier):
        return next((p.get('content', '') for p in profile.prompts if p.get('identifier') == identifier and p.get('enabled', True)), '')
    original = snapshot.get('extra_system_prompt') or profile.system_prompt or global_prompt('main') or 'Write the next reply as {{char}}, respecting the character and conversation.'
    main = expand(data.get('system_prompt') or original, original=original)
    original_post = profile.post_history_instructions or global_prompt('jailbreak')
    post = expand(data.get('post_history_instructions') or original_post, original=original_post)
    macro_values['system'] = main

    examples = []
    raw_examples = expand(data.get('mes_example', ''))
    speakers = {str(macro_values['char']): 'assistant', str(macro_values['user']): 'user'}
    for block in re.split(r'<START>', raw_examples):
        current = None
        parsed = []
        for line in block.strip().splitlines():
            match = re.match(r'^([^:\n]+):\s?(.*)$', line)
            if match and match.group(1) in speakers:
                current = {'role': speakers[match.group(1)], 'content': match.group(2)}
                parsed.append(current)
            elif current is not None:
                current['content'] += '\n' + line
            elif line.strip():
                parsed = []
                break
        examples.extend(parsed if parsed else ([{'role': 'system', 'content': block.strip()}] if block.strip() else []))

    def msg(content, role='system'):
        return [{'role': role, 'content': expand(content)}] if content else []
    parts = {
        'main': msg(main), 'worldInfoBefore': msg(before),
        'charDescription': msg(data.get('description', '')) + msg(data.get('definition', '')) + msg(doc.speaking_style),
        'charPersonality': msg(data.get('personality', '')), 'scenario': msg(data.get('scenario', '')),
        'personaDescription': msg(macro_values['persona'].strip()), 'dialogueExamples': examples,
        'worldInfoAfter': msg(after), 'chatHistory': [{'role': 'system', 'content': '', 'slot': 'history'}],
        'jailbreak': msg(post),
    }
    ordered = []
    if profile.prompts:
        for prompt in profile.prompts:
            if not prompt.get('enabled', True):
                continue
            identifier = prompt.get('identifier', '')
            if prompt.get('injection_position', 0) not in (0, None):
                notices.append({'path': f'profile.prompts.{identifier}', 'status': 'preserved', 'reason': 'In-chat depth injection is not supported'})
                continue
            if identifier in ('main', 'jailbreak'):
                # Card overrides take priority over the global prompt profile.
                content = main if identifier == 'main' else post
                ordered += msg(content, prompt.get('role', 'system'))
            elif identifier in parts and prompt.get('marker', True):
                ordered += parts[identifier]
            else:
                role = prompt.get('role', 'system')
                if role not in {'system', 'user', 'assistant'}:
                    notices.append({'path': f'profile.prompts.{identifier}', 'status': 'preserved', 'reason': 'Unsupported message role'})
                else:
                    ordered += msg(prompt.get('content', ''), role)
        if not any(p.get('slot') == 'history' for p in ordered):
            ordered += parts['chatHistory']
    elif profile.context_template:
        # Deliberately do not apply model-specific Instruct wrapping a second time.
        ordered = msg(expand(profile.context_template))
        if '{{mesExamples' not in profile.context_template:
            ordered += examples
        ordered += parts['chatHistory'] + parts['jailbreak']
    else:
        for key in ('main', 'worldInfoBefore', 'charDescription', 'charPersonality', 'scenario', 'personaDescription', 'worldInfoAfter', 'dialogueExamples', 'chatHistory', 'jailbreak'):
            ordered += parts[key]
    if world:
        ordered = msg(world.get('rules') or world.get('description', '')) + ordered
    for key in sorted(unknown):
        notices.append({'path': 'macro.' + key, 'status': 'preserved', 'reason': 'Unsupported macro retained verbatim'})
    system = '\n\n'.join(p['content'] for p in ordered if p['role'] == 'system' and not p.get('slot'))
    return CompiledPrompt(system_prompt=system, ordered_messages=ordered, prompt_version=VERSION,
        character_version=snapshot.get('character_version'), token_estimate=sum(estimate(p['content']) for p in ordered),
        sections={'portable_snapshot': deepcopy(snapshot), 'lore': audit, 'compatibility': notices,
                  'generation_settings': settings, 'estimated': True})


def assemble_messages(compiled, history, contract):
    if not compiled.ordered_messages:
        return [{'role': 'system', 'content': compiled.system_prompt + contract}] + [dict(m) for m in history if m['role'] != 'system']
    result = [{'role': 'system', 'content': contract}]
    for part in compiled.ordered_messages:
        if part.get('slot') == 'history':
            result.extend({'role': m['role'], 'content': m['content']} for m in history if m['role'] in {'user', 'assistant'})
        else:
            result.append({'role': part['role'], 'content': part['content']})
    return result
