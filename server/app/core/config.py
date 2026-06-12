from functools import cached_property, lru_cache
from typing import Literal

from pydantic import field_validator
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

    # Stored as plain str — avoids pydantic-settings JSON decode crash on Render
    FRONTEND_ORIGINS: str = "http://localhost:5173"

    # Auth
    SECRET_KEY: str = "change-me-in-production-with-at-least-32-characters"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    REFRESH_COOKIE_NAME: str = "cortexwiki_refresh_token"
    ACCESS_COOKIE_NAME: str = "cortexwiki_access_token"
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: Literal["strict", "lax", "none"] = "lax"
    COOKIE_DOMAIN: str | None = None

    # MongoDB
    MONGO_URI: str | None = None
    MONGO_DB_NAME: str = "cortexwiki"

    # Redis
    REDIS_URL: str | None = None
    REDIS_ACCESS_TOKEN_PREFIX: str = "access_tokens"
    REDIS_MAX_CONNECTIONS: int = 20

    # Mongo connection pool tuning
    MONGO_MAX_POOL_SIZE: int = 50
    MONGO_MIN_POOL_SIZE: int = 5

    # Neo4j
    NEO4J_URI: str | None = None
    NEO4J_USER: str | None = None
    NEO4J_PASSWORD: str | None = None

    # Groq — primary LLM
    GROQ_API_KEY: str | None = None
    GROQ_MODEL: str = "llama-3.1-8b-instant"
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"

    # Gemini — fallback LLM + embeddings
    GEMINI_API_KEY: str | None = None
    GEMINI_MODEL: str = "gemini-1.5-flash"
    GEMINI_EMBEDDING_MODEL: str = "models/gemini-embedding-001"

    # Supadata — YouTube transcript primary (bypasses datacenter IP blocks)
    SUPADATA_API_KEY: str | None = None

    # OCR.space API — for PDF image fallback
    OCR_SPACE_API_KEY: str | None = None


    # ScraperAPI — YouTube transcript fallback proxy
    SCRAPERAPI_KEY: str | None = None
    SCRAPERAPI_PROXY_URL: str = "http://proxy.scraperapi.com:8001"

    # LangSmith Observability Tracing
    LANGSMITH_TRACING: bool = False
    LANGSMITH_ENDPOINT: str = "https://api.smith.langchain.com"
    LANGSMITH_API_KEY: str | None = None
    LANGSMITH_PROJECT: str = "cortexwiki"

    # Query / ingest
    STREAM_CHUNK_DELAY_MS: int = 30
    QUERY_RESULT_LIMIT: int = 5
    INTERNET_SEARCH_RESULT_LIMIT: int = 3
    INGEST_MAX_CHARACTERS: int = 40000
    MASTER_NOTE_MAX_LENGTH: int = 50000  # Max chars for compounded master note
    MAX_SOURCES_PER_WIKI: int = 1000  # Max sources allowed per wiki
    # BUG FIX #22: Make embedding cache TTL configurable
    EMBEDDING_CACHE_TTL_SECONDS: int = 86400  # 24 hours default

    # Outbound HTTP
    INTERNET_SEARCH_ENDPOINT: str = "https://html.duckduckgo.com/html/"
    USER_AGENT: str = "CortexWiki/1.0 (+https://localhost)"
    OUTBOUND_VERIFY_SSL: bool = False
    HTTP_REQUEST_TIMEOUT: int = 20
    HTTP_STREAM_TIMEOUT: int = 30

    # LLM timeouts
    LLM_REQUEST_TIMEOUT: int = 40
    LLM_STREAM_TIMEOUT: int = 120

    # Request and connection limits
    API_REQUESTS_PER_MINUTE_PER_USER: int = 120
    API_REQUESTS_PER_MINUTE_PER_IP: int = 20
    MAX_CONCURRENT_REQUESTS: int = 100
    MAX_SOCKET_CONNECTIONS: int = 100

    # External API resilience
    EXTERNAL_API_FAILURE_THRESHOLD: int = 3
    EXTERNAL_API_CIRCUIT_RESET_SECONDS: int = 120

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

    @cached_property
    def frontend_origins_list(self) -> list[str]:
        """Parse FRONTEND_ORIGINS string into a list — used by CORS and Socket.io."""
        if not self.FRONTEND_ORIGINS:
            return ["http://localhost:5173"]
        return [o.strip().rstrip("/") for o in self.FRONTEND_ORIGINS.split(",") if o.strip()]

    @cached_property
    def scraperapi_proxy_url(self) -> str | None:
        """ScraperAPI residential proxy URL for youtube-transcript-api fallback."""
        if not self.SCRAPERAPI_KEY:
            return None
        return f"http://scraperapi:{self.SCRAPERAPI_KEY}@proxy-server.scraperapi.com:8001"

    @cached_property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @cached_property
    def base_url(self) -> str:
        host = "localhost" if self.HOST == "0.0.0.0" else self.HOST
        return f"http://{host}:{self.PORT}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()