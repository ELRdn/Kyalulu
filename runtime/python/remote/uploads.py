"""Bounded upload assembly before handing a complete request to the Runtime."""

import base64
import time
from uuid import UUID

from .bridge import MAX_BODY, BridgeError


class Uploads:
    def __init__(self, *, clock=time.monotonic):
        self.clock = clock
        self.items = {}

    def accept(self, frame):
        now = self.clock()
        for id in list(self.items):
            if now - self.items[id]["created"] > 60:
                del self.items[id]
        id = frame.get("id")
        try:
            if not isinstance(id, str) or str(UUID(id)) != id:
                raise ValueError()
        except ValueError:
            raise BridgeError("invalid_request_id") from None
        kind = frame.get("type")
        if kind == "request_start":
            if id in self.items or len(self.items) >= 4:
                raise BridgeError("upload_capacity")
            size = frame.get("size")
            if type(size) is not int or not 0 <= size <= MAX_BODY:
                raise BridgeError("request_too_large")
            if sum(item["size"] for item in self.items.values()) + size > MAX_BODY:
                raise BridgeError("upload_capacity")
            self.items[id] = {**frame, "created": now, "body": bytearray()}
        elif kind == "request_chunk":
            item = self.items.get(id)
            if item is None:
                raise BridgeError("upload_missing")
            data = frame.get("data")
            try:
                if not isinstance(data, str) or len(data) > 32768:
                    raise ValueError()
                chunk = base64.b64decode(data, validate=True)
            except ValueError:
                self.items.pop(id, None)
                raise BridgeError("invalid_chunk") from None
            if len(item["body"]) + len(chunk) > item["size"]:
                self.items.pop(id, None)
                raise BridgeError("request_too_large")
            item["body"].extend(chunk)
        elif kind == "request_end":
            item = self.items.pop(id, None)
            if item is None or len(item["body"]) != item["size"]:
                raise BridgeError("incomplete_upload")
            return dict(
                id=id,
                method=item.get("method"),
                path=item.get("path"),
                headers=item.get("headers"),
                body=bytes(item["body"]),
            )
        else:
            raise BridgeError("unsupported_frame")
        return None
