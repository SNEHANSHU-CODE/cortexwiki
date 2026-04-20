from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    APP_NAME: str = "CortexWiki API"
    API_V1_PREFIX: str = "/api"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    FRONTEND_ORIGINS: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    # Auth
    SECRET_KEY: str = "change-me-in-production-with-at-least-32-characters"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    REFRESH_COOKIE_NAME: str = "cortexwiki_refresh_token"
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: Literal["strict", "lax", "none"] = "strict"
    COOKIE_DOMAIN: str | None = None

    # MongoDB
    MONGO_URI: str | None = None
    MONGO_DB_NAME: str = "cortexwiki"

    # Redis
    REDIS_URL: str | None = None
    REDIS_ACCESS_TOKEN_PREFIX: str = "access_tokens"

    # Neo4j
    NEO4J_URI: str | None = None
    NEO4J_USER: str | None = None
    NEO4J_PASSWORD: str | None = None

    # Groq — primary LLM (text generation + streaming only)
    GROQ_API_KEY: str | None = None
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"

    # Gemini — fallback LLM + sole embedding provider
    GEMINI_API_KEY: str | None = None
    GEMINI_MODEL: str = "gemini-1.5-flash"
    GEMINI_EMBEDDING_MODEL: str = "text-embedding-004"

    # Query / ingest
    STREAM_CHUNK_DELAY_MS: int = 30
    QUERY_RESULT_LIMIT: int = 5
    INTERNET_SEARCH_RESULT_LIMIT: int = 3
    INGEST_MAX_CHARACTERS: int = 40000

    # Outbound HTTP
    INTERNET_SEARCH_ENDPOINT: str = "https://html.duckduckgo.com/html/"
    USER_AGENT: str = "CortexWiki/1.0 (+https://localhost)"
    OUTBOUND_VERIFY_SSL: bool = False

    @field_validator("FRONTEND_ORIGINS", mode="before")
    @classmethod
    def parse_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, list):
            return value
        if not value:
            return ["http://localhost:5173"]
        return [item.strip() for item in value.split(",") if item.strip()]

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, value) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on", "debug", "development"}:
                return True
            if normalized in {"0", "false", "no", "off", "release", "production"}:
                return False
        return bool(value)

    @field_validator("OUTBOUND_VERIFY_SSL", mode="before")
    @classmethod
    def parse_verify_ssl(cls, value) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on"}:
                return True
            if normalized in {"0", "false", "no", "off"}:
                return False
        return bool(value)

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def base_url(self) -> str:
        host = "localhost" if self.HOST == "0.0.0.0" else self.HOST
        return f"http://{host}:{self.PORT}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()