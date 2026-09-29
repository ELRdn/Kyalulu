"""Single-process ownership for a Runtime data directory, released by the OS.

Every current Runtime lifespan and explicit Host adoption uses this lock. Older
versions cannot cooperate: stop them before adoption or starting this version.
"""

import os
from pathlib import Path

LOCK_FILENAME = ".runtime.lock"


class RuntimeLock:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.file = None

    def __enter__(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        try:
            self.file = (self.directory / LOCK_FILENAME).open("a+b")
            if os.fstat(self.file.fileno()).st_size == 0:
                self.file.write(b"0")
                self.file.flush()
            self.file.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            if self.file:
                self.file.close()
                self.file = None
            raise ValueError("runtime_already_running_or_lock_unavailable") from None
        return self

    def __exit__(self, *_):
        if self.file:
            self.file.close()
            self.file = None
