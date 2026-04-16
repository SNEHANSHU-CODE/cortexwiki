from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class QueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=1000)
    debug: bool = False
    allow_internet: bool = False


class QuerySource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    url: str
    source_type: str


class QueryData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: str
    confidence: float
    strategy: str
    is_grounded: bool
    sources: list[QuerySource]
    debug: dict[str, Any] | None = None


class StreamEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    delta: str | None = None
    data: dict[str, Any] | None = None

