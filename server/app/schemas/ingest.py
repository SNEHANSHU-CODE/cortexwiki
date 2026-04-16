from datetime import datetime

from pydantic import BaseModel, ConfigDict, HttpUrl


class YouTubeIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: HttpUrl


class WebIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: HttpUrl


class IngestData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
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
    title: str
    source_type: str
    source_url: str
    summary: str
    created_at: datetime

