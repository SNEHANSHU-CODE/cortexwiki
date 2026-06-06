import io
from pypdf import PdfReader
from app.utils.logging import get_logger
from app.utils.pdfOCRService import PDFOCRService, OCRError

logger = get_logger("utils.pdf")


def extract_text_from_pdf(pdf_bytes: bytes, filename: str = "document.pdf") -> str:
    """
    Extract text from PDF using native pypdf extraction.
    If native extraction yields empty/short results, falls back to OCR.space.
    """
    if not pdf_bytes:
        raise ValueError("pdf_bytes must not be empty")

    logger.info("Attempting native text extraction from PDF: %s (%d bytes)", filename, len(pdf_bytes))
    
    native_text_parts = []
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                native_text_parts.append(page_text.strip())
    except Exception as e:
        logger.warning("Native PDF parsing failed, falling back directly to OCR.space: %s", str(e))

    native_text = "\n\n".join(native_text_parts).strip()
    
    # If native text is sufficient (e.g. at least 50 characters), return it
    if len(native_text) >= 50:
        logger.info("Successfully extracted native text from PDF (%d characters)", len(native_text))
        return native_text

    logger.info("Native text too short or empty (%d chars). Falling back to OCR.space API.", len(native_text))
    
    # OCR.space API call
    try:
        with PDFOCRService() as ocr_service:
            ocr_text = ocr_service.extract_text_from_bytes(pdf_bytes, filename=filename)
            if ocr_text.strip():
                logger.info("Successfully extracted text via OCR.space (%d characters)", len(ocr_text))
                return ocr_text
    except OCRError as e:
        logger.error("OCR.space API extraction failed: %s", str(e))
        raise
    except Exception as e:
        logger.error("Unexpected error during OCR fallback: %s", str(e))
        raise OCRError(f"OCR processing failed: {str(e)}") from e

    raise OCRError("No text could be extracted from the PDF (native extracted empty, OCR returned empty).")
