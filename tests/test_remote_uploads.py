import base64
import uuid

import pytest
from python.remote.bridge import MAX_BODY, BridgeError
from python.remote.uploads import Uploads


def start(id, size):
    return {
        "type": "request_start",
        "id": id,
        "method": "POST",
        "path": "/api/library/assets",
        "headers": {},
        "size": size,
    }


def test_binary_assembly_and_no_execution_before_end():
    uploads = Uploads()
    id = str(uuid.uuid4())
    assert uploads.accept(start(id, 3)) is None
    assert (
        uploads.accept(
            {
                "type": "request_chunk",
                "id": id,
                "data": base64.b64encode(b"\x00\xffx").decode(),
            }
        )
        is None
    )
    assert uploads.accept({"type": "request_end", "id": id})["body"] == b"\x00\xffx"
    with pytest.raises(BridgeError):
        uploads.accept({"type": "request_end", "id": id})


def test_aggregate_allocation_limit_and_expiry():
    now = [0]
    uploads = Uploads(clock=lambda: now[0])
    uploads.accept(start(str(uuid.uuid4()), MAX_BODY))
    with pytest.raises(BridgeError, match="capacity"):
        uploads.accept(start(str(uuid.uuid4()), 1))
    now[0] = 61
    uploads.accept(start(str(uuid.uuid4()), 1))
    assert len(uploads.items) == 1


@pytest.mark.parametrize("size", [-1, MAX_BODY + 1, True, "10"])
def test_invalid_declared_size(size):
    with pytest.raises(BridgeError):
        Uploads().accept(start(str(uuid.uuid4()), size))


def test_oversize_chunk_discards_upload():
    uploads = Uploads()
    id = str(uuid.uuid4())
    uploads.accept(start(id, 1))
    with pytest.raises(BridgeError):
        uploads.accept({"type": "request_chunk", "id": id, "data": "eHg="})
    assert not uploads.items
