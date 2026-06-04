from datetime import datetime

from pydantic import BaseModel, ConfigDict, HttpUrl


class YouTubeIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: HttpUrl
    wiki_id: str


class WebIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: HttpUrl
    wiki_id: str


class IngestData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    wiki_id: str
    title: str
    source_type: str
    source_url: str
    summary: str
    concepts: list[str]
    conflicts: list[dict]
    created_at: datetime


class IngestHistoryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    wiki_id: str | None = None
    title: str
    source_type: str
    source_url: str
    summary: str
    created_at: datetime


class FallbackIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: HttpUrl
    wiki_id: str
    content: str
    type: str  # "youtube" or "web"