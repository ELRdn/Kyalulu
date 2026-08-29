"""Provider Factory"""

from . import ModelProvider
from .mock import MockProvider
from .ollama import OllamaProvider
from .lmstudio import LMStudioProvider
from .openai_compat import OpenAICompatibleProvider
from .responses import ResponsesProvider


def get_provider(provider_type: str, **kwargs) -> ModelProvider:
    t = provider_type.lower()
    if t == "ollama":
        return OllamaProvider(**kwargs)
    if t in ("lm_studio", "lmstudio"):
        return LMStudioProvider(**kwargs)
    if t in ("openai_compatible", "openai-compatible", "openai"):
        return OpenAICompatibleProvider(**kwargs)
    if t in ("responses", "openai_responses", "opencode_responses"):
        return ResponsesProvider(**kwargs)
    if t == "mock":
        return MockProvider()
    # フォールバックはMock
    return MockProvider()


def get_provider_for_model(model_cfg: dict) -> ModelProvider:
    """models/*.yaml の1エントリからProviderを生成"""
    provider = model_cfg.get("provider", {})
    if isinstance(provider, dict):
        ptype = provider.get("type", "mock")
        return get_provider(ptype, base_url=provider.get("base_url"))
    return MockProvider()
