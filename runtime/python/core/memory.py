"""Memory Lab v1 — retrieval, proposal validation and evidence (pure logic, no storage).

Three memory types (PROJECT_SPEC 64): semantic (facts / preferences), episodic
(events that happened), relationship (how the two relate). The model PROPOSES
memories in its structured output; the runtime validates and stores them
(66). Retrieval is a deterministic lexical ranker over character bigrams so
that runs are reproducible and a Memory on/off comparison isolates the memory
system from sampling noise. `importance` is kept in the schema but not used
(67); nothing is forgotten (68).

The inspector vocabulary follows 69: Stored → Retrieved (ranked candidates)
→ Injected (placed in the prompt within the budget) → Evidenced (the reply
shares enough content with the memory; an inference, not proof).
"""
from __future__ import annotations

import math
import re
import unicodedata
from typing import Literal
from functools import lru_cache

from pydantic import BaseModel, ConfigDict, Field

MemoryType = Literal["semantic", "episodic", "relationship"]
MEMORY_TYPES = ("semantic", "episodic", "relationship")
MAX_CONTENT = 200
MAX_PROPOSALS = 3
DEFAULT_TOP_K = 5
DEFAULT_BUDGET_TOKENS = 300
MIN_SCORE = 0.12
# Relationship memories describe the whole relationship, so they compete even
# without lexical overlap with the current message.
RELATIONSHIP_PRIOR = 0.2
DUPLICATE_OVERLAP = 0.8
EVIDENCE_OVERLAP = 0.3

_STRIP = re.compile(r"[\s\W_]+", re.UNICODE)


class MemoryProposal(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: MemoryType
    content: str = Field(min_length=1, max_length=MAX_CONTENT)


def normalize(text: str) -> str:
    return _STRIP.sub("", unicodedata.normalize("NFKC", text or "").lower())


@lru_cache(maxsize=4096)
def bigrams(text: str) -> frozenset[str]:
    t = normalize(text)
    if len(t) < 2:
        return frozenset([t]) if t else frozenset()
    return frozenset(t[i:i + 2] for i in range(len(t) - 1))


def estimate_tokens(text: str) -> int:
    # Same spirit as the prompt compiler's estimate: ~1 token per 2 CJK chars / 4 latin chars.
    cjk = sum(1 for c in text if ord(c) > 0x2E80)
    return max(1, math.ceil(cjk / 1.5 + (len(text) - cjk) / 4))


def overlap(a: set[str], b: set[str]) -> float:
    """Share of `b` found in `a`."""
    return len(a & b) / len(b) if b else 0.0


def score(query: set[str], memory: dict) -> float:
    grams = bigrams(memory["content"])
    if not grams:
        return 0.0
    # Overlap normalized by memory size so long memories do not win by length.
    s = len(query & grams) / math.sqrt(len(grams))
    s = min(1.0, s / 2)
    if memory["type"] == "relationship":
        s = max(s, RELATIONSHIP_PRIOR)
    return round(s, 4)


INJECTED = ("injected", "recent_fill")


def retrieve(memories: list[dict], query: str, *, top_k: int = DEFAULT_TOP_K,
             budget_tokens: int = DEFAULT_BUDGET_TOKENS, min_score: float = MIN_SCORE,
             fill_recent: bool = True) -> dict:
    """Rank all active memories (oldest first in `memories`) for `query`.

    Relevance first: candidates at or above `min_score`, within `top_k` and the token budget.
    With `fill_recent`, slots left over go to the newest remaining memories (decision
    ``recent_fill``), so a small store is not lost to wording differences; experiments can turn it
    off to measure pure relevance retrieval. Returns every candidate with its score and decision.
    """
    q = bigrams(query)
    ranked = sorted(({"id": m["id"], "type": m["type"], "content": m["content"], "score": score(q, m),
                      "recency": i, "version": m.get("version"), "supported": m.get("supported"),
                      "source_session_id": m.get("source_session_id"), "source_turn": m.get("source_turn"),
                      "created_at": m.get("created_at"), "updated_at": m.get("updated_at"),
                      "origin": m.get("origin")} for i, m in enumerate(memories)), key=lambda c: (-c["score"], c["recency"]))
    used = 0
    injected: list[dict] = []
    for c in ranked:
        tokens = estimate_tokens(c["content"]) + 4
        if c["supported"] is False and c["origin"] == "model":
            c["decision"] = "unverified"
        elif c["score"] < min_score:
            c["decision"] = "below_threshold"
        elif len(injected) >= top_k:
            c["decision"] = "over_top_k"
        elif used + tokens > budget_tokens:
            c["decision"] = "over_budget"
        else:
            c["decision"] = "injected"
            used += tokens
            injected.append(c)
    if fill_recent:
        for c in sorted((c for c in ranked if c["decision"] == "below_threshold"), key=lambda c: -c["recency"]):
            tokens = estimate_tokens(c["content"]) + 4
            if len(injected) >= top_k or used + tokens > budget_tokens:
                continue
            c["decision"] = "recent_fill"
            used += tokens
            injected.append(c)
    return {"query": query, "candidates": ranked, "injected": [c["id"] for c in injected],
            "injected_tokens": used, "top_k": top_k, "budget_tokens": budget_tokens, "min_score": min_score,
            "fill_recent": fill_recent}


def render_block(memories: list[dict]) -> str:
    if not memories:
        return ""
    lines = [f"- [{m['type']}] {m['content']}" for m in memories]
    return ("\nRelevant memory (remembered from earlier conversation; use it naturally when it fits, "
            "do not recite it, and never invent memories that are not listed):\n" + "\n".join(lines))


PROPOSAL_INSTRUCTION = (
    '\nAlso return "memory_proposals" (third key): at most 3 short memories worth keeping for future '
    'conversations, each {"type": "semantic"|"episodic"|"relationship", "content": "..."}. '
    "semantic = stable facts or preferences the user stated; episodic = something that happened or was "
    "promised; relationship = a change in how the two relate. Only propose what was actually said in "
    "this conversation, written in the conversation's language. Use [] when nothing new is worth keeping."
)


def validate_proposals(proposals: list[MemoryProposal], existing: list[dict], evidence_text: str) -> list[dict]:
    """Decide for each proposal: store, or skip with a reason.

    `evidence_text` is the conversation the proposal claims to come from; a proposal that shares
    almost nothing with it is kept but flagged `unsupported` so an inspector can find candidates for
    the Incorrectly Stored failure.
    """
    out = []
    seen = [bigrams(m["content"]) for m in existing]
    evidence = bigrams(evidence_text)
    for p in proposals[:MAX_PROPOSALS]:
        content = " ".join(p.content.split())
        grams = bigrams(content)
        decision = {"type": p.type, "content": content}
        if len(normalize(content)) < 2:
            decision["action"] = "skip"
            decision["reason"] = "too_short"
        elif any(overlap(s, grams) >= DUPLICATE_OVERLAP and overlap(grams, s) >= DUPLICATE_OVERLAP for s in seen):
            decision["action"] = "skip"
            decision["reason"] = "duplicate"
        else:
            decision["action"] = "store"
            decision["supported"] = overlap(evidence, grams) >= EVIDENCE_OVERLAP
            seen.append(grams)
        out.append(decision)
    return out


def evidenced(memory_content: str, reply: str) -> bool:
    """The reply shares a meaningful part of the memory's wording (an inference, not causality)."""
    grams = bigrams(memory_content)
    if len(grams) < 2:
        return False
    return overlap(bigrams(reply), grams) >= EVIDENCE_OVERLAP


# ── benchmark probes (Memory on/off comparison) ──────────────────────────

def _hit(keywords: list[str], text: str) -> bool:
    t = normalize(text)
    return any(normalize(k) and normalize(k) in t for k in keywords)


def probe(*, expect: list[str], forbid: list[str], reply: str, context: str, stored: list[dict],
          trace: dict | None) -> dict:
    """Classify one recall opportunity with the failure taxonomy (PROJECT_SPEC 70).

    `context` is the conversation still visible to the model (history since the last session
    break); `stored` the scope's memories before this turn; `trace` the retrieval trace or None
    when memory is off.
    """
    injected = [c for c in (trace or {}).get("candidates", []) if c.get("decision") in INJECTED]
    result = {
        "expect": expect,
        "recalled": bool(expect) and _hit(expect, reply),
        "in_context": bool(expect) and _hit(expect, context),
        "stored": bool(expect) and any(_hit(expect, m["content"]) for m in stored),
        "injected": bool(expect) and any(_hit(expect, c["content"]) for c in injected),
        "hallucinated": bool(forbid) and _hit(forbid, reply),
    }
    if not expect:
        outcome = None
    elif result["recalled"]:
        outcome = "recalled"
    elif trace is None:
        outcome = "missed_in_context" if result["in_context"] else "no_memory"
    elif result["injected"]:
        outcome = "retrieved_but_ignored"
    elif result["stored"]:
        outcome = "not_retrieved"
    elif result["in_context"]:
        outcome = "missed_in_context"
    else:
        outcome = "not_stored"
    result["outcome"] = outcome
    return result


def summarize(turns: list[dict]) -> dict:
    probes = [t["probe"] for t in turns if t.get("probe") and t["probe"].get("outcome")]
    traces = [t["memory"] for t in turns if t.get("memory")]
    decisions = [d for m in traces for d in m.get("decisions", [])]
    stored = [d for d in decisions if d.get("action") == "store"]
    outcomes: dict[str, int] = {}
    for p in probes:
        outcomes[p["outcome"]] = outcomes.get(p["outcome"], 0) + 1

    def avg(key):
        vals = [m[key] for m in traces if isinstance(m.get(key), (int, float))]
        return round(sum(vals) / len(vals), 2) if vals else None

    return {
        "probes": len(probes),
        "recalled": outcomes.get("recalled", 0),
        "recall_rate": round(outcomes.get("recalled", 0) / len(probes), 3) if probes else None,
        "outcomes": outcomes,
        "hallucinated": sum(1 for t in turns if (t.get("probe") or {}).get("hallucinated")),
        "stored": len(stored),
        "unsupported_stored": sum(1 for d in stored if d.get("supported") is False),
        "skipped_proposals": sum(1 for d in decisions if d.get("action") == "skip"),
        "avg_injected_tokens": avg("injected_tokens"),
        "avg_retrieval_ms": avg("retrieval_ms"),
    }
