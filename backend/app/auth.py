import os
import hmac
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from jose import jwt, JWTError
from passlib.context import CryptContext
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from . import models
from .database import get_db

logger = logging.getLogger(__name__)

# Ensure backend .env is loaded
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)
load_dotenv()

DEV_FALLBACK_SECRET_KEY = "karigari-connect-secure-dev-key-2026-sih"
DEV_FALLBACK_ADMIN_SECRET = "karigari-connect-admin-bootstrap-dev-2026"

def _get_validated_secrets():
    env = os.getenv("ENVIRONMENT", os.getenv("ENV", "development")).lower()
    secret_key = os.getenv("SECRET_KEY")
    admin_secret = os.getenv("ADMIN_SECRET_KEY")

    if env == "production":
        if not secret_key or secret_key.strip() == DEV_FALLBACK_SECRET_KEY:
            raise RuntimeError("FATAL: Insecure or missing SECRET_KEY in production environment!")
        if not admin_secret or admin_secret.strip() == DEV_FALLBACK_ADMIN_SECRET:
            raise RuntimeError("FATAL: Insecure or missing ADMIN_SECRET_KEY in production environment!")
        return secret_key.strip(), admin_secret.strip()

    if not secret_key:
        logger.warning("SECRET_KEY is unset in %s environment. Using development fallback key.", env)
        secret_key = DEV_FALLBACK_SECRET_KEY
    if not admin_secret:
        logger.warning("ADMIN_SECRET_KEY is unset in %s environment. Using development fallback key.", env)
        admin_secret = DEV_FALLBACK_ADMIN_SECRET

    return secret_key.strip(), admin_secret.strip()

SECRET_KEY, ADMIN_SECRET_KEY = _get_validated_secrets()
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours
REFRESH_LEEWAY_DAYS = (
    7  # absolute outer bound: token older than this can't be refreshed, must re-login
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def verify_token_for_refresh(token: str) -> Optional[dict]:
    """
    Same as verify_token but ignores expiry — used ONLY by the refresh endpoint.
    Still validates signature. Enforces an absolute outer age limit so a token
    can't be refreshed forever.
    """
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            options={"verify_exp": False},
        )
    except JWTError:
        return None

    exp = payload.get("exp")
    if exp is None:
        return None

    token_expired_at = datetime.fromtimestamp(exp, tz=timezone.utc)
    if datetime.now(timezone.utc) - token_expired_at > timedelta(
        days=REFRESH_LEEWAY_DAYS
    ):
        return None

    return payload


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> models.User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    payload = verify_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    username: str = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token: missing subject",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User associated with token no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_user_for_refresh(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> models.User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = verify_token_for_refresh(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalid or too old to refresh — please log in again",
            headers={"WWW-Authenticate": "Bearer"},
        )
    username: str = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token: missing subject",
        )
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User associated with token no longer exists",
        )
    return user


def require_role(allowed_roles: List[str]):
    def role_guard(
        current_user: models.User = Depends(get_current_user),
    ) -> models.User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation not permitted. Required role: {allowed_roles}, your role: {current_user.role}",
            )
        return current_user

    return role_guard


def get_admin_user_or_secret(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
    db: Session = Depends(get_db),
) -> bool:
    """
    Authorize creation of privileged accounts (coordinators, admins).
    Permitted if:
    1. Valid X-Admin-Secret header matching ADMIN_SECRET_KEY is provided.
    2. Valid Bearer token belonging to an 'admin' user is provided.
    """
    if x_admin_secret and hmac.compare_digest(x_admin_secret.strip(), ADMIN_SECRET_KEY):
        return True

    if credentials:
        payload = verify_token(credentials.credentials)
        if payload and payload.get("role") == "admin":
            user = db.query(models.User).filter(models.User.username == payload.get("sub")).first()
            if user and user.role == "admin":
                return True

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin authorization or valid X-Admin-Secret required to provision privileged accounts",
    )

