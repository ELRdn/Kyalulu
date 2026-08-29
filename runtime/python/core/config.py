"""設定管理 - pydantic-settings + .env"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Provider URLs
    ollama_url: str = "http://127.0.0.1:11434"
    lm_studio_url: str = "http://127.0.0.1:1234/v1"
    openai_compatible_url: str = ""  # 例: https://api.openai.com/v1
    openai_compatible_api_key: str = ""  # 外部API用

    # App
    app_host: str = "127.0.0.1"
    app_port: int = 8000


settings = Settings()
