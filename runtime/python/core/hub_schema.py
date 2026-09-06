"""Public Hub contracts. Download locations are resolved, never caller-authorized."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

Source = Literal['taverncard', 'sillytavern', 'risurealm', 'github', 'huggingface']
RisuFormat = Literal['png-v3', 'json-v3', 'lorebook-v2', 'lorebook-v3', 'preset-st-chat']


class UrlImport(BaseModel):
    model_config = ConfigDict(extra='forbid')
    url: str = Field(min_length=1, max_length=2048)
    format: RisuFormat = 'png-v3'
    non_commercial: bool = False


class RemoteSource(BaseModel):
    source: Source
    source_url: str
    source_id: str
    download_url: str
    filename: str
    transport: Literal['server', 'browser'] = 'server'
    revision: str | None = None
    author: str | None = None
    license: str | None = None
    content_rating: Literal['sfw', 'nsfw', 'unknown'] = 'unknown'
    expected_hash: str | None = None
    format: str | None = None


class HubItem(BaseModel):
    source: Source
    id: str
    name: str
    description: str = ''
    source_url: str
    author: str | None = None
    license: str | None = None
    format: str = 'CC PNG'
    thumbnail_url: str | None = None
    content_rating: Literal['sfw'] = 'sfw'
    imported_ids: list[str] = Field(default_factory=list)


class HubResults(BaseModel):
    source: Source
    items: list[HubItem]
    page: int
    has_more: bool = False
    total: int | None = None


class HubError(ValueError):
    def __init__(self, code: str, message: str, status: int = 400, retry_after: str | None = None):
        super().__init__(message)
        self.code, self.status, self.retry_after = code, status, retry_after
