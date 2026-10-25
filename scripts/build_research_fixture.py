"""Small shared references for browser metrics and memory-probe semantics."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from python.core.metrics import compute_metrics
from python.core.memory import probe, summarize


def fixture():
    cases = [[], [{'assistant': '🌸日本語', 'elapsed_ms': 1.25}],
             [{'assistant': '同じ日本語の長い文章を何度も繰り返す。', 'elapsed_ms': n + .25,
               'status': 'failed' if n == 2 else 'completed', 'telemetry': {'first_reply_ms': n, 'tokens_per_second': n / 2},
               'validation': {'ok': n != 2, 'retries': n % 2}, 'token_budget': {'total_prompt_tokens': n + 10}} for n in range(6)],
             [{'assistant': ''}, {'assistant': '[error: failed]'}, {'assistant': 'OK'}]]
    probes = []
    for expect, forbid, reply, context, stored, trace in [
        (['紅茶'], [], '紅茶が好き', '', [], None),
        (['紅茶'], [], '分からない', '', [], None),
        (['紅茶'], [], '分からない', '紅茶が好き', [], None),
        (['紅茶'], [], '分からない', '', [{'content': '紅茶が好き'}], {'candidates': []}),
        (['紅茶'], [], '分からない', '', [], {'candidates': [{'content': '紅茶が好き', 'decision': 'recent_fill'}]}),
        ([], ['宇宙飛行士'], '宇宙飛行士だったね', '', [], None),
        (['カフェ'], [], '分からない', '', [], {'candidates': []}),
    ]:
        args = dict(expect=expect, forbid=forbid, reply=reply, context=context, stored=stored, trace=trace)
        probes.append({'input': args, 'expected': probe(**args)})
    summary_turns = [{'probe': row['expected']} for row in probes] + [
        {'memory': {'injected_tokens': 10, 'retrieval_ms': 1.25, 'decisions': [{'action': 'store', 'supported': False}, {'action': 'skip'}]}}]
    return {'metrics': [{'turns': turns, 'expected': compute_metrics(turns)} for turns in cases],
            'probes': probes, 'summary': {'turns': summary_turns, 'expected': summarize(summary_turns)},
            'rounding': [{'value': n, 'digits': d, 'expected': round(n, d)} for n in [1.25, 2.675, .125, -.125, 123.455] for d in [0, 1, 2, 3]]}


if __name__ == '__main__':
    (ROOT / 'tests/fixtures/device-research.json').write_text(json.dumps(fixture(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
