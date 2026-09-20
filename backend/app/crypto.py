# backend/app/crypto.py
import os
import logging
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from cryptography.fernet import Fernet, InvalidToken

# Ensure backend .env is loaded
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)
load_dotenv()

logger = logging.getLogger(__name__)

# Valid 32 url-safe base64 characters for Fernet
DEV_FALLBACK_ENCRYPTION_KEY = "azEycDNvNXE3cjhzOXR1dnd4eXoxMjM0NTY3ODkwMTI="

def _resolve_encryption_key() -> str:
    env = os.getenv("ENVIRONMENT", os.getenv("ENV", "development")).lower()
    raw_key = os.getenv("ENCRYPTION_KEY")

    if env == "production":
        if not raw_key or raw_key == DEV_FALLBACK_ENCRYPTION_KEY:
            raise RuntimeError("FATAL: Insecure or missing ENCRYPTION_KEY in production environment!")
        return raw_key.strip()

    if not raw_key:
        logger.warning(
            "ENCRYPTION_KEY is not set in %s environment. Using development fallback key.",
            env
        )
        return DEV_FALLBACK_ENCRYPTION_KEY

    return raw_key.strip()

try:
    _FERNET_KEY = _resolve_encryption_key()
    _cipher = Fernet(_FERNET_KEY.encode("utf-8"))
except Exception as exc:
    # If the key is invalid format in dev/test, use a safe dev Fernet key
    logger.error("Failed to initialize Fernet cipher: %s", exc)
    _cipher = Fernet(Fernet.generate_key())

def encrypt_pii(value: Optional[str]) -> Optional[str]:
    """Encrypt sensitive string using authenticated symmetric Fernet encryption."""
    if value is None or value == "":
        return value
    try:
        return _cipher.encrypt(value.encode("utf-8")).decode("utf-8")
    except Exception as err:
        logger.error("Failed to encrypt PII value: %s", err)
        return value

def decrypt_pii(value: Optional[str]) -> Optional[str]:
    """
    Decrypt sensitive string using Fernet.
    Gracefully falls back to returning raw value if it is legacy plaintext.
    """
    if value is None or value == "":
        return value
    try:
        return _cipher.decrypt(value.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        # Legacy unencrypted plaintext row in DB
        return value
    except Exception as err:
        logger.warning("Unexpected error decrypting value: %s", err)
        return value
