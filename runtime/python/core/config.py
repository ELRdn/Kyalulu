"""設定管理 - pydantic-settings + .env"""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# .env はプロジェクトルート (my zeta/.env) に置く。runtime/ からでも読めるよう絶対パスで指定
_ENV_PATH = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Provider URLs
    ollama_url: str = "http://127.0.0.1:11434"
    lm_studio_url: str = "http://127.0.0.1:1234/v1"
    openai_compatible_url: str = ""  # 例: https://api.openai.com/v1
    openai_compatible_api_key: str = ""  # 外部API用
    # RunPod / LLM 汎用エイリアス（runpodで立てたvLLM用）
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""

    # LE (Kyalulu Local Engine) - loopback daemon, bearer token required
    le_api_url: str = "http://127.0.0.1:8130"
    le_api_token: str = ""  # 空なら le_token_file (LE が生成したトークン) を読む
    le_token_file: str = ""

    # App
    app_host: str = "127.0.0.1"
    app_port: int = 8000

    @property
    def effective_openai_url(self) -> str:
        return self.llm_base_url or self.openai_compatible_url

    @property
    def effective_openai_key(self) -> str:
        return self.llm_api_key or self.openai_compatible_api_key


def default_le_token_file() -> Path:
    """LE 側 config::data_dir() と同じ既定パス (LE_DATA_DIR/api-token)."""
    import os
    import sys
    base = os.environ.get("LE_DATA_DIR")
    if base:
        return Path(base) / "api-token"
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        root = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return root / "kyalulu-le" / "api-token"


def resolve_le_token() -> str:
    if settings.le_api_token:
        return settings.le_api_token
    path = Path(settings.le_token_file) if settings.le_token_file else default_le_token_file()
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


settings = Settings()
