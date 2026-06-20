from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class WikiCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("description", mode="before")
    @classmethod
    def strip_description(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value


class WikiUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("description", mode="before")
    @classmethod
    def strip_description(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value


class WikiResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    user_id: str
    name: str
    description: str
    master_note: str
    source_count: int
    created_at: datetime
    updated_at: datetime
    last_ingested_at: datetime | None = None


class WikiSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    user_id: str
    name: str
    description: str
    master_note_excerpt: str = ""
    source_count: int
    created_at: datetime
    updated_at: datetime
    last_ingested_at: datetime | None = None


class WikiListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wikis: list[WikiSummaryResponse]
    total: int