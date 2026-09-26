"""Persona and World creation, revision history, and lossless JSON import/export."""
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from python.storage import creator
from python.storage.db import init_db

router = APIRouter(prefix="/creator")
Kind = Literal["persona", "world"]


class Document(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    traits: str = Field(default="", max_length=6000)
    rules: str = Field(default="", max_length=6000)

    @field_validator("display_name", "description", "traits", "rules", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value


@router.get("/{kind}")
async def list_assets(kind: Kind):
    await init_db()
    return {"items": creator.list_latest(kind)}


@router.post("/{kind}", status_code=201)
async def create_asset(kind: Kind, body: Document):
    await init_db()
    return creator.save(kind, body.model_dump())


@router.put("/{kind}/{reference}")
async def update_asset(kind: Kind, reference: str, body: Document):
    await init_db()
    return creator.save(kind, body.model_dump(), reference)


@router.get("/{kind}/{reference}")
async def asset_detail(kind: Kind, reference: str):
    await init_db()
    item = creator.get(reference, kind)
    if not item:
        raise HTTPException(404, "設定が見つかりません")
    return {"item": item, "versions": creator.history(reference)}


@router.get("/{kind}/{reference}/export")
async def export_asset(kind: Kind, reference: str):
    detail = await asset_detail(kind, reference)
    item = detail["item"]
    document = {key: item[key] for key in Document.model_fields}
    return JSONResponse({"format": "kyalulu-creator", "version": 1, "kind": kind, "document": document},
                        headers={"Content-Disposition": f'attachment; filename="{kind}.json"'})
