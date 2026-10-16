"""Request-scoped storage. Local callers retain their existing data directory."""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID


@dataclass(frozen=True)
class CloudStorageContext:
    owner_id: str
    directory: Path

    @classmethod
    def for_owner(cls, root: Path, owner_id: str):
        # IDs come exclusively from verified identity, never a path/body/header.
        owner = str(UUID(owner_id))
        root = root.resolve()
        directory = root / owner
        if directory.is_symlink() or directory.resolve().parent != root:
            raise ValueError("invalid tenant directory")
        return cls(owner, directory)


CURRENT_STORAGE: ContextVar[CloudStorageContext | None] = ContextVar(
    "kyalulu_storage", default=None
)


def get_db_path(local_path: Path) -> Path:
    context = CURRENT_STORAGE.get()
    return context.directory / "data.db" if context else local_path


def task_key(generation_id: str) -> str:
    context = CURRENT_STORAGE.get()
    return f"{context.owner_id}:{generation_id}" if context else generation_id


@contextmanager
def storage_context(context: CloudStorageContext):
    token = CURRENT_STORAGE.set(context)
    try:
        yield context
    finally:
        CURRENT_STORAGE.reset(token)
