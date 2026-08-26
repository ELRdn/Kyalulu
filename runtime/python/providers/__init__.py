"""Provider抽象化 - PROJECT_SPEC.md 10章"""

from abc import ABC, abstractmethod
from typing import AsyncIterator


class ModelProvider(ABC):
    """共通Providerインターフェース (スタブ)"""

    @abstractmethod
    async def connect(self) -> bool:
        ...

    @abstractmethod
    async def list_models(self) -> list[dict]:
        ...

    @abstractmethod
    async def get_model_metadata(self, model_id: str) -> dict:
        ...

    @abstractmethod
    async def generate(self, prompt: str, **kwargs) -> str:
        ...

    @abstractmethod
    async def stream_generate(self, prompt: str, **kwargs) -> AsyncIterator[str]:
        if False:
            yield ""
        ...

    @abstractmethod
    async def health_check(self) -> dict:
        ...

    @abstractmethod
    def capabilities(self) -> dict:
        ...
