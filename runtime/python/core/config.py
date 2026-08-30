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

    # App
    app_host: str = "127.0.0.1"
    app_port: int = 8000

    @property
    def effective_openai_url(self) -> str:
        return self.llm_base_url or self.openai_compatible_url

    @property
    def effective_openai_key(self) -> str:
        return self.llm_api_key or self.openai_compatible_api_key


settings = Settings()
