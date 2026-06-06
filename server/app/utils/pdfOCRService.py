"""
pdfOCRService.py
================
Standalone OCR service backed by the ocr.space API.

Responsibilities
----------------
- Accept a PDF as raw bytes or a file path
- Submit it to ocr.space and return the extracted plain text
- Handle all API-level errors, retries, and response parsing

Design principles
-----------------
- Zero internal dependencies — import this file from any service freely
- All configuration via constructor or environment variables
- Raises typed exceptions so callers can handle failures explicitly
- Never swallows errors silently

Usage
-----
    from app.utils.pdfOCRService import PDFOCRService, OCRError

    ocr = PDFOCRService()                        # reads OCR_SPACE_API_KEY from env
    text = ocr.extract_text_from_bytes(pdf_bytes)
    text = ocr.extract_text_from_path("/tmp/statement.pdf")
"""

from __future__ import annotations

import io
import os
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import requests
from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Public exceptions ─────────────────────────────────────────────────────────

class OCRError(Exception):
    """Base exception for all OCR service failures."""


class OCRConfigError(OCRError):
    """Raised when the service is misconfigured (e.g. missing API key)."""


class OCRAPIError(OCRError):
    """Raised when the ocr.space API returns an error response."""

    def __init__(self, message: str, status_code: Optional[int] = None, error_code: Optional[int] = None):
        super().__init__(message)
        self.status_code  = status_code
        self.error_code   = error_code


class OCRNetworkError(OCRError):
    """Raised on network-level failures (timeout, connection refused, etc.)."""


class OCREmptyResultError(OCRError):
    """Raised when the API responds successfully but returns no text."""


# ── Configuration ─────────────────────────────────────────────────────────────

class OCRLanguage(str, Enum):
    """Supported ocr.space language codes."""
    ENGLISH    = "eng"
    HINDI      = "hin"
    ARABIC     = "ara"
    CHINESE_SIMPLIFIED  = "chs"
    CHINESE_TRADITIONAL = "cht"
    FRENCH     = "fre"
    GERMAN     = "ger"
    JAPANESE   = "jpn"
    KOREAN     = "kor"
    PORTUGUESE = "por"
    RUSSIAN    = "rus"
    SPANISH    = "spa"


class OCREngine(int, Enum):
    """ocr.space engine options."""
    ENGINE_1 = 1   # Fast, good for printed text
    ENGINE_2 = 2   # Slower, better for poor quality / handwriting
    ENGINE_3 = 3   # Best quality, slowest


@dataclass
class OCRConfig:
    """
    All tunable parameters for the OCR service.
    Sensible defaults are pre-set for bank statement extraction.
    """
    api_key:              str            = field(default_factory=lambda: settings.OCR_SPACE_API_KEY)
    api_url:              str            = "https://api.ocr.space/parse/image"
    language:             OCRLanguage    = OCRLanguage.ENGLISH
    engine:               OCREngine      = OCREngine.ENGINE_2  # ENGINE_3 returns empty on free tier
    is_table:             bool           = True    # optimise for tabular bank data
    scale:                bool           = True    # auto-scale small images
    detect_orientation:   bool           = True    # handle rotated scans
    is_create_searchable_pdf: bool       = False   # we only need text
    timeout_seconds:      int            = 120      # ocr.space can be slow on large PDFs
    max_retries:          int            = 3
    retry_backoff_seconds: float         = 2.0     # exponential base


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class OCRResult:
    """
    Structured result returned by PDFOCRService.
    Callers should use .text for downstream processing.
    """
    text:          str
    page_count:    int
    words_found:   int
    engine_used:   int
    processing_ms: Optional[int] = None

    def is_empty(self) -> bool:
        return not self.text.strip()


# ── Service ───────────────────────────────────────────────────────────────────

class PDFOCRService:
    """
    Extracts text from a PDF using the ocr.space REST API.

    Parameters
    ----------
    config : OCRConfig, optional
        Pass a custom OCRConfig to override any default.
        If omitted, configuration is read from environment variables.

    Environment variables
    ---------------------
    OCR_SPACE_API_KEY   Required. Your ocr.space API key.

    Examples
    --------
    >>> ocr = PDFOCRService()
    >>> text = ocr.extract_text_from_bytes(pdf_bytes)

    >>> ocr = PDFOCRService(OCRConfig(engine=OCREngine.ENGINE_2, language=OCRLanguage.HINDI))
    >>> text = ocr.extract_text_from_path("/tmp/statement.pdf")
    """

    def __init__(self, config: Optional[OCRConfig] = None) -> None:
        self._config = config or OCRConfig()
        self._validate_config()

        # Persistent session — reuses TCP connections across calls
        self._session = requests.Session()
        self._session.headers.update({
            "apikey": self._config.api_key,
        })

        logger.info(
            f"PDFOCRService ready — engine={self._config.engine.value} "
            f"lang={self._config.language.value} "
            f"table_mode={self._config.is_table}"
        )

    # ── Public API ────────────────────────────────────────────────────────────

    def extract_text_from_bytes(self, pdf_bytes: bytes, filename: str = "document.pdf") -> str:
        """
        Extract text from raw PDF bytes.

        Parameters
        ----------
        pdf_bytes : bytes
            Raw content of the PDF file.
        filename  : str
            Filename hint sent to the API (must end in .pdf).

        Returns
        -------
        str
            Extracted plain text. Pages are separated by newlines.

        Raises
        ------
        OCRConfigError     — missing or invalid API key
        OCRAPIError        — ocr.space returned an API-level error
        OCRNetworkError    — network / timeout failure
        OCREmptyResultError — API succeeded but extracted no text
        """
        if not pdf_bytes:
            raise ValueError("pdf_bytes must not be empty")

        logger.info(f"OCR request: {filename} ({len(pdf_bytes):,} bytes)")
        result = self._submit_with_retry(pdf_bytes, filename)
        logger.info(
            f"OCR complete: {result.page_count} page(s), "
            f"{result.words_found} word(s), {result.processing_ms}ms"
        )
        return result.text

    def extract_text_from_path(self, pdf_path: str) -> str:
        """
        Extract text from a PDF file on disk.

        Parameters
        ----------
        pdf_path : str
            Absolute or relative path to the PDF file.

        Returns
        -------
        str
            Extracted plain text.
        """
        pdf_path = os.path.abspath(pdf_path)

        if not os.path.isfile(pdf_path):
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        with open(pdf_path, "rb") as fh:
            pdf_bytes = fh.read()

        filename = os.path.basename(pdf_path)
        return self.extract_text_from_bytes(pdf_bytes, filename)

    def extract_result_from_bytes(self, pdf_bytes: bytes, filename: str = "document.pdf") -> OCRResult:
        """
        Same as extract_text_from_bytes but returns the full OCRResult
        for callers that need metadata (page count, word count, etc.).
        """
        if not pdf_bytes:
            raise ValueError("pdf_bytes must not be empty")
        return self._submit_with_retry(pdf_bytes, filename)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _validate_config(self) -> None:
        if not self._config.api_key:
            raise OCRConfigError(
                "OCR_SPACE_API_KEY is not set. "
                "Set the environment variable or pass api_key in OCRConfig."
            )
        if not self._config.api_url.startswith("https://"):
            raise OCRConfigError("api_url must use HTTPS.")

    def _build_payload(self) -> dict:
        """Build the form-data payload for the ocr.space API."""
        return {
            "language":                  self._config.language.value,
            "OCREngine":                 str(self._config.engine.value),
            "isTable":                   str(self._config.is_table).lower(),
            "scale":                     str(self._config.scale).lower(),
            "detectOrientation":         str(self._config.detect_orientation).lower(),
            "isCreateSearchablePdf":     str(self._config.is_create_searchable_pdf).lower(),
            "isSearchablePdfHideTextLayer": "false",
        }

    def _submit_with_retry(self, pdf_bytes: bytes, filename: str) -> OCRResult:
        """
        Submit the PDF to ocr.space with exponential-backoff retry.
        Only retries on network errors and 5xx responses — not on 4xx.
        """
        last_error: Optional[Exception] = None

        for attempt in range(1, self._config.max_retries + 1):
            try:
                return self._submit_once(pdf_bytes, filename)

            except OCRNetworkError as exc:
                last_error = exc
                if attempt < self._config.max_retries:
                    wait = self._config.retry_backoff_seconds * (2 ** (attempt - 1))
                    logger.warning(
                        f"OCR network error (attempt {attempt}/{self._config.max_retries}), "
                        f"retrying in {wait:.1f}s: {exc}"
                    )
                    time.sleep(wait)

            except OCRAPIError as exc:
                # 5xx = transient server error → retry
                # 4xx = client error (bad key, oversized file) → fail immediately
                if exc.status_code and exc.status_code >= 500:
                    last_error = exc
                    if attempt < self._config.max_retries:
                        wait = self._config.retry_backoff_seconds * (2 ** (attempt - 1))
                        logger.warning(
                            f"OCR server error {exc.status_code} "
                            f"(attempt {attempt}/{self._config.max_retries}), "
                            f"retrying in {wait:.1f}s"
                        )
                        time.sleep(wait)
                else:
                    raise  # 4xx — no point retrying

        raise last_error  # type: ignore[misc]

    def _submit_once(self, pdf_bytes: bytes, filename: str) -> OCRResult:
        """Single attempt to submit the PDF and parse the response."""
        files   = {"file": (filename, io.BytesIO(pdf_bytes), "application/pdf")}
        payload = self._build_payload()

        logger.info(
            "🔍 OCR API call → %s | engine=%d | lang=%s | file=%s | size=%d bytes",
            self._config.api_url,
            self._config.engine.value,
            self._config.language.value,
            filename,
            len(pdf_bytes),
        )
        call_start = time.time()

        try:
            response = self._session.post(
                self._config.api_url,
                data=payload,
                files=files,
                timeout=self._config.timeout_seconds,
            )
        except requests.Timeout:
            raise OCRNetworkError(
                f"ocr.space request timed out after {self._config.timeout_seconds}s"
            )
        except requests.ConnectionError as exc:
            raise OCRNetworkError(f"Connection to ocr.space failed: {exc}")
        except requests.RequestException as exc:
            raise OCRNetworkError(f"Unexpected network error: {exc}")

        elapsed_ms = int((time.time() - call_start) * 1000)
        logger.info(
            "📡 OCR API response → HTTP %d | elapsed=%dms | file=%s",
            response.status_code, elapsed_ms, filename,
        )

        # HTTP-level error
        if response.status_code != 200:
            logger.error(
                "❌ OCR API error → HTTP %d | file=%s | body=%s",
                response.status_code, filename, response.text[:200],
            )
            raise OCRAPIError(
                f"ocr.space returned HTTP {response.status_code}",
                status_code=response.status_code,
            )

        return self._parse_response(response)

    def _parse_response(self, response: requests.Response) -> OCRResult:
        """Parse the ocr.space JSON response into an OCRResult."""
        try:
            body = response.json()
        except ValueError:
            raise OCRAPIError("ocr.space response is not valid JSON")

        # ocr.space wraps errors in OCRExitCode
        exit_code = body.get("OCRExitCode", 1)
        if exit_code not in (1, 2):   # 1 = parsed, 2 = parsed with warnings
            error_msg = body.get("ErrorMessage") or body.get("ErrorDetails") or "Unknown OCR error"
            raise OCRAPIError(
                f"ocr.space OCRExitCode={exit_code}: {error_msg}",
                error_code=exit_code,
            )

        parsed_results = body.get("ParsedResults") or []
        if not parsed_results:
            raise OCREmptyResultError("ocr.space returned no ParsedResults")

        # Concatenate text from all pages in order
        page_texts: list[str] = []
        total_words = 0

        for page in parsed_results:
            page_error = page.get("ErrorMessage")
            if page_error:
                logger.warning(f"OCR page warning: {page_error}")

            text = page.get("ParsedText") or ""
            page_texts.append(text)

            # TextOverlay carries per-word data when available
            overlay = page.get("TextOverlay") or {}
            lines   = overlay.get("Lines") or []
            for line in lines:
                total_words += len(line.get("Words") or [])

        full_text = "\n".join(page_texts).strip()

        if not full_text:
            raise OCREmptyResultError(
                "ocr.space parsed the document but extracted no text. "
                "The PDF may be a low-quality scan — try OCREngine.ENGINE_2."
            )

        processing_time = body.get("ProcessingTimeInMilliseconds")

        return OCRResult(
            text          = full_text,
            page_count    = len(parsed_results),
            words_found   = total_words,
            engine_used   = self._config.engine.value,
            processing_ms = int(processing_time) if processing_time else None,
        )

    def close(self) -> None:
        """Release the underlying HTTP session. Call when done if used outside a context manager."""
        self._session.close()

    def __enter__(self) -> "PDFOCRService":
        return self

    def __exit__(self, *_) -> None:
        self.close()
