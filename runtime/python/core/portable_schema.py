"""Versioned portable library documents, independent of any source application."""
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class PortableModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class ImportNotice(BaseModel):
    path: str
    status: Literal["applied", "converted", "preserved", "error"]
    reason: str


class PortableAsset(PortableModel):
    name: str
    type: str = "icon"
    uri: str = ""
    media_type: str = ""
    asset_id: str | None = None


class PortableProfile(PortableModel):
    settings: dict[str, Any] = Field(default_factory=dict)
    system_prompt: str = ""
    post_history_instructions: str = ""
    context_template: str = ""
    prompts: list[dict[str, Any]] = Field(default_factory=list)
    model_hint: str = ""
    variables: dict[str, str] = Field(default_factory=dict)


class PortableHistory(PortableModel):
    name: str = "Imported conversation"
    messages: list[dict[str, Any]] = Field(default_factory=list)


class PortableDocument(PortableModel):
    schema_version: Literal[1] = 1
    kind: Literal["character", "profile", "lorebook"] = "character"
    name: str
    # CC data is deliberately extensible. Unknown source keys survive editing/export.
    data: dict[str, Any] = Field(default_factory=dict)
    speaking_style: str = ""
    nsfw: bool = False
    profile: PortableProfile = Field(default_factory=PortableProfile)
    assets: list[PortableAsset] = Field(default_factory=list)
    histories: list[PortableHistory] = Field(default_factory=list)
    source_format: str = "kyalulu"
    source: dict[str, Any] = Field(default_factory=dict)
    notices: list[ImportNotice] = Field(default_factory=list)


class LibraryItem(BaseModel):
    id: str
    revision: int
    document: PortableDocument
    original_id: str | None = None


class LibraryRef(BaseModel):
    id: str
    revision: int = Field(ge=1)


class LibraryBinding(BaseModel):
    character: LibraryRef | None = None
    profile: LibraryRef | None = None
    lorebooks: list[LibraryRef] = Field(default_factory=list)
    expression_asset_id: str | None = None


class ImportPreview(BaseModel):
    preview_id: str
    filename: str
    source_hash: str
    documents: list[PortableDocument]


class ImportSelection(BaseModel):
    index: int = Field(ge=0)
    document: PortableDocument
    history_indices: list[int] = Field(default_factory=list)
    target_id: str | None = None
    expected_revision: int | None = None


class ImportCommit(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    selections: list[ImportSelection] = Field(min_length=1)
