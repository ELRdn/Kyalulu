"""Weighted fair admission: Pro gets more turns, ordinary queues never starve."""

import asyncio
from collections import deque
from contextlib import asynccontextmanager
from .store import CloudError


class GenerationQueue:
    def __init__(self, concurrency=2, maximum=32):
        self.concurrency, self.maximum = concurrency, maximum
        self.queues = {"normal": deque(), "pro": deque()}
        self.active = 0
        self.turn = 0
        self.lock = asyncio.Lock()

    def pump(self):
        order = ("pro", "pro", "normal")
        while self.active < self.concurrency and any(self.queues.values()):
            kind = order[self.turn % 3]
            self.turn += 1
            if not self.queues[kind]:
                kind = "normal" if kind == "pro" else "pro"
            future = self.queues[kind].popleft()
            if future.cancelled():
                continue
            self.active += 1
            future.set_result(None)

    @asynccontextmanager
    async def slot(self, weight=1):
        future = asyncio.get_running_loop().create_future()
        kind = "pro" if weight > 1 else "normal"
        admitted = False
        async with self.lock:
            if sum(len(q) for q in self.queues.values()) >= self.maximum:
                raise CloudError("generation_queue_full", 429)
            self.queues[kind].append(future)
            self.pump()
        try:
            await future
            admitted = True
            yield
        finally:
            async with self.lock:
                if admitted or (future.done() and not future.cancelled()):
                    self.active -= 1
                else:
                    future.cancel()
                    if future in self.queues[kind]:
                        self.queues[kind].remove(future)
                self.pump()
