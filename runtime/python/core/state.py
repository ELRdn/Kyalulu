"""Runtime State — M3 最小実装"""

from __future__ import annotations
from .schemas import RuntimeState, RelationshipLevel

# 関係性は会話ターンに応じて自動で進む（簡易ルール）
# 本来はLLMのstructured outputで更新するが、M3ではターン数ベースのヒュリスティック
_THRESHOLDS: list[tuple[int, RelationshipLevel]] = [
    (0, "stranger"),
    (3, "acquaintance"),
    (8, "friend"),
    (20, "intimate"),
    (40, "partner"),
]

def infer_relationship(turn: int) -> RelationshipLevel:
    level: RelationshipLevel = "stranger"
    for th, lv in _THRESHOLDS:
        if turn >= th:
            level = lv
    return level

def next_state(prev: RuntimeState | None, session_id: str) -> RuntimeState:
    """1ターン進める。prevが無ければ初期状態。"""
    if prev is None:
        return RuntimeState(session_id=session_id, turn=0, relationship="stranger")
    new_turn = prev.turn + 1
    return RuntimeState(
        session_id=session_id,
        turn=new_turn,
        relationship=infer_relationship(new_turn),
        last_summary=prev.last_summary,
        character_id=prev.character_id,
        persona_id=prev.persona_id,
        world_id=prev.world_id,
        prompt_version=prev.prompt_version,
        state_version=prev.state_version,
    )

def load_state_from_session_settings(row: dict | None, session_id: str) -> RuntimeState:
    """
    session_settings の character/persona/world から State を復元
    row: DBの session_settings レコード（無ければ None）
    """
    if not row:
        return RuntimeState(session_id=session_id)
    return RuntimeState(
        session_id=session_id,
        turn=0,  # ターンは chat_history の count から推定する方が正確だが、一旦0
        relationship="stranger",
        character_id=row.get("character_id"),
        persona_id=row.get("persona_id"),
        world_id=row.get("world_id"),
    )
