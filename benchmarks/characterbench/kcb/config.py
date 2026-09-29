from __future__ import annotations
import copy
import ipaddress
from urllib.parse import urlsplit
from .util import KCBError, load_json

DEFAULT = {
    "provider": "openai", "base_url": "http://127.0.0.1:1234/v1",
    "model": "auto", "label": "local-candidate", "api_key_env": "KCB_API_KEY",
    "temperature": 0.7, "top_p": 0.95, "max_tokens": 768,
    "stream": True, "stream_usage": False, "timeout_seconds": 180,
    "send_seed": False, "extra_body": {}, "track": "core",
    "require_no_reasoning": False,
    "runtime_id": None, "system_prompt_extra": "", "model_metadata": {},
    "input_usd_per_million": None, "output_usd_per_million": None,
}
PROTECTED = {"messages", "model", "stream", "max_tokens", "max_completion_tokens",
             "temperature", "top_p", "seed", "api_key", "authorization", "stream_options"}

def validate_config(config: dict) -> dict:
    if not isinstance(config, dict):
        raise KCBError("Config must be a JSON object")
    unknown = set(config) - set(DEFAULT)
    if unknown:
        raise KCBError(f"Unknown config keys: {sorted(unknown)}")
    c = copy.deepcopy(DEFAULT)
    c.update(config)
    if c["provider"] not in {"openai", "mock", "system_http"}:
        raise KCBError("provider must be openai, mock, or system_http")
    if c["track"] not in {"core", "system"}:
        raise KCBError("track must be core or system")
    if c["track"] == "core" and (c["runtime_id"] or c["system_prompt_extra"] or c["provider"] == "system_http"):
        raise KCBError("Core forbids runtime additions. Use track=system and a declared runtime_id")
    if c["track"] == "system" and not c["runtime_id"]:
        raise KCBError("System track requires runtime_id (include implementation/version/memory policy)")
    for name in ("model", "label", "api_key_env"):
        if not isinstance(c[name], str) or not c[name].strip():
            raise KCBError(f"{name} must be a nonempty string")
    for name in ("max_tokens", "timeout_seconds"):
        if type(c[name]) is not int or c[name] <= 0:
            raise KCBError(f"{name} must be a positive integer")
    if c["max_tokens"] > 131072:
        raise KCBError("max_tokens exceeds the benchmark safety cap (131072)")
    for name in ("stream", "stream_usage", "send_seed", "require_no_reasoning"):
        if type(c[name]) is not bool:
            raise KCBError(f"{name} must be boolean")
    if c["require_no_reasoning"] and c["provider"] != "openai":
        raise KCBError("require_no_reasoning is supported only for OpenAI-compatible responses")
    for name, lo, hi in (("temperature", 0, 2), ("top_p", 0.000001, 1)):
        if type(c[name]) not in (int, float) or not lo <= c[name] <= hi:
            raise KCBError(f"{name} must be in [{lo}, {hi}]")
    for name in ("input_usd_per_million", "output_usd_per_million"):
        if c[name] is not None and (type(c[name]) not in (int, float) or not 0 <= c[name] < 1e8):
            raise KCBError(f"{name} must be nonnegative or null")
    if not isinstance(c["extra_body"], dict) or PROTECTED.intersection(c["extra_body"]):
        raise KCBError("extra_body cannot override controlled request fields or contain credentials")
    def no_secrets(v):
        if isinstance(v, dict):
            for k, x in v.items():
                if "api_key" in k.lower() or k.lower() in {"authorization", "password", "secret"}:
                    raise KCBError("Use api_key_env, not credentials in JSON/config metadata")
                no_secrets(x)
        elif isinstance(v, list):
            for x in v:
                no_secrets(x)
    no_secrets(c["extra_body"])
    no_secrets(c["model_metadata"])
    if not isinstance(c["system_prompt_extra"], str) or not isinstance(c["model_metadata"], dict):
        raise KCBError("Invalid system_prompt_extra or model_metadata")
    parts = urlsplit(c["base_url"])
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise KCBError("base_url must be HTTP(S), with no credentials, query, or fragment")
    c["base_url"] = c["base_url"].rstrip("/")
    return c

def load_config(path: str) -> dict:
    return validate_config(load_json(path))

def check_network(config: dict, allow_remote: bool) -> None:
    if config["provider"] == "mock":
        return
    host = urlsplit(config["base_url"]).hostname or ""
    try:
        local = ipaddress.ip_address(host).is_loopback
    except ValueError:
        local = host.lower() == "localhost"
    if not local and not allow_remote:
        raise KCBError("Non-loopback endpoint blocked. Add --allow-remote to explicitly send benchmark data there (API fees may apply).")
