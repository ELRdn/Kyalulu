"""M6 自動メトリクス — 文字数 / repetition / 失敗率 など

Research Mode の簡易自動メトリクス。human rating とは分離して集計する。
将来 embedding 類似度等に置換する際は repetition_score の内部だけ差し替え。
"""
from __future__ import annotations
import re
import unicodedata
from collections import Counter

def _normalize(s: str) -> str:
    if not s:
        return ""
    # NFKC + 小文字化（日本語はそのまま）
    s = unicodedata.normalize("NFKC", s)
    return s.strip()

def _ngrams(tokens: list[str], n: int) -> list[tuple[str, ...]]:
    if len(tokens) < n:
        return []
    return [tuple(tokens[i:i+n]) for i in range(len(tokens)-n+1)]

def _tokenize_for_repetition(text: str) -> list[str]:
    """簡易トークン化: 空白と句読点で区切る。日本語は文字単位に近い"""
    t = _normalize(text)
    # 句読点を空白に
    t = re.sub(r"[。、，、！？!?「」『』（）\(\)\[\]…ー―\-—\s]+", " ", t)
    parts = [p for p in t.split(" ") if p]
    # 日本語長文対策: 2文字以上のかたまりは文字単位にも分解して n-gram を取りやすく
    tokens: list[str] = []
    for p in parts:
        if len(p) > 8 and re.search(r"[\u3040-\u9fff]", p):
            tokens.extend(list(p))
        else:
            tokens.append(p)
    return tokens

def _repetition_score(texts: list[str]) -> float | None:
    """全ターンの assistant テキストから repetition を 0..1 で算出。高いほど反復が多い。
    5ターン未満は None（参考値にならないため）
    仕様: trigram の重複率 + 同一文頭パターンの補正
    """
    if len(texts) < 5:
        return None
    all_tokens: list[str] = []
    for t in texts:
        all_tokens.extend(_tokenize_for_repetition(t))
    if len(all_tokens) < 10:
        return None
    # trigram 重複率
    trigrams = _ngrams(all_tokens, 3)
    if not trigrams:
        return None
    cnt = Counter(trigrams)
    repeated = sum(c - 1 for c in cnt.values() if c > 1)
    trigram_dup_rate = repeated / max(1, len(trigrams))
    # 同一文頭（先頭10文字）の重複も見る
    heads = [_normalize(t)[:10] for t in texts if _normalize(t)]
    h_cnt = Counter(heads)
    head_dup = sum(c - 1 for c in h_cnt.values() if c > 1) / max(1, len(texts))
    # 重み付け平均 0..1
    score = min(1.0, trigram_dup_rate * 0.7 + head_dup * 0.3)
    # 小数3桁に丸め
    return round(score, 3)

def compute_metrics(turns: list[dict]) -> dict:
    """turns: experiment の turns リスト（各要素に assistant, elapsed_ms を含む想定）
    戻り: { char_count, avg_chars, max_chars, repetition_score, failure_rate, empty_rate, avg_elapsed_ms, turn_count }
    """
    if not turns:
        return {
            "turn_count": 0,
            "char_count": 0,
            "avg_chars": 0,
            "max_chars": 0,
            "repetition_score": None,
            "failure_rate": 0.0,
            "empty_rate": 0.0,
            "avg_elapsed_ms": None,
        }
    assistants = [str(t.get("assistant") or "") for t in turns]
    char_counts = [len(a) for a in assistants]
    total = sum(char_counts)
    avg = round(total / max(1, len(assistants)), 1)
    mx = max(char_counts) if char_counts else 0

    failures = sum(1 for a in assistants if "[error:" in a)
    empties = sum(1 for a in assistants if not a.strip())
    n = len(assistants)
    failure_rate = round(failures / n, 3) if n else 0.0
    empty_rate = round(empties / n, 3) if n else 0.0

    rep = _repetition_score(assistants)

    elapsed_vals = [t.get("elapsed_ms") for t in turns if isinstance(t.get("elapsed_ms"), (int, float))]
    avg_elapsed = round(sum(elapsed_vals) / len(elapsed_vals), 1) if elapsed_vals else None

    return {
        "turn_count": n,
        "char_count": total,
        "avg_chars": avg,
        "max_chars": mx,
        "repetition_score": rep,
        "failure_rate": failure_rate,
        "empty_rate": empty_rate,
        "avg_elapsed_ms": avg_elapsed,
    }

def recompute_for_experiment_dir(exp_dir) -> dict | None:
    """experiments/<id>/ から turns.json を読んで metrics を再計算して返す（保存はしない）"""
    import pathlib, json
    p = pathlib.Path(exp_dir)
    tj = p / "turns.json"
    if not tj.exists():
        tj = p / "turns.jsonl"
        if not tj.exists():
            return None
        # jsonl 読み
        turns = []
        for line in tj.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    turns.append(json.loads(line))
                except Exception:
                    continue
    else:
        try:
            turns = json.loads(tj.read_text(encoding="utf-8"))
        except Exception:
            return None
    return compute_metrics(turns)
