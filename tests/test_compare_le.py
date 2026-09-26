import asyncio
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("compare_le", Path(__file__).resolve().parents[1] / "scripts/compare_le_direct.py")
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)


@pytest.mark.asyncio
async def test_cancel_probe_stops_at_first_real_provider_delta(monkeypatch):
    closed = False
    class Provider:
        async def stream_events(self, **kwargs):
            nonlocal closed
            try:
                yield {"type": "delta", "text": "hello"}
                await asyncio.Event().wait()
            finally:
                closed = True
        async def generate(self, **kwargs):
            assert closed
            return "OK"
    monkeypatch.setattr(compare, "find_model", lambda _: {"provider": {"model": "fixture"}})
    monkeypatch.setattr(compare, "get_provider_for_model", lambda _: Provider())
    result = await asyncio.wait_for(compare.cancel_probe("fixture"), 1)
    assert result["first_chunk_ms"] is not None and result["follow_up_ok"] and closed


def test_unavailable_vram_is_not_reported_as_zero():
    assert compare._vram_used({"devices": [{"id": 0, "free_bytes": None}]}, {"devices": [{"id": 0, "free_bytes": 42}]}) is None
