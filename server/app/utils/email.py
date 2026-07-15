"""
Server-side email delivery via EmailJS REST API.

EmailJS has a public REST endpoint that accepts service_id, template_id,
user_id (public key), and template_params — no SMTP credentials needed.

Docs: https://www.emailjs.com/docs/rest-api/send/
"""

import httpx

from app.core.config import settings
from app.utils.logging import get_logger

logger = get_logger("utils.email")

EMAILJS_API_URL = "https://api.emailjs.com/api/v1.0/email/send"


async def send_otp_email(*, email: str, otp: str, name: str = "") -> None:
    """
    Send a 6-digit OTP email via EmailJS REST API.

    Silently skips sending if EmailJS credentials are not configured
    (so the app still works in dev without email setup).

    Raises httpx.HTTPStatusError on delivery failure in production.
    """
    if not all([settings.EMAILJS_SERVICE_ID, settings.EMAILJS_TEMPLATE_ID, settings.EMAILJS_PUBLIC_KEY]):
        logger.warning(
            "EmailJS credentials not configured. OTP for %s: %s (dev-only log — remove in prod)",
            email,
            otp,
        )
        return

    payload = {
        "service_id":   settings.EMAILJS_SERVICE_ID,
        "template_id":  settings.EMAILJS_TEMPLATE_ID,
        "user_id":      settings.EMAILJS_PUBLIC_KEY,
        "template_params": {
            "to_email": email,
            "email":    email,
            "to_name":  name or email.split("@")[0],
            "name":     name or email.split("@")[0],
            "otp":      otp,
        },
    }
    
    if settings.EMAILJS_PRIVATE_KEY:
        payload["accessToken"] = settings.EMAILJS_PRIVATE_KEY

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(EMAILJS_API_URL, json=payload)
        if not response.is_success:
            logger.error("EmailJS API failed: %s %s", response.status_code, response.text)
        response.raise_for_status()

    logger.info("OTP email sent via EmailJS to %s", email)
