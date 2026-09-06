"""Explicit provider routing. Unknown routes must never silently run Mock."""
from .mock import MockProvider
from .ollama import OllamaProvider
from .lmstudio import LMStudioProvider
from .openai_compat import OpenAICompatibleProvider
from .responses import ResponsesProvider


def get_provider(provider_type, **kwargs):
    types = {"mock": MockProvider, "ollama": OllamaProvider, "lm_studio": LMStudioProvider,
             "lmstudio": LMStudioProvider, "openai_compatible": OpenAICompatibleProvider,
             "openai-compatible": OpenAICompatibleProvider, "openai": OpenAICompatibleProvider,
             "responses": ResponsesProvider, "openai_responses": ResponsesProvider,
             "opencode_responses": ResponsesProvider}
    cls = types.get(provider_type)
    if cls is None: raise ValueError(f"unknown provider: {provider_type}")
    return cls() if cls is MockProvider else cls(**kwargs)


def get_provider_for_model(model_cfg):
    provider = model_cfg.get("provider")
    if not isinstance(provider, dict) or not provider.get("type") or not provider.get("model"):
        raise ValueError("model registry needs provider.type and provider.model")
    kwargs = {"base_url": provider.get("base_url")}
    if provider["type"] in {"responses", "openai_compatible", "openai-compatible", "openai", "openai_responses", "opencode_responses"}:
        kwargs["api_key"] = provider.get("api_key")
    kwargs["supports_structured_output"] = bool(provider.get("structured_output", False))
    if provider["type"] == "responses":
        kwargs["supported_parameters"] = provider.get("supported_parameters", [])
    return get_provider(provider["type"], **kwargs)
